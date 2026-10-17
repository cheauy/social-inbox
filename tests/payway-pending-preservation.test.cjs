/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

function app(pending, permission = true, verification = null, guardReady = true) {
  const now = Date.now(), effects = [];
  const db = database({ billing_transactions: pending, manual_payment_requests: [], manual_payment_uploads: [], business_subscriptions: [{
    business_id: 'b1', status: 'active', plan_code: 'mini', billing_cycle: 'monthly',
    member_limit: 1, channel_limit: 3, pricing_snapshot: {},
    current_period_start: new Date(now - 15 * 86400000).toISOString(),
    current_period_end: new Date(now + 15 * 86400000).toISOString(),
  }] });
  db.rpc = async (name) => { assert.equal(name, 'tenh_payment_application_guards_ready'); return { data: guardReady, error: null }; };
  const load = loader({
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true,
      user: { id: 'u1' }, member: { id: 'm1', user_id: 'u1', business_id: 'b1', role: 'owner', full_name: 'Synthetic owner', email: 'fixture@example.invalid' } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => permission,
      permissionDenied: error => new Response(JSON.stringify({ success: false, error }), { status: 403 }) },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: async () => {} },
    '@/lib/payway/config': { getPayWayConfig: () => ({ environment: 'sandbox', liveEnabled: false,
      merchantId: 'synthetic', apiKey: 'synthetic', appUrl: 'https://fixture.example.invalid',
      purchaseUrl: 'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
      callbackUrl: 'https://fixture.example.invalid/api/payway/callback' }),
      getPayWayReadiness: () => ({ readyToAcceptLivePayments: false, liveBlockers: [] }) },
    '@/lib/payway/close-transaction': { closePayWayTransaction: async () => { effects.push('close'); throw Error('Unexpected provider mutation'); } },
    '@/lib/payway/finalize-payment': { verifyAndFinalizePayWayTransaction: async () => { effects.push('verify'); if(verification)return verification;throw Error('Synthetic conflicting verification'); } },
  }, { URLSearchParams });
  const request = () => new Request('https://fixture.example.invalid/api/payway/checkout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      planCode: 'custom', billingCycle: 'monthly', connections: 4, users: 2,
      customUpgrade: true, extensionBillingCycle: 'none',
    }),
  });
  return { db, effects, post: () => load('app/api/payway/checkout/route.ts').POST(request()) };
}

test('six saved sandbox transactions across two workspaces remain unchanged when new checkout is requested', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ id: `legacy-${index}`, provider: 'payway',
    provider_transaction_id: `saved-${index}`, business_id: index < 3 ? 'b1' : 'b2', status: 'pending',
    amount: 12, currency: 'USD', metadata: { environment: 'sandbox', live_enabled: false },
    pricing_snapshot: { purchase_type: index % 2 ? 'custom-upgrade' : 'new-subscription' } }));
  const instance = app(rows), before = JSON.stringify(instance.db.tables);
  const result = await instance.post(), body = await result.json();
  assert.equal(result.status, 409);
  assert.equal(body.code, 'TENH_PAYWAY_SAVED_CHECKOUT_PENDING');
  assert.equal(body.transactionId, 'saved-0');
  assert.deepEqual(instance.effects, []);
  assert.equal(JSON.stringify(instance.db.tables), before);
  assert.ok(instance.db.history.every(entry => entry.op === 'read'));
});

test('bounded pending inventory refuses to supersede when additional saved payments may be hidden', async () => {
  const rows = Array.from({ length: 22 }, (_, index) => ({ id: `v2-${index}`, provider: 'payway',
    provider_transaction_id: `versioned-${index}`, business_id: 'b1', status: 'pending',
    metadata: { checkout_contract_version: 2 } }));
  rows[21].metadata = { environment: 'sandbox' };
  const instance = app(rows), before = JSON.stringify(instance.db.tables);
  const result = await instance.post();
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, 'TENH_PAYWAY_PENDING_REVIEW_REQUIRED');
  assert.deepEqual(instance.effects, []);
  assert.equal(JSON.stringify(instance.db.tables), before);
});

test('checkout permission denial exposes no saved payment or provider activity', async () => {
  const instance = app([{ id: 'secret-record', provider: 'payway', provider_transaction_id: 'saved-private',
    business_id: 'b1', status: 'pending' }], false);
  const response = await instance.post();
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /saved-private/);
  assert.deepEqual(instance.effects, []);
  assert.deepEqual(instance.db.history, []);
});

