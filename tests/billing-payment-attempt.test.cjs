/* eslint-disable @typescript-eslint/no-require-imports -- Existing node:test TypeScript loader. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');
const { describePaymentAttempt } = loader()('lib/billing/payment-attempt.ts');
const businessId = '10000000-0000-4000-8000-000000000001';
const manualId = '20000000-0000-4000-8000-000000000002';
const now = Date.parse('2026-10-15T12:00:00Z');
function saved(overrides = {}) {
  const payment = { id: 'payway-row', business_id: businessId, provider: 'payway', provider_transaction_id: 'transaction-1',
    status: 'approved', amount: 12, currency: 'USD', plan_code: 'mini', billing_cycle: 'monthly',
    target_member_limit: 1, target_channel_limit: 3, pricing_snapshot: {},
    verified_at: '2026-10-01T12:00:00Z', provider_status: 'APPROVED', provider_status_code: '0', provider_original_amount: 12,
    metadata: { environment: 'production', live_enabled: true }, ...overrides };
  const invoice = { id: 'invoice-1', business_id: businessId, source_type: 'payway', provider: 'payway',
    source_payment_id: payment.id, source_transaction_id: payment.provider_transaction_id, amount: payment.amount,
    currency: payment.currency, status: 'paid', plan_code: payment.plan_code, billing_cycle: payment.billing_cycle,
    period_start: '2026-10-01T12:00:00Z', period_end: '2026-11-01T12:00:00Z', snapshot: {} };
  const subscription = { business_id: businessId, status: 'active', plan_code: 'mini', billing_cycle: 'monthly',
    member_limit: 1, channel_limit: 3, current_period_start: invoice.period_start, current_period_end: invoice.period_end,
    pricing_snapshot: {}, updated_at: payment.verified_at };
  return { source: 'payway', payment, invoice, subscription, businessName: 'Saved workspace', now };
}
function route(seed = saved(), options = {}) {
  const db = database({ payment_cancellations: [], billing_transactions: seed.source === 'payway' ? [seed.payment] : [],
    manual_payment_requests: seed.source === 'manual' ? [seed.payment] : [],
    tenh_billing_invoices: seed.invoice ? [seed.invoice] : [], business_subscriptions: seed.subscription ? [seed.subscription] : [],
    businesses: [{ id: businessId, name: 'Saved workspace' }],
    team_members: options.outsider ? [] : [{ id: 'owner', role: 'owner', user_id: 'user-1', business_id: businessId, is_active: true }] });
  const rpc = [];
  db.rpc = async (name, args) => { rpc.push({ name, args: { ...args } }); return { data: name === 'tenh_get_manual_payment_upload' ? options.preparedRow ?? null : seed.recoveryEvents ?? [],
    error: options.rpcError ? { message: 'unavailable' } : null }; };
  const api = loader({ 'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'user-1' } }, error: null }) } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => !options.denied },
  })('app/api/subscription/payment-status/route.ts');
  const get = async (query) => { const response = await api.GET(new Request('https://test.invalid/api/subscription/payment-status?' + query)); return { response, body: await response.json() }; };
  return { db, rpc, get };
}

test('one persisted purchase is active only with its own approved source and exact current entitlement', () => {
  assert.equal(describePaymentAttempt(saved()).application, 'active');
  for (const change of [{ status: 'pending' }, { status: 'failed' }, { status: 'cancelled' }]) {
    const input = saved(change), result = describePaymentAttempt(input);
    assert.equal(result.application, change.status === 'pending' ? 'pending' : null);
    assert.equal(result.canRetry, false);
  }
  for (const change of [{ plan_code: 'team' }, { member_limit: 5 }, { current_period_start: '2026-10-02T12:00:00Z' }, { status: 'expired' }]) {
    const input = saved(); Object.assign(input.subscription, change);
    assert.equal(describePaymentAttempt(input).application, 'historical');
  }
});

test('future dates alone cannot invent a paid schedule and expired paid coverage remains historical', () => {
  const input = saved();
  input.invoice.period_start = input.subscription.current_period_start = '2026-10-20T12:00:00Z';
  input.invoice.period_end = input.subscription.current_period_end = '2026-11-20T12:00:00Z';
  assert.equal(describePaymentAttempt(input).application, 'review');
  input.now = Date.parse('2026-11-21T12:00:00Z');
  assert.equal(describePaymentAttempt(input).application, 'historical');
});

test('custom capacity purchase uses saved quote and exact activation timestamp instead of a fresh cycle', () => {
  const input = saved();
  input.payment.pricing_snapshot = { purchase_type: 'custom-upgrade', quoted_at: '2026-10-01T11:59:00Z', new_period_end: input.invoice.period_end };
  input.subscription.pricing_snapshot = input.payment.pricing_snapshot;
  input.subscription.current_period_start = '2026-09-01T12:00:00Z';
  assert.equal(describePaymentAttempt(input).application, 'active');
  input.subscription.updated_at = '2026-10-02T12:00:00Z';
  assert.equal(describePaymentAttempt(input).application, 'historical');
});

test('missing or conflicting invoice/payment evidence requires review and never borrows active subscription success', () => {
  const missing = saved(); missing.invoice = null;
  assert.equal(describePaymentAttempt(missing).application, 'review');
  for (const change of [{ source_payment_id: 'other' }, { amount: 13 }, { plan_code: 'team' }, { period_end: null }]) {
    const input = saved(); Object.assign(input.invoice, change);
    assert.equal(describePaymentAttempt(input).application, 'review');
  }
  const unknown = saved(); unknown.payment.metadata = {};
  assert.equal(describePaymentAttempt(unknown).application, 'review');
  const sandbox = saved(); sandbox.payment.metadata = { environment: 'sandbox', live_enabled: false };
  assert.equal(describePaymentAttempt(sandbox).environment, 'sandbox');
  assert.equal(describePaymentAttempt(sandbox).application, 'active');
});

test('only this attempt recovery evidence can block it; older evidence cannot undo later recorded approval', () => {
  const input = saved();
  const event = { source_type: 'payway', source_payment_id: input.payment.id, business_id: businessId,
    kind: 'recovery_required', occurred_at: '2026-10-01T12:01:00Z', reason: 'private SQL detail', observation: { private: 'secret' } };
  input.recoveryEvents = [{ ...event, source_payment_id: 'other' }];
  assert.equal(describePaymentAttempt(input).application, 'active');
  input.recoveryEvents = [event];
  const result = describePaymentAttempt(input);
  assert.equal(result.status, 'recovery_required');
  assert.equal(result.application, 'review');
  assert.equal(JSON.stringify(result).includes('private'), false);
  input.recoveryEvents = [{ ...event, occurred_at: '2026-10-01T11:59:00Z' }];
  assert.equal(describePaymentAttempt(input).application, 'active');
});

test('manual attempt retains its saved request identity and review state', () => {
  const input = saved(); input.source = 'manual';
  input.payment = { ...input.payment, id: manualId, status: 'submitted' }; delete input.payment.provider;
  input.invoice = null;
  assert.equal(describePaymentAttempt(input).application, 'pending');
  assert.equal(describePaymentAttempt(input).id, manualId);
});

test('read-only API binds saved attempt, workspace and active membership without private payloads', async () => {
  const h = route(), before = JSON.stringify(h.db.tables);
  const { response, body } = await h.get('tran_id=transaction-1&purchase_business=' + businessId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(body.attempt.id, 'transaction-1');
  assert.equal(body.attempt.businessId, businessId);
  assert.equal(body.attempt.canRetry, false);
  assert.equal(JSON.stringify(h.db.tables), before);
  assert.ok(h.db.history.every(entry => entry.op === 'read'));
  assert.deepEqual(h.rpc, [{ name: 'tenh_get_billing_recovery_queue', args: { p_business_id: businessId } }]);
  assert.equal('metadata' in body.attempt, false);
});

test('API rejects ambiguous identifiers and denies wrong-workspace, unauthorized and missing attempts equally', async () => {
  for (const query of ['', 'manual_request=' + manualId + '&tran_id=transaction-1', 'manual_request=invalid',
    'manual_request=&tran_id=transaction-1',
    'tran_id=' + 'x'.repeat(21), 'tran_id=transaction-1&tran_id=other', 'tran_id=transaction-1&purchase_business=invalid']) {
    const h = route(); assert.equal((await h.get(query)).response.status, 400); assert.equal(h.db.history.length, 0);
  }
  for (const options of [{ outsider: true }, { denied: true }]) {
    const h = route(saved(), options); assert.equal((await h.get('tran_id=transaction-1')).response.status, 404); assert.equal(h.rpc.length, 0);
  }
  assert.equal((await route().get('tran_id=transaction-1&purchase_business=30000000-0000-4000-8000-000000000003')).response.status, 404);
  assert.equal((await route().get('tran_id=missing')).response.status, 404);
  const signedOut = route(saved(), { signedOut: true });
  assert.equal((await signedOut.get('tran_id=transaction-1')).response.status, 401);
  assert.equal(signedOut.db.history.length, 0);
});

test('prepared manual ticket resolves only its exact member and workspace, without implying payment/application', async () => {
  const preparedRow = { id: manualId, business_id: businessId, requested_by_member_id: 'owner', status: 'prepared',
    plan_code: 'mini', billing_cycle: 'monthly', amount: 12, currency: 'USD', file_name: 'receipt.png', mime_type: 'image/png', size_bytes: 1024 };
  const h = route(saved(), { preparedRow });
  const { response, body } = await h.get('manual_request=' + manualId + '&purchase_business=' + businessId);
  assert.equal(response.status, 200);
  assert.equal(body.attempt.id, manualId);
  assert.equal(body.attempt.status, 'prepared');
  assert.equal(body.attempt.application, null);
  assert.equal(body.attempt.canRetry, false);
  assert.deepEqual(body.attempt.upload, { fileName: 'receipt.png', mimeType: 'image/png', sizeBytes: 1024 });
  assert.ok(h.db.history.every(entry => entry.op === 'read'));
  assert.deepEqual(h.rpc.map(call => call.name), ['tenh_get_manual_payment_upload']);
  const outsider = route(saved(), { preparedRow: { ...preparedRow, requested_by_member_id: 'another' } });
  assert.equal((await outsider.get('manual_request=' + manualId)).response.status, 404);
  assert.equal((await h.get('manual_request=' + manualId + '&purchase_business=30000000-0000-4000-8000-000000000003')).response.status, 404);
});

test('API fails closed when persisted recovery evidence cannot be read', async () => {
  assert.equal((await route(saved(), { rpcError: true }).get('tran_id=transaction-1')).response.status, 503);
});

test('billing Manage can read its permitted attempt without gaining the owner-only receipt action', async () => {
  const h = route();
  h.db.tables.team_members[0].role = 'agent';
  const { response, body } = await h.get('tran_id=transaction-1');
  assert.equal(response.status, 200);
  assert.equal(body.attempt.application, 'active');
  assert.equal(body.attempt.invoiceId, null);
  assert.equal((await route().get('tran_id=transaction-1')).body.attempt.invoiceId, 'invoice-1');
});

test('explicit PayWay verification preserves the workspace only when requested and validates its pin first', async () => {
  for (const preserve of [false, true]) for (const status of ['pending', 'approved']) {
    const seed = saved({ status }), db = database({ billing_transactions: [seed.payment], team_members: [{ id: 'owner', business_id: businessId,
      user_id: 'user-1', role: 'owner', is_active: true }], tenh_billing_invoices: [seed.invoice] });
    let cookieWrites = 0, verifications = 0, memberSelections = 0;
    const api = loader({ '@/lib/supabase/admin': { supabaseAdmin: db },
      '@/lib/auth/get-current-member': { getCurrentMember: async () => { memberSelections++; return { success: true, user: { id: 'user-1' } }; }, TENH_ACTIVE_BUSINESS_COOKIE: 'active' },
      '@/lib/auth/require-permission': { memberHasPermission: async () => true },
      '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) } }) },
      'next/headers': { cookies: async () => ({ set: () => { cookieWrites++; } }) },
      '@/lib/payway/finalize-payment': { verifyAndFinalizePayWayTransaction: async () => { verifications++; return { paymentState: 'approved', businessId }; } },
    })('app/api/payway/status/route.ts');
    const query = 'https://test.invalid/api/payway/status?tran_id=transaction-1&purchase_business=' + businessId + (preserve ? '&preserve_workspace=1' : '');
    assert.equal((await api.POST({ nextUrl: new URL(query) })).status, 200);
    assert.equal(cookieWrites, preserve ? 0 : 1);
    assert.equal(memberSelections, preserve ? 0 : 1);
    assert.equal(verifications, status === 'pending' ? 1 : 0);
    assert.equal((await api.POST({ nextUrl: new URL(query.replace(businessId, '30000000-0000-4000-8000-000000000003')) })).status, 404);
    assert.equal(verifications, status === 'pending' ? 1 : 0);
  }
});
