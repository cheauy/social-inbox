/* eslint-disable @typescript-eslint/no-require-imports -- Local-only checkout route fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loader, database } = require('./tenh-seven/harness.cjs');

const now = Date.parse('2026-09-16T00:00:00Z');
const dummyKey = 'LOCAL_RECEIPT_FIXTURE_ONLY';
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const catalog = loader()('lib/subscription/plan-catalog.ts');
// Purchase contract: https://developer.payway.com.kh/purchase-14530820e0.md
const signedOrder = ['req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'shipping',
  'firstname', 'lastname', 'email', 'phone', 'type', 'payment_option', 'return_url', 'cancel_url',
  'continue_success_url', 'return_deeplink', 'currency', 'custom_fields', 'return_params', 'payout',
  'lifetime', 'additional_params', 'google_pay_token', 'skip_success_page'];
function signedHash(fields) {
  return crypto.createHmac('sha512', dummyKey)
    .update(signedOrder.map(key => fields[key] ?? '').join(''), 'utf8').digest('base64');
}
function checkoutFixture(subscription, { environment = 'production', planName, permission = true, pending = false } = {}) {
  const db = database({ business_subscriptions: [{ business_id: 'fixture-workspace', ...subscription }],
    billing_transactions: pending ? [{ provider: 'payway', business_id: 'fixture-workspace', status: 'pending',
      provider_transaction_id: 'existing-fixture', metadata: { checkout_contract_version: 2 } }] : [],
    manual_payment_requests: [], manual_payment_uploads: [] });
  db.rpc = async name => {
    assert.equal(name, 'tenh_payment_application_guards_ready');
    return { data: true, error: null };
  };
  const member = { id: 'fixture-member', business_id: 'fixture-workspace', role: 'owner', full_name: 'Local Fixture', email: 'fixture@example.invalid' };
  const network = [];
  const load = loader({
    'node:crypto': { ...crypto, randomInt: () => 123456 },
    '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, member, user: { id: 'fixture-user' } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => permission,
      permissionDenied: () => new Response(JSON.stringify({ success: false }), { status: 403 }) },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/payway/config': { getPayWayConfig: () => ({ environment, merchantId: 'LOCAL_FIXTURE_MERCHANT', apiKey: dummyKey,
      appUrl: 'https://tenh.example.invalid', callbackUrl: 'https://tenh.example.invalid/callback',
      purchaseUrl: 'https://provider.example.invalid/purchase', liveEnabled: true }),
    getPayWayReadiness: () => ({ readyToAcceptLivePayments: true }) },
    '@/lib/subscription/plan-catalog': { ...catalog, getPlanDefinition: value => {
      const plan = catalog.getPlanDefinition(value);
      return planName && plan ? { ...plan, name: planName } : plan;
    } },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: async () => {} },
    '@/lib/billing/pending-bakong-payment': { getPendingBakongPayment: async () => null },
  }, { Date: FixtureDate, Buffer, URLSearchParams, fetch: async (...args) => {
    network.push(args); throw new Error('Provider networking is blocked in receipt fixtures');
  } });
  return { db, network, POST: load('app/api/payway/checkout/route.ts').POST };
}
const expired = { status: 'expired', plan_code: 'mini', billing_cycle: 'monthly', channel_limit: 3, member_limit: 1,
  current_period_start: '2026-08-01T00:00:00Z', current_period_end: '2026-09-01T00:00:00Z', pricing_snapshot: {}, last_paid_amount: 13 };
const active = { ...expired, status: 'active', current_period_start: '2026-09-01T00:00:00Z', current_period_end: '2026-10-01T00:00:00Z' };
const fixtures = [
  { name: 'monthly subscription', sub: expired, body: { planCode: 'standard', billingCycle: 'monthly' },
    amount: '25.00', type: 'subscription', description: 'Team subscription - 1 Month', capacity: '5 connections / 3 users' },
  { name: 'discounted quarterly subscription', sub: expired, body: { planCode: 'standard', billingCycle: '3-months' },
    amount: '71.25', type: 'subscription', description: 'Team subscription - 3 Months', capacity: '5 connections / 3 users' },
  { name: 'discounted annual subscription', sub: expired, body: { planCode: 'standard', billingCycle: '12-months' },
    amount: '240.00', type: 'subscription', description: 'Team subscription - 1 Year', capacity: '5 connections / 3 users' },
  { name: 'custom subscription', sub: expired, body: { planCode: 'custom', billingCycle: 'monthly', connections: 5, users: 2 },
    amount: '24.00', type: 'subscription', description: 'Custom subscription - 1 Month', capacity: '5 connections / 2 users' },
  { name: 'fixed upgrade charges difference only', sub: active, body: { planCode: 'standard', billingCycle: 'monthly' },
    amount: '12.00', type: 'upgrade', description: 'Team upgrade price difference - 1 Month', capacity: '5 connections / 3 users' },
  { name: 'renewal uses saved price and current display name', sub: { ...expired, plan_code: 'standard', channel_limit: 5, member_limit: 3,
    pricing_snapshot: { renewal_total_cents: 1700, monthly_cents: 1700 } }, body: { planCode: 'standard', billingCycle: 'monthly', renewSame: true },
    amount: '17.00', type: 'renew-same', description: 'Team renewal - 1 Month', capacity: '5 connections / 3 users' },
  { name: 'custom capacity-only prorated upgrade', sub: active,
    body: { planCode: 'custom', billingCycle: 'monthly', connections: 5, users: 1, customUpgrade: true, extensionBillingCycle: 'none' },
    amount: '4.00', type: 'custom-upgrade', description: 'Custom upgrade - remaining-term capacity adjustment', capacity: '5 connections / 1 users', excludes: 'extension' },
  { name: 'custom capacity plus discounted extension', sub: active,
    body: { planCode: 'custom', billingCycle: '3-months', connections: 5, users: 1, customUpgrade: true, extensionBillingCycle: '3-months' },
    amount: '63.85', type: 'custom-upgrade', description: 'Custom upgrade - remaining-term capacity adjustment - 3 Months extension', capacity: '5 connections / 1 users' },
  { name: 'custom duration-only extension', sub: active,
    body: { planCode: 'custom', billingCycle: 'monthly', connections: 3, users: 1, customUpgrade: true, extensionBillingCycle: 'monthly' },
    amount: '13.00', type: 'custom-upgrade', description: 'Custom upgrade - 1 Month extension', capacity: '3 connections / 1 users', excludes: 'capacity adjustment' },
];
const options = [
  { environment: 'production', method: 'abapay_khqr' },
  { environment: 'sandbox', method: 'abapay_khqr' },
  { environment: 'production', method: 'abapay_deeplink' },
  { environment: 'sandbox', method: 'abapay_deeplink' },
];
function request(body) {
  return new Request('https://tenh.example.invalid/api/payway/checkout', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
}
for (const fixture of fixtures) for (const option of options) {
  test(`${fixture.name}: signed items for ${option.environment} ${option.method}`, async () => {
    const app = checkoutFixture(fixture.sub, option);
    const response = await app.POST(request({ ...fixture.body, paymentMethod: option.method }));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.purchaseType, fixture.type);
    assert.equal(result.amount, fixture.amount);
    const { fields } = result;
    assert.equal(typeof fields.items, 'string', 'PayWay must receive an encoded items field');
    const bytes = Buffer.from(fields.items, 'base64');
    assert.equal(bytes.toString('base64'), fields.items, 'canonical single Base64 encoding');
    const items = JSON.parse(bytes.toString('utf8'));
    assert.equal(items.length, 1);
    assert.deepEqual(Object.keys(items[0]).sort(), ['name', 'price', 'quantity']);
    assert.equal(items[0].quantity, 1, 'one purchased package, not seats or months');
    assert.equal(typeof items[0].price, 'number');
    assert.equal(Math.round(items[0].price * 100), Math.round(Number(fixture.amount) * 100));
    assert.equal(items[0].name, `TENH Chat ${fixture.description} - ${fixture.capacity}`);
    if (fixture.excludes) assert.ok(!items[0].name.includes(fixture.excludes));
    assert.ok(!items[0].name.includes('Local Fixture'), 'no customer PII in the product remark');
    assert.equal(fields.hash, signedHash(fields));
    assert.notEqual(fields.hash, signedHash({ ...fields, items: '' }));
    assert.notEqual(fields.hash, signedHash({ ...fields, items: fields.items + 'A' }));
    // Existing charge, callback, return and presentation fields stay unchanged.
    const { items: encodedItems, hash, ...unchanged } = fields;
    assert.ok(encodedItems && hash);
    const params = new URLSearchParams({ payway: 'returned', tran_id: `${now}123456`,
      plan: fixture.body.planCode, cycle: fixture.body.billingCycle });
    if (fixture.body.planCode === 'custom') {
      params.set('connections', String(fixture.body.connections)); params.set('users', String(fixture.body.users));
      if (fixture.body.customUpgrade) { params.set('upgrade', 'custom'); params.set('extension', fixture.body.extensionBillingCycle); }
    }
    if (fixture.body.renewSame) params.set('renew', 'same');
    assert.deepEqual(unchanged, {
      req_time: '20260916000000', merchant_id: 'LOCAL_FIXTURE_MERCHANT', tran_id: `${now}123456`,
      firstname: 'Local', lastname: 'Fixture', email: 'fixture@example.invalid', type: 'purchase',
      payment_option: option.method,
      ...(option.environment === 'sandbox' && option.method === 'abapay_khqr' ? { payment_gate: '0' } : {}),
      amount: fixture.amount, currency: 'USD', return_url: 'https://tenh.example.invalid/callback',
      cancel_url: `https://tenh.example.invalid/api/payway/cancel-return?tran_id=${now}123456`,
      continue_success_url: `https://tenh.example.invalid/dashboard/subscription/payment?${params}`, lifetime: '10',
    });
    const writes = app.db.history.filter(entry => entry.op !== 'read');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].table, 'billing_transactions'); assert.equal(writes[0].op, 'insert');
    assert.equal(writes[0].body.amount, fixture.amount); assert.equal(writes[0].body.currency, 'USD');
    assert.equal(writes[0].body.pricing_snapshot.total_cents, Math.round(Number(fixture.amount) * 100));
    assert.deepEqual(app.network, []);
  });
}
test('UTF-8 plan labels survive JSON and Base64 encoding without mojibake', async () => {
  const planName = 'គម្រោងសាកល្បង 🧾';
  const app = checkoutFixture(expired, { planName });
  const result = await (await app.POST(request(fixtures[0].body))).json();
  const item = JSON.parse(Buffer.from(result.fields.items, 'base64').toString('utf8'))[0];
  assert.equal(item.name, `TENH Chat ${planName} subscription - 1 Month - 5 connections / 3 users`);
  assert.equal(result.fields.hash, signedHash(result.fields));
  assert.deepEqual(app.network, []);
});
for (const [name, options, status] of [
  ['permission denied', { permission: false }, 403],
  ['existing unresolved checkout', { pending: true }, 409],
]) test(`${name} cannot create a signed purchase or another transaction`, async () => {
  const app = checkoutFixture(expired, options);
  const response = await app.POST(request(fixtures[0].body));
  const result = await response.json();
  assert.equal(response.status, status); assert.equal(result.fields, undefined);
  assert.ok(app.db.history.every(entry => entry.op === 'read')); assert.deepEqual(app.network, []);
});
