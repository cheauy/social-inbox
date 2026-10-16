/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL (PGlite) only: synthetic KHQR attempts, no bank/network calls or hosted data.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const root = process.cwd();
const { database, prepare, settle } = require(path.join(root, 'tests/bakong-fixture.cjs'));
const { loader } = require(path.join(root, 'tests/tenh-seven/harness.cjs'));
const { getTrustedPlan, buildPurchaseRecord } = loader({ 'server-only': {} })('lib/billing/subscription-purchase.ts');
const read = file => fs.readFileSync(path.join(root, 'db/migrations', file), 'utf8');
const cancellation = read('20261016083154_payment_cancellation_safety.sql');
const migration = read('20261016093000_bakong_checkout_lifecycle.sql');

// The shared fixture installs the cancellation ledger and this lifecycle migration.
const setup = () => database();
const one = async (ctx, sql, args = []) => (await ctx.db.query(sql, args)).rows[0];
const subscription = (ctx, businessId) => one(ctx, 'select * from business_subscriptions where business_id=$1', [businessId]);
// A second explicit plan selection in the same workspace: new intent, id, reference and QR.
async function again(ctx, p, options = {}) {
  const current = await subscription(ctx, p.businessId), id = randomUUID();
  const record = buildPurchaseRecord(id, p.businessId, p.memberId, getTrustedPlan('mini', 'monthly', null, null, false, false, 'none', current), current);
  const qr = 'synthetic-offline-qr:' + id, md5 = createHash('md5').update(qr).digest('hex');
  const args = [record, p.userId, p.memberId, options.intent ?? randomUUID(), { planCode: 'mini', billingCycle: 'monthly' }, p.args[5], p.fingerprint,
    'merchant@devb', qr, md5, 'TC' + id.replaceAll('-', '').slice(0, 22), new Date(Date.now() + (options.expiryMs ?? 600000)).toISOString(), 90];
  const result = (await one(ctx, 'select tenh_prepare_bakong_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) r', args)).r;
  return { ...p, attempt: result, amount: record.amount, args };
}
const cancel = async (ctx, p, actor = p) => (await one(ctx, "select tenh_request_payment_cancellation('bakong',$1,$2,$3,$4,false) r", [p.attempt.id, p.businessId, actor.userId, actor.memberId])).r;
const cancelOrNot = (ctx, p) => cancel(ctx, p).catch(error => { if (/cannot be cancelled|no longer awaiting/.test(error.message)) return { outcome: 'not_cancellable' }; throw error; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const shiftExpiry = async (ctx, id, sql) => ctx.db.exec(`alter table bakong_payment_attempts disable trigger bakong_immutable_attempt_identity;
  update bakong_payment_attempts set expires_at=${sql} where id='${id}';
  alter table bakong_payment_attempts enable trigger bakong_immutable_attempt_identity;`);

test('expired KHQR no longer blocks: a new selection gets a new attempt while old evidence stays pending', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx, { expiryMs: 300 });
    const open = await again(ctx, p);
    assert.equal(open.attempt.id, p.attempt.id, 'a still-valid checkout is resumed');
    await wait(400);
    const next = await again(ctx, p);
    assert.notEqual(next.attempt.id, p.attempt.id);
    assert.notEqual(next.attempt.reference, p.attempt.reference);
    assert.notEqual(next.attempt.md5, p.attempt.md5);
    const old = await one(ctx, 'select a.state,b.status from bakong_payment_attempts a join billing_transactions b using(id) where id=$1', [p.attempt.id]);
    assert.deepEqual(old, { state: 'pending', status: 'pending' }, 'expiry is not labelled unpaid');
    assert.equal((await one(ctx, 'select count(*)::int n from bakong_payment_attempts where business_id=$1', [p.businessId])).n, 2);
    // The reused intent of the expired attempt is never replayed as a payable checkout.
    await assert.rejects(again(ctx, p, { intent: p.args[3] }), /Checkout closed/);
  } finally { await ctx.db.close(); }
});

