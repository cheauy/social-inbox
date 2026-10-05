/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

function returnHarness({ status = 'pending', authorized = true, permission = true, transactionPatch = {} } = {}) {
  const db = database({
    billing_transactions: [{
      provider: 'payway', provider_transaction_id: 'saved-transaction',
      business_id: 'paid-workspace', plan_code: 'custom', billing_cycle: 'monthly',
      amount: '35.00', currency: 'USD', status,
      target_channel_limit: 5, target_member_limit: 3, renew_same: false,
      pricing_snapshot: {
        purchase_type: 'custom-upgrade', extension_billing_cycle: 'monthly',
        extension_months: 1, current_billing_cycle: '12-months',
        current_period_end: '2027-01-01T00:00:00.000Z',
        new_period_end: '2027-02-01T00:00:00.000Z',
      },
      ...transactionPatch,
    }],
    team_members: authorized ? [{ id: 'member', role: 'owner', business_id: 'paid-workspace', user_id: 'user', is_active: true }] : [],
    // The subscription can already have activated, expired, changed capacity,
    // or scheduled cancellation; a return must never inspect/requote it.
    business_subscriptions: [{ business_id: 'paid-workspace', status: 'expired',
      plan_code: 'custom', billing_cycle: 'monthly', channel_limit: 30,
      member_limit: 100, cancel_at_period_end: true,
      pricing_snapshot: { purchase_type: 'custom-upgrade', extension_months: 1 } }],
  });
  const noNewCheckout = () => { throw new Error('Return attempted new-checkout logic'); };
  const PaymentView = () => {};
  const load = loader({
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'next/navigation': { redirect: url => { throw new Error(`REDIRECT:${url}`); } },
    '@/components/subscription/subscription-payment-view': { SubscriptionPaymentView: PaymentView },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, user: { id: 'user' }, member: { id: 'current-member', business_id: 'other-workspace', role: 'owner' } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => permission },
    '@/lib/subscription/custom-upgrade': { buildCustomUpgradeQuote: noNewCheckout },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: noNewCheckout },
    '@/lib/subscription/plan-change-security': {
      isPaidPlan: value => ['mini', 'standard', 'pro'].includes(value),
      loadPlanChangeState: noNewCheckout, getPlanPurchaseEligibility: noNewCheckout,
    },
  });
  return {
    db,
    page: load('app/dashboard/subscription/payment/page.tsx').default,
    params: { tran_id: 'saved-transaction', payway: 'approved',
      // Tampered / missing URL presentation never replaces saved purchase data.
      plan: 'pro', cycle: 'invalid', users: '100', connections: '30',
      purchase_business: 'unauthorized-query-workspace' },
  };
}

for (const status of ['pending', 'approved']) {
  test(`${status} return displays saved annual-plus-one-month purchase despite changed subscription`, async () => {
    const app = returnHarness({ status });
    const result = await app.page({ searchParams: Promise.resolve(app.params) });
    const props = result.props.children.props;
    assert.equal(props.planCode, 'custom');
    assert.equal(props.billingCycle, 'monthly');
    assert.equal(props.savedTransactionTotalCents, 3500);
    assert.equal(props.customConnections, 5);
    assert.equal(props.customUsers, 3);
    assert.equal(props.customUpgradeExtensionMonths, 1);
    assert.equal(props.customUpgradeExtensionBillingCycle, 'monthly');
    assert.equal(props.purchaseBusinessId, 'paid-workspace');
    assert.equal(props.initialTransactionId, 'saved-transaction');
    assert.equal(props.initialPayWayReturn, 'returned');
    assert.equal(props.transactionReturnOnly, true);
    assert.equal(app.db.history.filter(x => x.table === 'business_subscriptions').length, 0);
    assert.ok(app.db.history.every(x => x.op === 'read'));
  });
}

for (const options of [{ authorized: false }, { permission: false }]) {
  test(`unauthorized return is rejected (${JSON.stringify(options)})`, async () => {
    const app = returnHarness(options);
    await assert.rejects(() => app.page({ searchParams: Promise.resolve(app.params) }), /REDIRECT:.*billing-permission/);
  });
}

test('unknown transaction return is rejected without attempting new checkout', async () => {
  const app = returnHarness();
  await assert.rejects(() => app.page({ searchParams: Promise.resolve({ tran_id: 'unknown' }) }), /REDIRECT:.*payment_return=unavailable/);
});

test('fixed-plan return displays its saved upgrade charge rather than current catalog price', async () => {
  const app = returnHarness({ transactionPatch: { plan_code: 'standard', amount: '12.00', pricing_snapshot: { purchase_type: 'upgrade' } } });
  const result = await app.page({ searchParams: Promise.resolve(app.params) });
  assert.equal(result.props.children.props.savedTransactionTotalCents, 1200);
  assert.equal(result.props.children.props.planCode, 'standard');
});