test('new synthetic sandbox checkout receives its contract from the server', async () => {
  const instance = app([]), response = await instance.post();
  assert.equal(response.status, 200);
  const saved = instance.db.tables.billing_transactions[0];
  assert.equal(saved.metadata.checkout_contract_version, 2);
  assert.equal(saved.metadata.environment, 'sandbox');
  assert.equal(saved.metadata.live_enabled, false);
  const body=await response.json();
  assert.equal(body.fields.lifetime,'10');
  assert.equal(saved.metadata.checkout_lifetime_minutes,10);
  assert.equal(Date.parse(saved.metadata.checkout_expires_at)-Date.parse(saved.metadata.checkout_started_at),600000);
  assert.equal(body.checkoutExpiresAt,saved.metadata.checkout_expires_at);
  assert.equal(saved.request_time,saved.metadata.checkout_started_at.replace(/[-:TZ.]/g,'').slice(0,14));
  assert.deepEqual(instance.effects, []);
});

test('unresolved manual payment blocks PayWay checkout before provider effects',async()=>{
 const instance=app([]);instance.db.tables.manual_payment_requests.push({id:'old-manual',business_id:'b1',status:'submitted'});
 const before=JSON.stringify(instance.db.tables),response=await instance.post();
 assert.equal(response.status,409);assert.equal((await response.json()).code,'TENH_BILLING_PURCHASE_PENDING');
 assert.deepEqual(instance.effects,[]);assert.equal(JSON.stringify(instance.db.tables),before);
});

test('versioned pending attempt resumes its original identity without provider effects or replacement',async()=>{
 const instance=app([{id:'v2',provider:'payway',provider_transaction_id:'synthetic-v2',business_id:'b1',status:'pending',metadata:{checkout_contract_version:2}}]);
 const before=JSON.stringify(instance.db.tables),response=await instance.post();
 const body=await response.json();
 assert.equal(response.status,409);assert.equal(body.code,'TENH_PAYWAY_CHECKOUT_IN_PROGRESS');
 assert.equal(body.transactionId,'synthetic-v2');assert.equal(body.businessId,'b1');
 assert.deepEqual(instance.effects,[]);assert.equal(JSON.stringify(instance.db.tables),before);
 assert.ok(instance.db.history.every(e=>e.op==='read'));
});

test('new checkout fails closed before creating an attempt when application guards are unavailable',async()=>{
 const instance=app([],true,null,false),before=JSON.stringify(instance.db.tables),response=await instance.post();
 assert.equal(response.status,503);assert.equal((await response.json()).code,'TENH_BILLING_APPLICATION_MIGRATION_REQUIRED');
 assert.equal(JSON.stringify(instance.db.tables),before);assert.deepEqual(instance.effects,[]);
});

test('prepared manual proof ticket blocks PayWay and identifies the original manual attempt',async()=>{
 const instance=app([]);instance.db.tables.manual_payment_uploads=[{id:'original-manual',business_id:'b1',state:'prepared'}];
 const before=JSON.stringify(instance.db.tables),response=await instance.post(),body=await response.json();
 assert.equal(response.status,409);assert.equal(body.code,'TENH_BILLING_PURCHASE_PENDING');
 assert.equal(body.manualRequestId,'original-manual');assert.equal(body.businessId,'b1');
 assert.equal(JSON.stringify(instance.db.tables),before);assert.deepEqual(instance.effects,[]);
});

test('closed and expired UI sessions retain all unresolved financial guards against another upgrade',async()=>{
 const {createPayWayCheckoutLifetime}=loader()('lib/payway/checkout-lifetime.ts');
 for(const ended of [{checkout_session:{version:1,state:'closed',closed_at:'2026-10-17T12:00:00Z'}},createPayWayCheckoutLifetime(Date.now()-600001)]){
  const instance=app([{id:'old',provider:'payway',provider_transaction_id:'old-closed',business_id:'b1',status:'pending',metadata:{checkout_contract_version:2,...ended}}]);
  const before=JSON.stringify(instance.db.tables),response=await instance.post();assert.equal(response.status,409);
  assert.equal((await response.json()).transactionId,'old-closed');assert.equal(JSON.stringify(instance.db.tables),before);assert.deepEqual(instance.effects,[]);
 }
});