test('expired KHQR no longer blocks PayWay or manual claims; an open KHQR still does', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx, { expiryMs: 300 });
    const insertManual = () => ctx.db.query("insert into manual_payment_requests(business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit) values($1,'mini','monthly',$2,'USD','submitted',1,3)", [p.businessId, p.amount]);
    await assert.rejects(insertManual(), /unresolved payment/);
    await wait(400);
    await insertManual();
  } finally { await ctx.db.close(); }
});

test('cancel is idempotent, audited, permission-checked and leaves the subscription unchanged', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx), before = await subscription(ctx, p.businessId);
    const viewer = { userId: randomUUID(), memberId: randomUUID() };
    await ctx.db.query("insert into team_members(id,user_id,business_id,role,is_active,permissions) values($1,$2,$3,'member',true,'{\"billing\":\"view\"}')", [viewer.memberId, viewer.userId, p.businessId]);
    await assert.rejects(cancel(ctx, p, viewer), /permission required/);
    await ctx.db.query('update team_members set is_active=false where id=$1', [viewer.memberId]);
    const outsider = await prepare(ctx);
    await assert.rejects(cancel(ctx, { ...p, businessId: outsider.businessId }, outsider), /Payment missing/);
    const results = await Promise.all([cancel(ctx, p), cancel(ctx, p), cancel(ctx, p)]);
    assert.deepEqual(results.map(r => r.outcome), ['checkout_closed', 'checkout_closed', 'checkout_closed']);
    assert.equal((await one(ctx, 'select count(*)::int n from payment_cancellations')).n, 1);
    const closure = await one(ctx, "select * from payment_cancellations where kind='bakong' and payment_id=$1", [p.attempt.id]);
    assert.equal(closure.actor_user_id, p.userId); assert.equal(closure.member_id, p.memberId);
    assert.equal(closure.reason, 'customer_cancelled'); assert.ok(closure.requested_at); assert.ok(closure.completed_at);
    assert.equal((await one(ctx, "select has_table_privilege('service_role','payment_cancellations','DELETE') d")).d, false);
    assert.deepEqual(await subscription(ctx, p.businessId), before);
    assert.equal((await one(ctx, 'select status from billing_transactions where id=$1', [p.attempt.id])).status, 'pending');
    const next = await again(ctx, p);
    assert.notEqual(next.attempt.id, p.attempt.id, 'cancel followed by a new attempt');
    await assert.rejects(again(ctx, p, { intent: p.args[3] }), /Checkout closed/);
    // Expired checkout: nothing to cancel, nothing recorded.
    const late = await prepare(ctx, { expiryMs: 300 }); await wait(400);
    assert.equal((await cancel(ctx, late)).outcome, 'expired');
  } finally { await ctx.db.close(); }
});

test('verified or applied payments cannot be cancelled as unpaid', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx, { environment: 'production', approvedCapacity: true });
    assert.equal((await settle(ctx, p)).result.state, 'verified');
    assert.equal((await cancelOrNot(ctx, p)).outcome, 'not_cancellable');
    assert.equal((await one(ctx, 'select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])).r.state, 'applied');
    assert.equal((await cancelOrNot(ctx, p)).outcome, 'not_cancellable');
    assert.equal((await one(ctx, 'select count(*)::int n from payment_cancellations')).n, 0);
  } finally { await ctx.db.close(); }
});

