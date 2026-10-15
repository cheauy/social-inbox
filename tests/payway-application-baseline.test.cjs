/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL fixture matching existing billing tests. */
// Captured activation/invoice bodies, synthetic schema and trigger wiring; no hosted database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, seed, functions } = require('./payway-compat-fixture.cjs');
const migration = fs.readFileSync('db/migrations/20261015113000_payment_application_baselines.sql', 'utf8');
async function database(install = true) {
  const db = await setup();
  const source = async signature => (await db.query('select pg_get_functiondef($1::regprocedure) as source', [signature])).rows[0].source;
  const v2 = await source('public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)');
  const manual = await source('public.tenh_approve_manual_payment(uuid,uuid,text,text)');
  await db.exec('drop index billing_transactions_one_pending_payway_per_business_idx');
  await db.exec(fs.readFileSync('tests/fixtures/payway-legacy-coexistence-core.sql', 'utf8'));
  for (const [body, name] of [[functions[0], 'activate_payway_v1'], [v2, 'activate_payway_v2'], [manual, 'approve_manual_v2']]) {
    await db.exec(body.replace(/CREATE OR REPLACE FUNCTION public\.\w+\(/, 'CREATE OR REPLACE FUNCTION tenh_billing_private.' + name + '(') + ';');
  }
  // Only the baseline trigger's required prepared-ticket columns are modeled here.
  await db.exec('create table manual_payment_uploads(id uuid primary key,business_id uuid,request_payload jsonb)');
  if (install) await db.exec(migration);
  return db;
}
const subscription = async (db, id) => (await db.query('select * from business_subscriptions where business_id=$1', [id])).rows[0];
async function trial(db) {
  return seed(db, { status: 'trialing', plan_code: 'mini', billing_cycle: 'monthly', member_limit: 1, channel_limit: 3,
    current_period_start: null, current_period_end: null });
}
async function purchase(db, fixture, options = {}) {
  const expected = options.expected ?? await subscription(db, fixture.businessId);
  const amount = (await db.query("select tenh_expected_subscription_cents('mini','monthly',3,1)::numeric/100 as amount")).rows[0].amount;
  const id = options.id ?? (await db.query('select gen_random_uuid() as id')).rows[0].id;
  if (options.manual) return (await db.query("insert into manual_payment_requests(id,business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit) values($1,$2,'mini','monthly',$3,'USD','submitted',1,3) returning *", [id, fixture.businessId, amount])).rows[0];
  const metadata = { environment: 'sandbox', live_enabled: false, checkout_contract_version: 2,
    ...(options.noExpected ? {} : { _expected_subscription: expected }) };
  return (await db.query("insert into billing_transactions(id,business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,metadata) values($1,$2,'payway',$3,'mini','monthly',$4,'USD','pending',1,3,$5) returning *", [id, fixture.businessId, id, amount, metadata])).rows[0];
}
async function activate(db, row, manual = false) {
  if (manual) return (await db.query('select * from tenh_approve_manual_payment($1)', [row.id])).rows[0];
  const payload = { status: { code: '00', tran_id: row.provider_transaction_id } };
  return (await db.query("select * from tenh_activate_verified_payway_payment($1,$2,$2,'USD','APPROVED',0,'synthetic',$3,true)", [row.provider_transaction_id, row.amount, payload])).rows[0];
}
const invoiceCount = async (db, id) => (await db.query('select count(*)::int as n from tenh_billing_invoices where source_payment_id=$1', [id])).rows[0].n;

test('late normal PayWay approval cannot overwrite a newer plan, paid expiry or cancellation', async () => {
  const db = await database();
  try {
    const fixture = await trial(db), row = await purchase(db, fixture);
    await db.query("update business_subscriptions set status='active',plan_code='pro',member_limit=8,channel_limit=12,current_period_start=now(),current_period_end=now()+interval '1 year',cancel_at_period_end=true where business_id=$1", [fixture.businessId]);
    const before = await subscription(db, fixture.businessId);
    assert.equal((await activate(db, row)).subscription_status, 'recovery_required');
    assert.deepEqual(await subscription(db, fixture.businessId), before);
    assert.equal((await db.query('select status from billing_transactions where id=$1', [row.id])).rows[0].status, 'pending');
    assert.equal(await invoiceCount(db, row.id), 0);
    assert.equal((await db.query("select count(*)::int as n from tenh_billing_private.reconciliation_events where source_payment_id=$1 and kind='recovery_required'", [row.id])).rows[0].n, 1);
  } finally { await db.close(); }
});

test('unchanged original attempt applies once and callback replay preserves later entitlement', async () => {
  const db = await database();
  try {
    const fixture = await trial(db), row = await purchase(db, fixture);
    assert.equal('_expected_subscription' in row.metadata, false);
    assert.equal((await activate(db, row)).subscription_status, 'active');
    assert.equal(await invoiceCount(db, row.id), 1);
    await db.query("update business_subscriptions set plan_code='pro',member_limit=8,channel_limit=12,current_period_end=now()+interval '1 year' where business_id=$1", [fixture.businessId]);
    const before = await subscription(db, fixture.businessId);
    assert.equal((await activate(db, row)).already_approved, true);
    assert.deepEqual(await subscription(db, fixture.businessId), before);
    assert.equal(await invoiceCount(db, row.id), 1);
  } finally { await db.close(); }
});

test('stale preparation snapshot and missing original legacy baseline fail closed', async () => {
  const db = await database(false);
  try {
    const fixture = await trial(db), legacy = await purchase(db, fixture, { noExpected: true });
    await db.exec(migration);
    assert.equal((await activate(db, legacy)).subscription_status, 'recovery_required');
    const another = await trial(db), expected = await subscription(db, another.businessId);
    await db.query('update business_subscriptions set cancel_at_period_end=true where business_id=$1', [another.businessId]);
    await assert.rejects(() => purchase(db, another, { expected }), /changed before payment preparation/);
    await assert.rejects(() => purchase(db, another, { noExpected: true }), /changed before payment preparation/);
    assert.equal((await db.query('select count(*)::int as n from tenh_billing_private.payment_application_baselines where business_id=$1', [another.businessId])).rows[0].n, 0);
  } finally { await db.close(); }
});

test('a separately authorized immutable legacy attempt retains its existing guarded approval path', async () => {
  const db = await database(false);
  try {
    const fixture = await trial(db), row = await purchase(db, fixture, { noExpected: true });
    await db.query("insert into tenh_billing_private.legacy_payway_enrollments(source_payment_id,provider_transaction_id,business_id,payment_identity,subscription_identity,activation_policy,merchant_binding_verified,activation_timezone,review_reference) select b.id,b.provider_transaction_id,b.business_id,tenh_compat_payment_identity(to_jsonb(b)),tenh_compat_subscription_identity(to_jsonb(s)),'captured-v1',true,'UTC','synthetic authoritative review' from billing_transactions b join business_subscriptions s on s.business_id=b.business_id where b.id=$1", [row.id]);
    await db.exec(migration);
    assert.equal((await activate(db, row)).subscription_status, 'active');
    assert.equal(await invoiceCount(db, row.id), 1);
  } finally { await db.close(); }
});

test('manual proof finalization retains the original prepare baseline instead of rebasing to changed state', async () => {
  const db = await database();
  try {
    const fixture = await trial(db), expected = await subscription(db, fixture.businessId);
    const id = (await db.query('select gen_random_uuid() as id')).rows[0].id;
    await db.query('insert into manual_payment_uploads values($1,$2,$3)', [id, fixture.businessId, { _expected_subscription: expected }]);
    const original = (await db.query('select * from tenh_billing_private.payment_application_baselines where source_payment_id=$1', [id])).rows[0];
    await db.query('update business_subscriptions set cancel_at_period_end=true where business_id=$1', [fixture.businessId]);
    const row = await purchase(db, fixture, { manual: true, id });
    assert.deepEqual((await db.query('select * from tenh_billing_private.payment_application_baselines where source_payment_id=$1', [id])).rows[0], original);
    const before = await subscription(db, fixture.businessId);
    assert.equal((await activate(db, row, true)).subscription_status, 'recovery_required');
    assert.deepEqual(await subscription(db, fixture.businessId), before);
    assert.equal(await invoiceCount(db, row.id), 0);
  } finally { await db.close(); }
});

test('unchanged manual approval applies its captured invoice body once before later replay', async () => {
  const db = await database();
  try {
    const fixture = await trial(db), row = await purchase(db, fixture, { manual: true });
    assert.equal((await activate(db, row, true)).subscription_status, 'active');
    assert.equal(await invoiceCount(db, row.id), 1);
    await db.query("update business_subscriptions set plan_code='pro',member_limit=8,channel_limit=12,current_period_end=now()+interval '1 year' where business_id=$1", [fixture.businessId]);
    const before = await subscription(db, fixture.businessId);
    assert.equal((await activate(db, row, true)).already_approved, true);
    assert.deepEqual(await subscription(db, fixture.businessId), before);
    assert.equal(await invoiceCount(db, row.id), 1);
  } finally { await db.close(); }
});

test('invoice failure rolls back source approval and entitlement while preserving review evidence', async () => {
  const db = await database();
  try {
    const fixture = await trial(db), row = await purchase(db, fixture), before = await subscription(db, fixture.businessId);
    await db.exec("create function baseline_fail_invoice() returns trigger language plpgsql as $$begin raise exception 'synthetic invoice failure'; end$$; create trigger baseline_fail_invoice before insert on tenh_billing_invoices for each row execute function baseline_fail_invoice()");
    assert.equal((await activate(db, row)).subscription_status, 'recovery_required');
    assert.deepEqual(await subscription(db, fixture.businessId), before);
    assert.equal((await db.query('select status from billing_transactions where id=$1', [row.id])).rows[0].status, 'pending');
    assert.equal(await invoiceCount(db, row.id), 0);
  } finally { await db.close(); }
});

test('guard readiness detects disabled triggers and private baselines remain service-inaccessible and immutable', async () => {
  const db = await database();
  try {
    assert.equal((await db.query('select tenh_payment_application_guards_ready() as ready')).rows[0].ready, true);
    await db.exec('alter table billing_transactions disable trigger tenh_02_guard_application_baseline');
    assert.equal((await db.query('select tenh_payment_application_guards_ready() as ready')).rows[0].ready, false);
    assert.equal((await db.query("select has_table_privilege('service_role','tenh_billing_private.payment_application_baselines','SELECT') as allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select has_function_privilege('anon','tenh_payment_application_guards_ready()','EXECUTE') as allowed")).rows[0].allowed, false);
    const fixture = await trial(db), row = await purchase(db, fixture);
    await assert.rejects(() => db.query('delete from tenh_billing_private.payment_application_baselines where source_payment_id=$1', [row.id]), /immutable|append-only|cannot/i);
  } finally { await db.close(); }
});
