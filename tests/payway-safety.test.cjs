/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./tenh-seven/harness.cjs');

test('payment page never trusts a success query parameter without a transaction to verify', () => {
  const source = fs.readFileSync(
    'components/subscription/subscription-payment-view.tsx',
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /initialPayWayReturn\s*===\s*["']approved["']\s*\?\s*["']approved["']/,
  );
});

test('checkout never supersedes a transaction unless PayWay confirmed it closed', () => {
  const source = fs.readFileSync(
    'app/api/payway/checkout/route.ts',
    'utf8',
  );
  const closeGuard = source.indexOf('if (!closeResult.closed)');
  const localCancellation = source.indexOf(
    'provider_status: "SUPERSEDED_BY_NEW_CHECKOUT"',
  );

  assert.notEqual(closeGuard, -1);
  assert.notEqual(localCancellation, -1);
  assert.ok(closeGuard < localCancellation);
  assert.match(source, /if \(cancelPreviousError\)/);
  assert.match(source, /if \(!cancelledPrevious\)/);
  assert.match(source, /transactionError\.code === "23505"/);
});

test('draft database guard permits only one pending PayWay checkout per workspace', () => {
  const sql = fs.readFileSync(
    'db/migrations/20261010_payway_single_pending_checkout.sql',
    'utf8',
  );

  assert.match(
    sql,
    /create unique index[\s\S]*on public\.billing_transactions \(business_id\)[\s\S]*where provider = 'payway'[\s\S]*status = 'pending'/i,
  );
});

test('draft optional-extension migration preserves legacy validation and guards stale activation', () => {
  const sql = fs.readFileSync(
    'db/migrations/20261011_custom_upgrade_optional_extension.sql',
    'utf8',
  );

  assert.match(sql, /REVIEW DRAFT ONLY/i);
  assert.match(sql, /tenh_validate_custom_upgrade_purchase/i);
  assert.match(sql, /execute function public\.tenh_validate_plan_purchase\(\)/i);
  assert.match(sql, /TENH_CUSTOM_UPGRADE_BASELINE_CHANGED/);
  assert.match(sql, /extension_months[^\n]*\(0\|1\|3\|6\|12\)/i);
  assert.match(sql, /tenh_set_custom_upgrade_invoice_period/i);
  assert.match(sql, /channel_limit between 3 and 30 and member_limit between 1 and 100/i);
});

function customUpgradeQuote(extensionBillingCycle, targetConnections = 5) {
  const load = loader();
  const { buildCustomUpgradeQuote } = load(
    'lib/subscription/custom-upgrade.ts',
  );

  return buildCustomUpgradeQuote({
    subscription: {
      status: 'active',
      plan_code: 'mini',
      billing_cycle: 'monthly',
      member_limit: 1,
      channel_limit: 3,
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
      pricing_snapshot: {},
    },
    targetConnections,
    targetUsers: 1,
    targetBillingCycle:
      extensionBillingCycle === 'none'
        ? 'monthly'
        : extensionBillingCycle,
    extensionBillingCycle,
    now: new Date('2026-09-16T00:00:00.000Z'),
  });
}

test('custom capacity-only upgrade prorates the remaining actual paid term and preserves expiry', () => {
  const quote = customUpgradeQuote('none');

  assert.equal(quote.capacityProrationCents, 400);
  assert.equal(quote.durationExtensionCents, 0);
  assert.equal(quote.totalCents, 400);
  assert.equal(quote.extensionMonths, 0);
  assert.equal(quote.newPeriodEnd, quote.currentPeriodEnd);
});

test('custom upgrade can independently add one discounted billing duration after current expiry', () => {
  const monthly = customUpgradeQuote('monthly');
  const quarterly = customUpgradeQuote('3-months');

  assert.equal(monthly.capacityProrationCents, 400);
  assert.equal(monthly.durationExtensionCents, 2100);
  assert.equal(monthly.totalCents, 2500);
  assert.equal(monthly.newPeriodEnd, '2026-11-01T00:00:00.000Z');

  assert.equal(quarterly.capacityProrationCents, 400);
  assert.equal(quarterly.durationExtensionCents, 5985);
  assert.equal(quarterly.totalCents, 6385);
  assert.equal(quarterly.newPeriodEnd, '2027-01-01T00:00:00.000Z');
});

test('custom duration-only extension charges the selected target capacity price', () => {
  const quote = customUpgradeQuote('monthly', 3);

  assert.equal(quote.capacityProrationCents, 0);
  assert.equal(quote.durationExtensionCents, 1300);
  assert.equal(quote.totalCents, 1300);
});

test('repeat capacity quote preserves separate annual and monthly paid discounts', () => {
  const { buildCustomUpgradeQuote } = loader()('lib/subscription/custom-upgrade.ts');
  const segments = [
    { start_at:'2026-01-01T00:00:00.000Z',end_at:'2027-01-01T00:00:00.000Z',months:12,discount_basis_points:2000,source_type:'subscription-period',source_payment_id:null },
    { start_at:'2027-01-01T00:00:00.000Z',end_at:'2027-02-01T00:00:00.000Z',months:1,discount_basis_points:0,source_type:'billing_transactions',source_payment_id:'original-extension' },
  ];
  const quote=buildCustomUpgradeQuote({
    subscription:{status:'active',plan_code:'custom',billing_cycle:'monthly',member_limit:3,channel_limit:5,
      current_period_start:segments[0].start_at,current_period_end:segments[1].end_at,
      pricing_snapshot:{purchase_type:'custom-upgrade',extension_months:1,paid_term_basis_version:1,paid_term_segments:segments}},
    targetConnections:6,targetUsers:3,targetBillingCycle:'monthly',extensionBillingCycle:'none',
    now:new Date('2026-12-01T00:00:00.000Z'),
  });
  assert.equal(quote.capacityProrationCents,726);
  assert.equal(quote.totalCents,726);
  assert.equal(quote.newPeriodEnd,'2027-02-01T00:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(quote.paidTermSegments)),segments);
});

test('custom upgrade rejects an unknown extension duration', () => {
  assert.throws(
    () => customUpgradeQuote('2-months'),
    /Billing duration is not available/i,
  );
});

test('keep-expiry null extension preserves the current cycle and binds a single quote instant', () => {
  const { buildCustomUpgradeQuote } = loader()('lib/subscription/custom-upgrade.ts');
  const args = {
    subscription: {
      status: 'active', plan_code: 'mini', billing_cycle: 'monthly',
      member_limit: 1, channel_limit: 3, pricing_snapshot: {},
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-10-01T00:00:00.000Z',
    },
    targetConnections: 5, targetUsers: 1, targetBillingCycle: 'monthly',
    extensionBillingCycle: null,
    now: new Date('2026-09-16T00:00:00.123Z'),
  };
  const quote = buildCustomUpgradeQuote(args);
  assert.equal(quote.quotedAt, args.now.toISOString());
  assert.equal(quote.extensionMonths, 0);
  assert.equal(quote.totalCents, 400);
  assert.throws(() => buildCustomUpgradeQuote({ ...args, targetBillingCycle: '3-months' }), /Renewal duration/);
  assert.throws(() => buildCustomUpgradeQuote({ ...args, subscription: { ...args.subscription, cancel_at_period_end: true } }), /scheduled subscription change/);
  assert.throws(() => buildCustomUpgradeQuote({ ...args, subscription: { ...args.subscription, pending_plan_change_type: 'downgrade' } }), /scheduled subscription change/);
  assert.throws(() => buildCustomUpgradeQuote({ ...args, subscription: { ...args.subscription, pricing_snapshot: { purchase_type: 'custom-upgrade', extension_months: 1 } } }), /combined paid terms/);
});

test('custom upgrade UI carries the independent extension choice into checkout', () => {
  const modal = fs.readFileSync(
    'components/subscription/custom-upgrade-modal.tsx',
    'utf8',
  );
  const payment = fs.readFileSync(
    'components/subscription/subscription-payment-view.tsx',
    'utf8',
  );

  assert.match(modal, /Keep current expiry/);
  assert.match(modal, /extension:\s*cycle/);
  assert.match(payment, /extensionBillingCycle:\s*customUpgradeExtensionBillingCycle/);
});

test('published capacity pricing stays monotonic across all 2800 supported combinations', () => {
  const { calculateCapacityMonthlyCents } = loader()('lib/subscription/plan-catalog.ts');
  for (let connections = 3; connections <= 30; connections++) {
    for (let users = 1; users <= 100; users++) {
      const actual = calculateCapacityMonthlyCents(connections, users);
      const expected = Math.min(
        1300 + Math.max(0, connections - 3) * 400 + Math.max(0, users - 1) * 300,
        2500 + Math.max(0, connections - 5) * 400 + Math.max(0, users - 3) * 300,
        5900 + Math.max(0, connections - 12) * 400 + Math.max(0, users - 8) * 300,
      );
      assert.equal(actual, expected, `${connections} connections / ${users} users`);
      if (connections < 30) assert.ok(actual <= calculateCapacityMonthlyCents(connections + 1, users));
      if (users < 100) assert.ok(actual <= calculateCapacityMonthlyCents(connections, users + 1));
    }
  }
  assert.equal(calculateCapacityMonthlyCents(11, 8), 5900);
});

test('purchase hash stays pinned to the reviewed PayWay field order', () => {
  const { createPayWayPurchaseHash } = loader()(
    'lib/payway/purchase-hash.ts',
  );
  const hash = createPayWayPurchaseHash(
    {
      req_time: '20261002010203',
      merchant_id: 'merchant-test',
      tran_id: '1760000000123456789',
      amount: '13.00',
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@example.com',
      type: 'purchase',
      payment_option: 'abapay_khqr',
      return_url: 'https://app.example/api/payway/callback',
      cancel_url: 'https://app.example/cancel',
      continue_success_url: 'https://app.example/success',
      currency: 'USD',
      lifetime: '5',
    },
    'test-secret',
  );

  assert.equal(
    hash,
    'XonNYyimgCRT4kmuHDqG0VuP/vM4Lkw81PwiHW4LmTRWRE4R+IZBI87XJscbVP1+xuus/S7Oi00LfA+BhfXFRA==',
  );
});

test('callback signature follows the sorted-key PayWay contract', () => {
  const { verifyPayWayCallbackSignature } = loader({}, { Buffer })(
    'lib/payway/verify-callback.ts',
  );
  const payload = {
    tran_id: '1760000000123456789',
    apv: '123456',
    status: '0',
    original_amount: 13,
    original_currency: 'USD',
  };

  assert.equal(
    verifyPayWayCallbackSignature(
      payload,
      '9t37HlJ5FMJCnm2P0Lz7rux2PPYbIWx2YaXmMd3qIQ/zJ/Y+UGBf45ljLo1NEX1u1lRjK6tFldF7AnkOBaFcJA==',
      'test-secret',
    ),
    true,
  );
  assert.equal(
    verifyPayWayCallbackSignature(
      { ...payload, original_amount: 13.01 },
      '9t37HlJ5FMJCnm2P0Lz7rux2PPYbIWx2YaXmMd3qIQ/zJ/Y+UGBf45ljLo1NEX1u1lRjK6tFldF7AnkOBaFcJA==',
      'test-secret',
    ),
    false,
  );
});

function finalizerHarness(providerPatch = {}, transactionPatch = {}, rpcPatch = {}) {
  const transaction = {
    id: 'billing-1',
    business_id: 'business-1',
    provider_transaction_id: '1760000000123456789',
    plan_code: 'mini',
    billing_cycle: 'monthly',
    amount: '13.00',
    currency: 'USD',
    status: 'pending',
    metadata: {},
    ...transactionPatch,
  };
  const rpcCalls = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    maybeSingle: async () => ({ data: transaction, error: null }),
  };
  const supabaseAdmin = {
    from(name) {
      assert.equal(name, 'billing_transactions');
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === 'tenh_observe_payway_verification') return { data: { payment_state: args.p_observation.conflict_reason?'recovery_required':transaction.status, ...rpcPatch }, error: null };
      return {
        data: [{
          already_approved: false,
          plan_code: transaction.plan_code,
          subscription_status: 'active',
          current_period_end: '2026-11-02T00:00:00.000Z',
          member_limit: 1,
          channel_limit: 3,
          ...rpcPatch,
        }],
        error: null,
      };
    },
  };
  const provider = {
    data: {
      payment_status_code: 0,
      original_amount: 13,
      payment_amount: 13,
      payment_currency: 'USD',
      apv: '123456',
      payment_status: 'APPROVED',
      ...providerPatch.data,
    },
    status: {
      code: '00',
      message: 'Success!',
      tran_id: transaction.provider_transaction_id,
      ...providerPatch.status,
    },
  };
  const load = loader({
    '@/lib/supabase/admin': { supabaseAdmin },
    '@/lib/payway/check-transaction': {
      checkPayWayTransaction: async () => ({
        reqTime: '20261002010203',
        response: provider,
      }),
    },
  });

  return {
    finalize: load('lib/payway/finalize-payment.ts')
      .verifyAndFinalizePayWayTransaction,
    rpcCalls,
  };
}