test('confirmation after cancel is kept for review, never applied, and blocks a second payment', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx, { environment: 'production', approvedCapacity: true }), before = await subscription(ctx, p.businessId);
    await cancel(ctx, p);
    const result = (await settle(ctx, p, '2'.repeat(64))).result;
    assert.equal(result.state, 'review'); assert.equal(result.reason, 'CANCELLATION_PAYMENT_REVIEW');
    assert.equal(result.verified_hash, '2'.repeat(64));
    assert.equal((await one(ctx, 'select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])).r.state, 'review');
    assert.deepEqual(await subscription(ctx, p.businessId), before);
    // Duplicate confirmation of the same transaction changes nothing.
    await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
    await ctx.db.exec(`alter table bakong_payment_attempts disable trigger bakong_immutable_attempt_identity; update bakong_payment_attempts set next_check_at=now() where id='${p.attempt.id}'; alter table bakong_payment_attempts enable trigger bakong_immutable_attempt_identity;`);
    assert.equal((await one(ctx, 'select tenh_claim_bakong_check($1,$2,90) r', [p.attempt.id, p.fingerprint])).r.reason, 'settled');
    // Received funds await review: the workspace is shown that payment, not asked to pay again.
    assert.equal((await again(ctx, p)).attempt.id, p.attempt.id);
    await assert.rejects(ctx.db.query("insert into manual_payment_requests(business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit) values($1,'mini','monthly',$2,'USD','submitted',1,3)", [p.businessId, p.amount]), /unresolved payment/);
  } finally { await ctx.db.close(); }
});

test('confirmation racing cancellation resolves to exactly one consistent outcome', async () => {
  for (const order of ['cancel-first', 'confirm-first']) {
    const ctx = await setup();
    try {
      const p = await prepare(ctx, { environment: 'production', approvedCapacity: true });
      const steps = order === 'cancel-first' ? [() => cancelOrNot(ctx, p), () => settle(ctx, p)] : [() => settle(ctx, p), () => cancelOrNot(ctx, p)];
      const [first, second] = await Promise.all(steps.map(step => step()));
      const cancelled = order === 'cancel-first' ? first : second, settled = order === 'cancel-first' ? second : first;
      if (cancelled.outcome === 'checkout_closed') assert.equal(settled.result.state, 'review');
      else { assert.equal(cancelled.outcome, 'not_cancellable'); assert.equal(settled.result.state, 'verified'); }
      const state = (await one(ctx, 'select state from bakong_payment_attempts where id=$1', [p.attempt.id])).state;
      assert.notEqual(state === 'verified' && cancelled.outcome === 'checkout_closed', true);
    } finally { await ctx.db.close(); }
  }
});

test('late confirmation of a replaced QR goes to review; only the replacement applies', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx, { environment: 'production', approvedCapacity: true, expiryMs: 300 });
    await wait(400);
    const next = await again(ctx, p);
    await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
    assert.equal((await settle(ctx, next, '3'.repeat(64))).result.state, 'verified');
    assert.equal((await one(ctx, 'select tenh_apply_bakong_payment($1,$2) r', [next.attempt.id, p.userId])).r.state, 'applied');
    const applied = await subscription(ctx, p.businessId);
    await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
    const late = (await settle(ctx, p, '4'.repeat(64))).result;
    assert.equal(late.state, 'review'); assert.equal(late.reason, 'LATE_PAYMENT_REVIEW');
    assert.deepEqual(await subscription(ctx, p.businessId), applied, 'benefits granted once');
    assert.equal((await one(ctx, "select count(*)::int n from tenh_billing_invoices where business_id=$1", [p.businessId])).n, 1);
  } finally { await ctx.db.close(); }
});

test('unused reservations release one hour after QR expiry; used requests stay counted', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx);
    const claim = (await one(ctx, 'select tenh_claim_bakong_check($1,$2,90) r', [p.attempt.id, p.fingerprint])).r;
    assert.equal(claim.claimed, true);
    await ctx.db.query('select tenh_complete_bakong_check($1,$2,$3,$4)', [p.attempt.id, claim.claimId, { state: 'unresolved' }, p.userId]);
    const reserved = async () => (await one(ctx, "select tenh_bakong_private.reserved_inquiries('sandbox') n")).n;
    assert.equal(await reserved(), 2);
    await cancel(ctx, p);
    assert.equal(await reserved(), 2, 'cancellation does not release a payable QR reservation');
    await shiftExpiry(ctx, p.attempt.id, "now()-interval '59 minutes'");
    assert.equal(await reserved(), 2);
    await shiftExpiry(ctx, p.attempt.id, "now()-interval '61 minutes'");
    assert.equal(await reserved(), 0);
    assert.equal((await one(ctx, 'select count(*)::int n from tenh_bakong_private.provider_calls where attempt_id=$1', [p.attempt.id])).n, 1);
    // The lifetime cap still holds for reconciliation checks of the closed attempt.
    await ctx.db.query("insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) select gen_random_uuid(),$1,'sandbox',$2 from generate_series(1,2)", [p.fingerprint, p.attempt.id]);
    await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
    assert.equal((await one(ctx, 'select tenh_claim_bakong_check($1,$2,90) r', [p.attempt.id, p.fingerprint])).r.claimed, false);
  } finally { await ctx.db.close(); }
});

