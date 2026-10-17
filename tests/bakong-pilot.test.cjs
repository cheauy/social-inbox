/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic PostgreSQL + mocked HTTP only. Never reads .env or calls a provider.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { randomUUID, createHash } = require('node:crypto');
const { loader } = require('./tenh-seven/harness.cjs');
const { database, prepare, settle } = require('./bakong-fixture.cjs');
const MIGRATION = 'db/migrations/20261016043734_bakong_scoped_pilot.sql';
const sql = fs.readFileSync(MIGRATION, 'utf8');
const USER = '6b84cd6d-deb5-4191-b1c6-0f3861eda892';
const BUSINESS = 'f79eeac0-db5e-4f3f-8783-2dfb9b818dd9';
const END = '2027-08-21T10:03:56.418985Z';
const filename = path.resolve('tests/bakong-api.test.cjs');
const source = fs.readFileSync(filename, 'utf8'), moduleFixture = { exports: {} };
vm.runInNewContext(source.slice(0, source.indexOf("test('server quote")) + '\nmodule.exports={fixture};',
  { require: createRequire(filename), module: moduleFixture, process, console, Request, Response, Headers, setTimeout, Buffer });
const pricing = loader()('lib/billing/subscription-purchase.ts');

async function fixture() {
  const f = await moduleFixture.exports.fixture('production', 'individual');
  await f.db.query("update business_subscriptions set business_id=$1,status='active',plan_code='pro',billing_cycle='12-months',member_limit=8,channel_limit=12,current_period_start='2026-08-21T10:03:56.418985Z',current_period_end=$2,last_paid_amount=566.4,last_paid_currency='USD',pricing_version='v3.11.31.21',pricing_snapshot='{}' where business_id=$3", [BUSINESS, END, f.seeded.businessId]);
  await f.db.query('update team_members set business_id=$1,user_id=$2 where id=$3', [BUSINESS, USER, f.memberId]);
  f.seeded.businessId = BUSINESS; f.state.userId = USER;
  Object.assign(f.env, { BAKONG_CHECKOUT_ENABLED: 'false', BAKONG_PILOT_ENABLED: 'true' });
  Object.assign(f.body, { businessId: BUSINESS, planCode: 'custom', billingCycle: '12-months', connections: 13, users: 8, customUpgrade: true });
  f.subscription = async () => (await f.db.query('select row_to_json(s) s from business_subscriptions s where business_id=$1', [BUSINESS])).rows[0].s;
  f.authorize = async (patch = {}) => {
    const subscription = await f.subscription();
    const trusted = pricing.getTrustedPlan('custom', '12-months', 13, 8, false, true, 'none', subscription);
    assert.ok(trusted);
    const r = await f.db.query(`with stamp as (select clock_timestamp()-make_interval(secs=>$9::integer) t)
      insert into tenh_bakong_private.pilot_authorizations(user_id,business_id,member_id,credential_fingerprint,recipient,baseline,approved_quote,approved_max_cents,
      approved_by,approval_reference,authorized_at,issue_until,inquiry_until,quota_source,reported_daily_limit,dedicated_token_attested,provider_eligibility,attestation_reference)
      select $1,$2,$3,$4,$5,tenh_compat_subscription_identity($6),$7,$8,$1,'synthetic explicit pilot approval',t,t+interval '30 minutes',t+interval '1 hour','user-attested',100,true,'not-independently-verified','synthetic user statement' from stamp returning id`,
    [USER, BUSINESS, f.memberId, patch.fingerprint ?? f.config.fingerprint, patch.recipient ?? f.config.accountId, subscription, trusted.customUpgradeQuote, trusted.quote.totalCents, patch.ageSeconds ?? 0]);
    return r.rows[0].id;
  };
  f.clearCooldown = () => f.db.exec("update tenh_bakong_private.request_budgets set blocked_until=null; update bakong_payment_attempts set next_check_at=clock_timestamp()-interval '1 second',lease_until=null");
  f.postCheckout = body => f.checkout.POST(f.post('/api/bakong/checkout', body ?? f.body));
  return f;
}

test('pilot stays off without both the server flag and an explicit private authorization', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.postCheckout()).status, 410);
    await f.authorize(); f.env.BAKONG_PILOT_ENABLED = 'false';
    assert.equal((await f.postCheckout()).status, 410);
    assert.equal(f.state.calls, 0);
    assert.equal((await f.db.query('select count(*)::int n from billing_transactions')).rows[0].n, 0);
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.capacity_reviews')).rows[0].n, 0);
  } finally { await f.db.close(); }
});

