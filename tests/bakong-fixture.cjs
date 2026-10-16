/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module'), { randomUUID, createHash } = require('node:crypto');
const { loader } = require('./tenh-seven/harness.cjs');
const load = loader({ 'server-only': {} });
const { getTrustedPlan, buildPurchaseRecord } = load('lib/billing/subscription-purchase.ts');

async function database(installBakong = true, repairRequestTime = true, installGeneral = true, installLifecycle = installBakong && repairRequestTime && installGeneral) {
  const filename = path.resolve('tests/payway-application-baseline.test.cjs');
  const source = fs.readFileSync(filename, 'utf8');
  const moduleFixture = { exports: {} };
  vm.runInNewContext(source.slice(0, source.indexOf("test('late normal PayWay")) + '\nmodule.exports={database,trial};',
    { require: createRequire(filename), module: moduleFixture, process, console, __dirname: path.dirname(filename), __filename: filename });
  const db = await moduleFixture.exports.database(false);
  // Match hosted billing: every writer must supply this UTC timestamp, with no fallback default.
  await db.exec('alter table billing_transactions add column request_time text not null');
  await db.exec('drop table manual_payment_uploads; alter table team_members add primary key(id); alter table team_members add column created_at timestamptz default now(); alter table businesses add primary key(id);');
  await db.exec(fs.readFileSync('db/migrations/20261015104508_manual_payment_upload_lifecycle.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261015113000_payment_application_baselines.sql', 'utf8'));
  if (installBakong) {
    await db.exec(fs.readFileSync('db/migrations/20261015140343_bakong_subscription_payments.sql', 'utf8'));
    if (installGeneral && repairRequestTime) await db.exec(fs.readFileSync('db/migrations/20261016043734_bakong_scoped_pilot.sql', 'utf8'));
    if (repairRequestTime) await db.exec(fs.readFileSync('db/migrations/20261016063606_bakong_request_time.sql', 'utf8'));
    if (installGeneral && repairRequestTime) await db.exec(fs.readFileSync('db/migrations/20261016070506_bakong_general_authorization.sql', 'utf8'));
    if (installLifecycle === 'atomic') await atomicLifecycle(db);
    else if (installLifecycle) await lifecycle(db);
  }
  return { db, trial: () => moduleFixture.exports.trial(db) };
}
// Payment cancellation ledger and KHQR checkout lifecycle, with the hosted columns they read.
async function lifecycle(db) {
  await db.exec("alter table team_members add column if not exists permissions jsonb default '{}'");
  await db.exec(`alter table manual_payment_requests
    add column if not exists transfer_reference text, add column if not exists customer_note text,
    add column if not exists proof_bucket text, add column if not exists proof_path text,
    add column if not exists proof_file_name text, add column if not exists proof_mime_type text,
    add column if not exists proof_size_bytes bigint`);
  await db.exec(fs.readFileSync('db/migrations/20261016083154_payment_cancellation_safety.sql', 'utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261016093000_bakong_checkout_lifecycle.sql', 'utf8'));
}
async function atomicLifecycle(db) {
  // Match the already installed CHAT columns; the proposal itself adds no missing legacy columns.
  await db.exec("alter table team_members add column if not exists permissions jsonb default '{}'");
  await db.exec(fs.readFileSync('db/proposals/20261016111054_khqr_checkout_cancellation_atomic.sql', 'utf8'));
}
async function prepare(ctx, options = {}) {
  const seeded = await ctx.trial(), businessId = seeded.businessId;
  const userId = randomUUID(), memberId = randomUUID(), id = randomUUID(), intentId = randomUUID();
  await ctx.db.query("insert into team_members(id,user_id,business_id,role,is_active) values($1,$2,$3,'owner',true)", [memberId, userId, businessId]);
  const subscription = (await ctx.db.query('select * from business_subscriptions where business_id=$1', [businessId])).rows[0];
  const quote = getTrustedPlan('mini', 'monthly', null, null, false, false, 'none', subscription);
  assert.ok(quote);
  const record = buildPurchaseRecord(id, businessId, memberId, quote, subscription);
  const qr = 'synthetic-offline-qr:' + id, md5 = createHash('md5').update(qr).digest('hex'), reference = 'TC' + id.replaceAll('-', '').slice(0, 22);
  const fingerprint = 'f'.repeat(64), environment = options.environment ?? 'sandbox', recipient = 'merchant@devb';
  if (options.approvedCapacity) await ctx.db.query("insert into tenh_bakong_private.capacity_reviews values($1,$2,'production',true,100,100,20,'synthetic reviewed capacity',$3,now()) on conflict do nothing", [fingerprint, recipient, userId]);
  const args = [record, userId, memberId, intentId, { planCode: 'mini', billingCycle: 'monthly' }, environment, fingerprint, recipient, qr, md5, reference, new Date(Date.now() + (options.expiryMs ?? 600000)).toISOString(), 90];
  const invoke = () => ctx.db.query('select tenh_prepare_bakong_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as result', args);
  return { attempt: (await invoke()).rows[0].result, invoke, userId, memberId, businessId, amount: record.amount, fingerprint, args };
}
async function settle(ctx, purchase, hash = 'a'.repeat(64)) {
  const claim = (await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) as result', [purchase.attempt.id, purchase.fingerprint])).rows[0].result;
  assert.equal(claim.claimed, true);
  const observation = { state: 'paid', settlement: { md5: purchase.attempt.md5, hash, recipient: purchase.attempt.recipient,
    amount: purchase.amount, currency: 'USD', environment: purchase.attempt.environment } };
  const result = await ctx.db.query('select tenh_complete_bakong_check($1,$2,$3,$4) as result', [purchase.attempt.id, claim.claimId, observation, purchase.userId]);
  return { result: result.rows[0].result, claim, observation };
}


module.exports={database,prepare,settle};