test('an unknown installed contract rolls the whole migration back', async () => {
  const ctx = await database(true, true, true, false);
  try {
    await ctx.db.exec("alter table team_members add column if not exists permissions jsonb default '{}'");
    await ctx.db.exec('alter table manual_payment_requests add column if not exists proof_path text');
    const source = (await one(ctx, "select pg_get_functiondef('public.tenh_guard_pending_payment_claim()'::regprocedure) s")).s;
    await ctx.db.exec(source.replace("provider in ('payway','bakong') and status = 'pending')", "provider in ('payway','bakong') and status = 'pending' )"));
    await ctx.db.exec(cancellation);
    await assert.rejects(ctx.db.exec(migration), /pending-claim contract/);
    await ctx.db.exec('rollback');
    assert.equal((await one(ctx, "select to_regprocedure('public.tenh_bakong_blocking_attempt(uuid)') n")).n, null);
  } finally { await ctx.db.close(); }
});

// Characterization of rejected drafts, not acceptance of safe production behavior.
test('unsafe lifecycle draft reproducer: one owner can reserve the whole inquiry budget by closing 30 fresh checkouts', async () => {
  const ctx = await setup();
  try {
    let p = await prepare(ctx);
    const actor = p.userId;
    for (let i = 0; i < 30; i++) {
      assert.equal(p.userId, actor);
      assert.equal((await cancel(ctx, p)).outcome, 'checkout_closed');
      if (i < 29) p = await again(ctx, p);
    }
    assert.equal((await one(ctx, "select tenh_bakong_private.reserved_inquiries('sandbox') n")).n, 90);
    assert.equal((await one(ctx, 'select count(*)::int n from tenh_bakong_private.provider_calls')).n, 0);
    const capacity = (await one(ctx, "select tenh_bakong_capacity($1,'sandbox','merchant@devb',90) r", [p.fingerprint])).r;
    assert.equal(capacity.canIssue, false, 'one actor prevents unrelated issuance without making any bank call');
  } finally { await ctx.db.close(); }
});

test('unsafe recovery draft reproducer: known late funds cannot be resolved by the existing reconcile helper', async () => {
  const ctx = await setup();
  try {
    const p = await prepare(ctx, { environment: 'production', approvedCapacity: true });
    await cancel(ctx, p);
    const late = (await settle(ctx, p, '9'.repeat(64))).result;
    assert.equal(late.state, 'review');assert.ok(late.verified_hash);
    let calls = 0;
    const forbidden = () => { calls++; throw new Error('No provider or privileged write allowed'); };
    const { checkBakongPayment } = loader({
      'server-only': {}, '@/lib/supabase/server': { createClient: forbidden },
      '@/lib/supabase/admin': { supabaseAdmin: { rpc: forbidden, from: forbidden } },
      '@/lib/bakong/config': { getBakongConfig: forbidden },
      '@/lib/bakong/provider': { checkBakongTransaction: forbidden, generateBakongQr: forbidden },
    })('lib/bakong/payments.ts');
    assert.equal(await checkBakongPayment(late, p.userId), late);
    assert.equal(calls, 0, 'the early verified_hash return does not run an operator resolution');
    assert.equal((await again(ctx, p)).attempt.id, p.attempt.id, 'review still blocks fresh checkout');
  } finally { await ctx.db.close(); }
});