test('pilot binds the one exact actor, workspace, credential, recipient and capacity selection', async t => {
  for (const kind of ['user', 'fingerprint', 'recipient', 'users', 'connections', 'extension', 'browser-approval']) await t.test(kind, async () => {
    const f = await fixture();
    try {
      await f.authorize(kind === 'fingerprint' ? { fingerprint: '0'.repeat(64) } : kind === 'recipient' ? { recipient: 'other@devb' } : {});
      if (kind === 'user') f.state.userId = randomUUID();
      const body = { ...f.body, ...(kind === 'users' ? { users: 9 } : kind === 'connections' ? { connections: 14 } :
        kind === 'extension' ? { extensionBillingCycle: '12-months' } : kind === 'browser-approval' ? { approved_max_cents: 100000 } : {}) };
      assert.ok((await f.postCheckout(body)).status >= 400);
      assert.equal((await f.db.query('select count(*)::int n from bakong_payment_attempts')).rows[0].n, 0);
      assert.equal(f.state.calls, 0);
    } finally { await f.db.close(); }
  });
});

test('approval baseline changes, scheduled changes and insufficient shared capacity fail before an obligation', async t => {
  for (const kind of ['baseline', 'scheduled', 'budget']) await t.test(kind, async () => {
    const f = await fixture();
    try {
      await f.authorize();
      if (kind === 'baseline') await f.db.query('update business_subscriptions set channel_limit=13 where business_id=$1', [BUSINESS]);
      if (kind === 'scheduled') await f.db.query('update business_subscriptions set cancel_at_period_end=true where business_id=$1', [BUSINESS]);
      if (kind === 'budget') await f.db.exec("insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) select gen_random_uuid(),'synthetic','production',gen_random_uuid() from generate_series(1,89)");
      assert.ok((await f.postCheckout()).status >= 400);
      assert.equal((await f.db.query('select count(*)::int n from bakong_payment_attempts')).rows[0].n, 0);
    } finally { await f.db.close(); }
  });
});

test('even a trusted-service request cannot exceed the approved amount or substitute a workspace', async () => {
  const f = await fixture();
  try {
    await f.authorize();
    const subscription = await f.subscription();
    const trusted = pricing.getTrustedPlan('custom','12-months',13,8,false,true,'none',subscription);
    const record = pricing.buildPurchaseRecord(randomUUID(), BUSINESS, f.memberId, trusted, subscription);
    record.amount = ((trusted.quote.totalCents + 1) / 100).toFixed(2);
    const qr = 'synthetic-qr-only';
    const selection = { planCode:'custom',billingCycle:'12-months',connections:13,users:8,renewSame:false,customUpgrade:true,extensionBillingCycle:'none' };
    const args = [record,USER,f.memberId,randomUUID(),selection,'production',f.config.fingerprint,f.config.accountId,qr,createHash('md5').update(qr).digest('hex'),'synthetic-reference',new Date(Date.now()+900000).toISOString(),90];
    await assert.rejects(f.db.query('select tenh_prepare_bakong_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',args), /approved scope/);
    await assert.rejects(f.db.query('insert into tenh_bakong_private.pilot_authorizations select * from tenh_bakong_private.pilot_authorizations'), /duplicate key/);
    const wrong = await f.postCheckout({ ...f.body, businessId:randomUUID() });
    assert.equal(wrong.status,403);
    assert.equal((await f.db.query('select count(*)::int n from billing_transactions')).rows[0].n,0);
  } finally { await f.db.close(); }
});

test('parallel preparation and a lost reply preserve one issued quote and a lifetime single attempt', async () => {
  const f = await fixture();
  try {
    await f.authorize(); f.state.losePrepare = true;
    const [one, two] = await Promise.all([f.seedExistingAttempt(), f.seedExistingAttempt()]);
    assert.equal(one.attemptId, two.attemptId);
    const row = (await f.db.query('select * from tenh_bakong_private.pilot_authorizations')).rows[0];
    assert.equal(row.attempt_id, one.attemptId);
    assert.ok(Math.round(Number(row.issued_quote.amount) * 100) <= row.approved_max_cents);
    assert.equal(row.issued_quote.target_member_limit, 8); assert.equal(row.issued_quote.target_channel_limit, 13);
    const view = (await (await f.read(one.attemptId)).json()).attempt;
    assert.match(view.qrImage, /^data:image\/png;base64,/);
    assert.equal(view.pilot_authorization_id, undefined);
    assert.ok(!JSON.stringify(view).includes(f.config.fingerprint));
    const freshIntent = await f.postCheckout({ ...f.body, purchaseIntent: randomUUID() });
    assert.equal(freshIntent.status, 410);
    assert.equal((await f.db.query('select count(*)::int n from bakong_payment_attempts')).rows[0].n, 1);
    await assert.rejects(f.db.query('update tenh_bakong_private.pilot_authorizations set approved_max_cents=approved_max_cents+1'), /immutable/);
    await assert.rejects(f.db.query('delete from tenh_bakong_private.pilot_authorizations'), /Retain/);
  } finally { await f.db.close(); }
});