test('approved provider response cannot activate a different amount', async () => {
  const app = finalizerHarness({ data: { original_amount: 12.99 } });

  assert.equal((await app.finalize('1760000000123456789','callback')).paymentState,'recovery_required');
  assert.equal(app.rpcCalls.length,1);assert.equal(app.rpcCalls[0].name,'tenh_observe_payway_verification');
  assert.equal(app.rpcCalls[0].args.p_observation.conflict_reason,'PROVIDER_APPROVED_AMOUNT_MISMATCH');
});

test('approved provider response must bind to the requested transaction id', async () => {
  const app = finalizerHarness({ status: { tran_id: 'different' } });

  assert.equal((await app.finalize('1760000000123456789','callback')).paymentState,'recovery_required');
  assert.equal(app.rpcCalls.length,1);assert.equal(app.rpcCalls[0].name,'tenh_observe_payway_verification');
  assert.equal(app.rpcCalls[0].args.p_observation.conflict_reason,'PROVIDER_APPROVED_TRANSACTION_ID_MISMATCH');
});

test('only the signed USD billing currency can reach activation', async () => {
  const app = finalizerHarness({}, { currency: 'KHR' });

  assert.equal((await app.finalize('1760000000123456789','callback')).paymentState,'recovery_required');
  assert.equal(app.rpcCalls.length,1);assert.equal(app.rpcCalls[0].name,'tenh_observe_payway_verification');
  assert.equal(app.rpcCalls[0].args.p_observation.conflict_reason,'SIGNED_BILLING_CURRENCY_MISMATCH');
});

