/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic PostgreSQL only: no hosted connection, credentials, provider or browser requests.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), { randomUUID, createHash } = require('node:crypto');
const { database, prepare } = require('./bakong-fixture.cjs');
const { loader } = require('./tenh-seven/harness.cjs');
const pricing = loader()('lib/billing/subscription-purchase.ts');
const repair = fs.readFileSync('db/migrations/20261016063606_bakong_request_time.sql', 'utf8');
const pilot = fs.readFileSync('db/migrations/20261016043734_bakong_scoped_pilot.sql', 'utf8');
const SIGNATURE = 'public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)';
const USER = '6b84cd6d-deb5-4191-b1c6-0f3861eda892', BUSINESS = 'f79eeac0-db5e-4f3f-8783-2dfb9b818dd9';
const metadata = async db => (await db.query("select oid,proacl::text acl,proowner,prosecdef,proconfig,replace(pg_get_functiondef(oid),E'\\r\\n',E'\\n') source from pg_proc where oid=$1::regprocedure", [SIGNATURE])).rows[0];
const financial = async db => (await db.query("select n.nspname,p.proname,p.oid,md5(pg_get_functiondef(p.oid)) source,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tenh_billing_private','tenh_bakong_private') and p.oid<>$1::regprocedure order by p.oid", [SIGNATURE])).rows;
const counts = async db => (await db.query("select (select count(*)::int from billing_transactions) billing,(select count(*)::int from bakong_payment_attempts) attempts,(select count(*)::int from tenh_bakong_private.provider_calls) calls,(select count(*)::int from tenh_billing_invoices) invoices")).rows[0];

function assertOnlyTimestampChanged(before, after) {
  assert.deepEqual({ ...after, source: null }, { ...before, source: null }, 'OID, owner, ACL and security settings remain exact');
  const expected = before.source.replace('pricing_version,renew_same,pricing_snapshot,metadata)', 'pricing_version,renew_same,pricing_snapshot,request_time,metadata)')
    .replace("(p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',jsonb_build_object(", "(p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MISS'),jsonb_build_object(");
  assert.equal(after.source, expected, 'the complete surrounding body is preserved');
}

test('hosted NOT NULL/no-default requirement reproduces the old ordinary failure; repair supplies UTC time and retains one attempt', async () => {
  const ctx = await database(true, false);
  try {
    const column = (await ctx.db.query("select data_type,is_nullable,column_default from information_schema.columns where table_name='billing_transactions' and column_name='request_time'")).rows[0];
    assert.deepEqual(column, { data_type: 'text', is_nullable: 'NO', column_default: null });
    await assert.rejects(prepare(ctx), error => error.code === '23502' && /request_time/.test(error.message));
    assert.deepEqual(await counts(ctx.db), { billing: 0, attempts: 0, calls: 0, invoices: 0 });
    const before = await metadata(ctx.db), otherFunctions = await financial(ctx.db);
    await ctx.db.exec(repair);
    assertOnlyTimestampChanged(before, await metadata(ctx.db)); assert.deepEqual(await financial(ctx.db), otherFunctions);
    // Session timezone cannot alter the UTC writer convention.
    await ctx.db.exec("set time zone 'Asia/Phnom_Penh'");
    const p = await prepare(ctx), beforeRepeat = await counts(ctx.db);
    const row = (await ctx.db.query("select request_time,request_time=to_char(created_at at time zone 'UTC','YYYYMMDDHH24MISS') utc from billing_transactions where id=$1", [p.attempt.id])).rows[0];
    assert.match(row.request_time, /^\d{14}$/); assert.equal(row.utc, true);
    const replies = await Promise.all([p.invoke(), p.invoke()]); assert.ok(replies.every(r => r.rows[0].result.id === p.attempt.id));
    assert.deepEqual(await counts(ctx.db), beforeRepeat);
    const fixed = await metadata(ctx.db); await ctx.db.exec(repair); assert.deepEqual(await metadata(ctx.db), fixed);
  } finally { await ctx.db.close(); }
});