test('customer/admin concurrent checks and failed inquiries share a hard lifetime cap of three', async () => {
  const f = await fixture();
  try {
    await f.authorize(); const started = await f.seedExistingAttempt(); f.state.observation = 'unresolved'; f.state.admin = true;
    const admin = f.load('app/api/bakong/admin/route.ts');
    const reconcile = () => admin.POST(f.post('/api/bakong/admin', { attemptId: started.attemptId, action: 'reconcile' }));
    await Promise.all([f.check(started.attemptId), reconcile(), f.check(started.attemptId)]);
    assert.equal(f.state.calls, 1);
    for (let n = 1; n < 3; n++) { await f.clearCooldown(); await reconcile(); }
    assert.equal(f.state.calls, 3);
    await f.clearCooldown();
    await f.db.exec('update bakong_payment_attempts set check_count=0'); // A UI-counter reset cannot restore allowance.
    await f.db.exec("update tenh_bakong_private.provider_calls set counted_at=counted_at-interval '2 days'"); // A rolling-day reset cannot restore it either.
    await Promise.all([f.check(started.attemptId), reconcile()]);
    assert.equal(f.state.calls, 3);
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.provider_calls')).rows[0].n, 3);
    const view = (await (await f.read(started.attemptId)).json()).attempt;
    assert.equal(view.canCheck, false); assert.equal(view.qrImage, null); assert.equal(view.automaticChecksRemaining, 0);
    assert.equal(view.reconciliationRequired, true); assert.equal(view.state, 'pending');
    assert.equal((await f.subscription()).channel_limit, 12);
    assert.equal((await f.db.query('select count(*)::int n from tenh_billing_invoices')).rows[0].n, 0);
  } finally { await f.db.close(); }
});

test('revocation stops new inquiries but retains the saved obligation and audit trail', async () => {
  const f = await fixture();
  try {
    const authorization = await f.authorize(), started = await f.seedExistingAttempt();
    await f.db.query('update tenh_bakong_private.pilot_authorizations set revoked_at=clock_timestamp() where id=$1', [authorization]);
    await f.check(started.attemptId);
    assert.equal(f.state.calls, 0);
    const view = (await (await f.read(started.attemptId)).json()).attempt;
    assert.equal(view.reconciliationRequired, true); assert.equal(view.qrImage, null); assert.equal(view.canCheck, false);
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.pilot_audit')).rows[0].n, 3);
    assert.equal((await f.seedExistingAttempt()).attemptId, started.attemptId, 'reopening saved evidence never creates another transfer');
    await assert.rejects(f.db.exec('update tenh_bakong_private.pilot_authorizations set revoked_at=null'), /immutable/);
  } finally { await f.db.close(); }
});

test('expired pilot stops issuance and further inquiries without clearing the payment evidence', async () => {
  const f = await fixture();
  try {
    await f.authorize(); const started = await f.seedExistingAttempt();
    // Age only the isolated fixture; production approvals cannot change their deadlines.
    await f.db.exec("alter table tenh_bakong_private.pilot_authorizations disable trigger bakong_protect_pilot; update tenh_bakong_private.pilot_authorizations set authorized_at=authorized_at-interval '2 hours',issue_until=issue_until-interval '2 hours',inquiry_until=inquiry_until-interval '2 hours'; alter table tenh_bakong_private.pilot_authorizations enable trigger bakong_protect_pilot");
    await f.check(started.attemptId); assert.equal(f.state.calls,0);
    const view = (await (await f.read(started.attemptId)).json()).attempt;
    assert.equal(view.canCheck,false); assert.equal(view.qrImage,null); assert.equal(view.reconciliationRequired,true);
    assert.equal((await f.seedExistingAttempt()).attemptId,started.attemptId);
    assert.equal((await f.db.query('select count(*)::int n from billing_transactions where status=\'pending\'')).rows[0].n,1);
    assert.equal((await f.subscription()).channel_limit,12);
  } finally { await f.db.close(); }
});

