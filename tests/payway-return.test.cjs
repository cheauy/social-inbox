/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS route harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

function returnHarness() {
  const effects = [];
  function PaymentAttemptView() {}
  function SubscriptionPaymentView() {}
  const unexpected = label => () => { effects.push(label); throw new Error(`Unexpected ${label}`); };
  const load = loader({
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'next/navigation': { redirect: url => { throw new Error(`REDIRECT:${url}`); } },
    '@/components/subscription/payment-attempt-view': { PaymentAttemptView },
    '@/components/subscription/subscription-payment-view': { SubscriptionPaymentView },
    '@/lib/supabase/admin': { supabaseAdmin: { from: unexpected('database lookup') } },
    '@/lib/auth/get-current-member': { getCurrentMember: unexpected('selected-workspace auth') },
    '@/lib/auth/require-permission': { memberHasPermission: unexpected('checkout permission') },
    '@/lib/subscription/custom-upgrade': { buildCustomUpgradeQuote: unexpected('new quote') },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: unexpected('lifecycle mutation') },
  });
  return { effects, PaymentAttemptView, page: load('app/dashboard/subscription/payment/page.tsx').default };
}

for (const [query, kind, attemptId] of [
  [{ tran_id: 'saved-transaction' }, 'payway', 'saved-transaction'],
  [{ manual_request: '00000000-0000-4000-8000-000000000001' }, 'manual', '00000000-0000-4000-8000-000000000001'],
]) {
  test(`exact ${kind} status delegates saved data and independent authorization before checkout`, async () => {
    const app = returnHarness();
    const result = await app.page({ searchParams: Promise.resolve({
      ...query, payway: 'approved', plan: 'pro', cycle: 'invalid', users: '100', connections: '30',
      purchase_business: 'unrelated-workspace',
    }) });
    const view = result.props.children;
    assert.equal(view.type, app.PaymentAttemptView);
    assert.deepEqual(Object.keys(view.props).sort(), ['attemptId', 'kind']);
    assert.equal(view.props.kind, kind);
    assert.equal(view.props.attemptId, attemptId);
    assert.deepEqual(app.effects, []);
  });
}

test('missing and malformed exact attempt identifiers still reach the non-disclosing status endpoint', async () => {
  for (const params of [{ tran_id: 'unknown' }, { manual_request: 'not-a-uuid' }]) {
    const app = returnHarness();
    assert.equal((await app.page({ searchParams: Promise.resolve(params) })).props.children.type, app.PaymentAttemptView);
    assert.deepEqual(app.effects, []);
  }
});

test('duplicate exact query values use the first value and manual request identity is deterministic', async () => {
  const app = returnHarness();
  const result = await app.page({ searchParams: Promise.resolve({ manual_request: ['manual-first', 'manual-second'], tran_id: 'other-attempt' }) });
  assert.equal(result.props.children.props.kind, 'manual');
  assert.equal(result.props.children.props.attemptId, 'manual-first');
  assert.deepEqual(app.effects, []);
});

test('an approval query without an exact identifier cannot bypass ordinary checkout authorization', async () => {
  const app = returnHarness();
  await assert.rejects(() => app.page({ searchParams: Promise.resolve({ payway: 'approved', manual: 'approved', plan: 'mini', cycle: 'monthly' }) }), /Unexpected selected-workspace auth/);
  assert.deepEqual(app.effects, ['selected-workspace auth']);
});

function checkoutHarness({ manual = [], payway = [], permission = true, authorized = true } = {}) {
  const effects = [];
  const db = database({
    manual_payment_requests: manual, billing_transactions: payway,
    team_members: authorized ? [{ id: 'target-member', role: 'owner', business_id: 'target-workspace', user_id: 'user', is_active: true }] : [],
  });
  const load = loader({
    'next/navigation': { redirect: url => { throw new Error(`REDIRECT:${url}`); } },
    '@/components/subscription/payment-attempt-view': { PaymentAttemptView() {} },
    '@/components/subscription/subscription-payment-view': { SubscriptionPaymentView() {} },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, user: { id: 'user' }, member: { id: 'current-member', business_id: 'current-workspace', role: 'owner' } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => permission },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: async () => { effects.push('lifecycle'); } },
    '@/lib/subscription/plan-change-security': {
      isPaidPlan: value => ['mini', 'standard', 'pro'].includes(value),
      loadPlanChangeState: async () => { throw new Error('REACHED_NEW_CHECKOUT'); },
      getPlanPurchaseEligibility: () => { throw new Error('Unexpected quote'); },
    },
  });
  return { db, effects, page: load('app/dashboard/subscription/payment/page.tsx').default,
    params: { plan: 'mini', cycle: 'monthly', purchase_business: 'target-workspace' } };
}

for (const [kind, rows, destination] of [
  ['manual', { manual: [{ id: 'saved-request', business_id: 'target-workspace', status: 'submitted' }] }, 'manual_request=saved-request'],
  ['payway', { payway: [{ provider: 'payway', provider_transaction_id: 'saved-transaction', business_id: 'target-workspace', status: 'pending' }] }, 'tran_id=saved-transaction'],
]) {
  test(`old checkout restores unresolved ${kind} in the authorized target before lifecycle or repricing`, async () => {
    const app = checkoutHarness(rows);
    await assert.rejects(() => app.page({ searchParams: Promise.resolve(app.params) }), error => error.message === `REDIRECT:/dashboard/subscription/payment?${destination}`);
    assert.deepEqual(app.effects, []);
    assert.ok(app.db.history.every(entry => entry.op === 'read'));
  });
}

test('historical terminal attempts and another workspace pending attempt cannot replace a new checkout', async () => {
  const app = checkoutHarness({
    manual: [{ id: 'approved', business_id: 'target-workspace', status: 'approved' }, { id: 'rejected', business_id: 'target-workspace', status: 'rejected' }, { id: 'other', business_id: 'current-workspace', status: 'submitted' }],
    payway: [{ provider: 'payway', provider_transaction_id: 'cancelled', business_id: 'target-workspace', status: 'cancelled' }],
  });
  await assert.rejects(() => app.page({ searchParams: Promise.resolve(app.params) }), /REACHED_NEW_CHECKOUT/);
  assert.deepEqual(app.effects, ['lifecycle']);
});

test('new-checkout denial precedes payment lookups and lookup failure cannot reopen checkout forms', async () => {
  for (const options of [{ permission: false }, { authorized: false }]) {
    const app = checkoutHarness(options);
    await assert.rejects(() => app.page({ searchParams: Promise.resolve(app.params) }), /REDIRECT:.*billing-permission/);
    assert.ok(app.db.history.every(entry => entry.table === 'team_members'));
    assert.deepEqual(app.effects, []);
  }
  const app = checkoutHarness();
  app.db.failures.push({ table: 'manual_payment_requests' });
  await assert.rejects(() => app.page({ searchParams: Promise.resolve(app.params) }), /Unable to check existing payment attempts/);
  assert.deepEqual(app.effects, []);
  const missingReference = checkoutHarness({ payway: [{ id: 'incomplete', provider: 'payway', business_id: 'target-workspace', status: 'pending', provider_transaction_id: null }] });
  await assert.rejects(() => missingReference.page({ searchParams: Promise.resolve(missingReference.params) }), /payment attempt needs review/);
  assert.deepEqual(missingReference.effects, []);
});