test('repair preserves the installed pilot wrapper, rollback, authorization and exactly one issued obligation', async () => {
  const ctx = await database(true, false);
  try {
    await ctx.db.exec(pilot);
    const seeded = await ctx.trial(), member = randomUUID(), id = randomUUID(), intent = randomUUID();
    await ctx.db.query("update business_subscriptions set business_id=$1,status='active',plan_code='pro',billing_cycle='12-months',member_limit=8,channel_limit=12,current_period_start='2026-08-21T10:03:56.418985Z',current_period_end='2027-08-21T10:03:56.418985Z',pricing_snapshot='{}' where business_id=$2", [BUSINESS, seeded.businessId]);
    await ctx.db.query("insert into team_members(id,user_id,business_id,role,is_active) values($1,$2,$3,'owner',true)", [member, USER, BUSINESS]);
    const subscription = async () => (await ctx.db.query('select row_to_json(s) s from business_subscriptions s where business_id=$1', [BUSINESS])).rows[0].s;
    const baseline = await subscription(), trusted = pricing.getTrustedPlan('custom', '12-months', 13, 8, false, true, 'none', baseline);
    assert.ok(trusted);
    const fingerprint = 'f'.repeat(64), recipient = 'synthetic@devb', qr = 'synthetic-offline-qr:' + id;
    await ctx.db.query(`with stamp as (select clock_timestamp() t)
      insert into tenh_bakong_private.pilot_authorizations(user_id,business_id,member_id,credential_fingerprint,recipient,baseline,approved_quote,approved_max_cents,approved_by,approval_reference,authorized_at,issue_until,inquiry_until,quota_source,reported_daily_limit,dedicated_token_attested,provider_eligibility,attestation_reference)
      select $1,$2,$3,$4,$5,tenh_compat_subscription_identity($6),$7,$8,$1,'synthetic approval',t,t+interval '30 minutes',t+interval '1 hour','user-attested',100,true,'not-independently-verified','synthetic attestation' from stamp`,
    [USER, BUSINESS, member, fingerprint, recipient, baseline, trusted.customUpgradeQuote, trusted.quote.totalCents]);
    const record = pricing.buildPurchaseRecord(id, BUSINESS, member, trusted, baseline);
    const args = [record, USER, member, intent, { planCode: 'custom', billingCycle: '12-months', connections: 13, users: 8, renewSame: false, customUpgrade: true, extensionBillingCycle: 'none' }, 'production', fingerprint, recipient, qr, createHash('md5').update(qr).digest('hex'), 'SYNTHETIC', new Date(Date.now() + 900000).toISOString(), 90];
    const invoke = () => ctx.db.query('select tenh_prepare_bakong_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) result', args);
    const approval = async () => (await ctx.db.query('select * from tenh_bakong_private.pilot_authorizations')).rows[0];
    const unused = await approval(), before = await metadata(ctx.db), otherFunctions = await financial(ctx.db);
    await assert.rejects(invoke(), error => error.code === '23502' && /request_time/.test(error.message));
    assert.deepEqual(await approval(), unused); assert.deepEqual(await subscription(), baseline);
    await ctx.db.exec(repair); assertOnlyTimestampChanged(before, await metadata(ctx.db)); assert.deepEqual(await financial(ctx.db), otherFunctions);
    await ctx.db.exec("create function fixture_later_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic later failure'; end$$; create trigger fixture_later_failure after insert on bakong_payment_attempts for each row execute function fixture_later_failure()");
    await assert.rejects(invoke(), /synthetic later failure/);
    assert.deepEqual(await approval(), unused); assert.deepEqual(await subscription(), baseline);
    assert.deepEqual(await counts(ctx.db), { billing: 0, attempts: 0, calls: 0, invoices: 0 });
    await ctx.db.exec('drop trigger fixture_later_failure on bakong_payment_attempts');
    const a = (await invoke()).rows[0].result; assert.equal(a.id, id); assert.equal(a.pilot_authorization_id, unused.id);
    const row = (await ctx.db.query('select request_time from billing_transactions where id=$1', [id])).rows[0]; assert.match(row.request_time, /^\d{14}$/);
    const replies = await Promise.all([invoke(), invoke()]); assert.ok(replies.every(r => r.rows[0].result.id === id));
    assert.deepEqual(await counts(ctx.db), { billing: 1, attempts: 1, calls: 0, invoices: 0 }); assert.deepEqual(await subscription(), baseline);
    const consumed = await approval(); assert.equal(consumed.attempt_id, id); assert.deepEqual(consumed.issue_until, unused.issue_until); assert.deepEqual(consumed.inquiry_until, unused.inquiry_until);
    args[4] = { ...args[4], users: 9 }; await assert.rejects(invoke(), /immutable/);
  } finally { await ctx.db.close(); }
});

test('unknown installed body aborts repair without rewriting it or touching data', async () => {
  const ctx = await database(true, false);
  try {
    const before = await metadata(ctx.db);
    await ctx.db.exec(before.source.replace('if used+reserved+3>', 'if used + reserved + 3 >'));
    const unknown = await metadata(ctx.db), state = await counts(ctx.db);
    await assert.rejects(ctx.db.exec(repair), /Review the installed Bakong preparation contract/); await ctx.db.exec('rollback');
    assert.deepEqual(await metadata(ctx.db), unknown); assert.deepEqual(await counts(ctx.db), state);
  } finally { await ctx.db.close(); }
});