test('provider-verified evidence survives invoice failure and remains applicable after pilot switch-off', async () => {
  const f = await fixture();
  try {
    await f.authorize(); const started = await f.seedExistingAttempt();
    await f.db.exec("create function fixture_pilot_invoice_failure() returns trigger language plpgsql as $$begin raise exception 'fixture invoice unavailable'; end$$; create trigger fixture_pilot_invoice_failure before insert on tenh_billing_invoices for each row execute function fixture_pilot_invoice_failure()");
    const first = (await (await f.check(started.attemptId)).json()).attempt;
    assert.equal(first.state,'verified'); assert.equal(f.state.calls,1);
    f.env.BAKONG_PILOT_ENABLED='false';
    await f.db.exec('drop trigger fixture_pilot_invoice_failure on tenh_billing_invoices');
    const final = (await (await f.check(started.attemptId)).json()).attempt;
    assert.equal(final.state,'applied'); assert.equal(f.state.calls,1);
    assert.equal((await f.db.query('select count(*)::int n from tenh_billing_invoices')).rows[0].n,1);
  } finally { await f.db.close(); }
});

test('migration keeps existing normal preparation, verification and application contracts intact', async () => {
  const ctx = await database(true, true, false);
  try {
    const signatures = ['public.tenh_complete_bakong_check(uuid,uuid,jsonb,uuid)','public.tenh_apply_bakong_payment(uuid,uuid)',
      'public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)','public.tenh_approve_manual_payment(uuid,uuid,text,text)'];
    const bodies = async () => Promise.all(signatures.map(async signature => (await ctx.db.query('select pg_get_functiondef($1::regprocedure) body',[signature])).rows[0].body));
    const before = await bodies(); await ctx.db.exec(sql); assert.deepEqual(await bodies(),before);
    const p = await prepare(ctx,{environment:'production',approvedCapacity:true});
    await settle(ctx,p);
    const applied = (await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r',[p.attempt.id,p.userId])).rows[0].r;
    assert.equal(applied.state,'applied'); assert.equal(applied.pilot_authorization_id,null);
  } finally { await ctx.db.close(); }
});

test('a verified pilot retains authoritative exactly-once activation, users, paid expiry and invoice', async () => {
  const f = await fixture();
  try {
    await f.authorize(); const before = await f.subscription(), started = await f.seedExistingAttempt();
    const first = (await (await f.check(started.attemptId)).json()).attempt;
    assert.equal(first.state, 'applied'); assert.equal(first.application, 'active'); assert.equal(f.state.calls, 1);
    const after = await f.subscription();
    assert.equal(after.channel_limit, 13); assert.equal(after.member_limit, 8);
    assert.equal(after.current_period_end, before.current_period_end);
    await f.check(started.attemptId);
    assert.deepEqual(await f.subscription(), after); assert.equal(f.state.calls, 1);
    assert.equal((await f.db.query('select count(*)::int n from tenh_billing_invoices')).rows[0].n, 1);
    assert.ok((await f.postCheckout({ ...f.body, purchaseIntent: randomUUID() })).status >= 400);
  } finally { await f.db.close(); }
});

test('browser and service roles cannot manufacture, extend or erase pilot approvals', async () => {
  const f = await fixture();
  try {
    for (const role of ['anon','authenticated','service_role']) {
      for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) {
        const r = await f.db.query('select has_table_privilege($1,$2,$3) allowed', [role,'tenh_bakong_private.pilot_authorizations',privilege]);
        assert.equal(r.rows[0].allowed, false, role + ':' + privilege);
      }
      assert.equal((await f.db.query("select has_function_privilege($1,'public.tenh_bakong_pilot_status(uuid,uuid,uuid,text,text,uuid)','EXECUTE') allowed", [role])).rows[0].allowed, role === 'service_role');
    }
    await f.db.exec('set role authenticated');
    await assert.rejects(f.db.query('select public.tenh_bakong_pilot_status($1,$2,$3,$4,$5,null)', [USER,BUSINESS,f.memberId,f.config.fingerprint,f.config.accountId]), /permission denied/);
    await f.db.exec('reset role');
  } finally { await f.db.close(); }
});

test('unknown installed preparation contract aborts the whole draft migration', async () => {
  const ctx = await database(true, true, false);
  try {
    const signature = 'public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)';
    const original = (await ctx.db.query('select pg_get_functiondef($1::regprocedure) body', [signature])).rows[0].body;
    await ctx.db.exec(original.replace('if used+reserved+3>', 'if used + reserved + 3 >'));
    await assert.rejects(ctx.db.exec(sql), /Review the installed Bakong preparation contract/);
    await ctx.db.exec('rollback');
    assert.equal((await ctx.db.query("select to_regclass('tenh_bakong_private.pilot_authorizations') missing")).rows[0].missing, null);
  } finally { await ctx.db.close(); }
});