test('matching approved response reaches the atomic activation boundary once', async () => {
  const app = finalizerHarness();
  const result = await app.finalize(
    '1760000000123456789',
    'callback',
  );

  assert.equal(result.paymentState, 'approved');
  assert.equal(app.rpcCalls.length, 1);
  assert.equal(
    app.rpcCalls[0].name,
    'tenh_activate_verified_payway_payment',
  );
});

test('legacy approval recovery is never returned as a paid subscription',async()=>{
 const app=finalizerHarness({}, {}, {subscription_status:'recovery_required'});
 const result=await app.finalize('1760000000123456789','callback');
 assert.equal(result.paymentState,'recovery_required');assert.equal(result.subscription,undefined);
 assert.equal(app.rpcCalls.length,1);
});

for(const amount of [undefined,null,''])test('approved response missing its amount records recovery: '+String(amount),async()=>{
 const app=finalizerHarness({data:{original_amount:amount}});
 const result=await app.finalize('1760000000123456789','callback');assert.equal(result.paymentState,'recovery_required');
 assert.equal(app.rpcCalls.length,1);assert.equal(app.rpcCalls[0].args.p_observation.conflict_reason,'PROVIDER_APPROVED_AMOUNT_MISSING');
});

for(const status of ['pending','failed','cancelled'])test('unverified inquiry records recovery for saved '+status+' state',async()=>{
 const app=finalizerHarness({status:{code:'6'},data:{payment_status:null,payment_status_code:null}}, {status});
 const result=await app.finalize('1760000000123456789','callback');
 assert.equal(result.paymentState,'recovery_required');assert.equal(app.rpcCalls.length,1);
 const call=app.rpcCalls[0];assert.equal(call.name,'tenh_observe_payway_verification');
 assert.equal(call.args.p_callback_received,true);assert.equal(call.args.p_observation.provider_status_code,'6');
 assert.equal(call.args.p_observation.provider_transaction_id,'1760000000123456789');
 assert.equal(call.args.p_observation.conflict_reason,'PROVIDER_INQUIRY_NOT_VERIFIED');
});

test('an approved status without its provider approval code records recovery and never activates',async()=>{
 const app=finalizerHarness({data:{payment_status_code:null}});
 assert.equal((await app.finalize('1760000000123456789','callback')).paymentState,'recovery_required');
 assert.equal(app.rpcCalls[0].name,'tenh_observe_payway_verification');assert.equal(app.rpcCalls[0].args.p_observation.conflict_reason,'PROVIDER_APPROVAL_STATUS_INCOMPLETE');
});
