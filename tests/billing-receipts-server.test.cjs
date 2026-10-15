/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const paid = '2026-09-03T12:34:56Z';
function payment(n, extra = {}) {
  const ref = `TENH-${n}`;
  return { id: id(n), business_id: 'B', provider: 'payway', provider_transaction_id: ref,
    plan_code: 'custom', billing_cycle: 'monthly', amount: 25, currency: 'USD', status: 'approved',
    provider_status: 'APPROVED', provider_status_code: '0', provider_original_amount: 25,
    provider_payment_amount: 100000, provider_payment_currency: 'KHR', provider_approval_code: '123456', verified_at: paid,
    created_at: paid, metadata: { environment: 'production', live_enabled: true,
      payway_verified_payload: { status: { code: '00', tran_id: ref }, data: { payment_status: 'APPROVED', payment_status_code: 0, original_amount: 25, payment_amount: 100000, payment_currency: 'KHR' } },
      secret: 'NEVER_RETURN_THIS', proof_url: 'https://private.invalid/proof' }, ...extra };
}
function invoice(n, extra = {}) {
  return { id: id(n + 100), invoice_number: `TENH-${n}`, business_id: 'B', source_type: 'payway', source_payment_id: id(n),
    source_transaction_id: `TENH-${n}`, workspace_name: 'Workspace B at purchase', customer_name: 'Owner', billing_email: null,
    plan_code: 'custom', plan_name: 'Custom snapshot', billing_cycle: 'monthly', billing_cycle_label: 'Monthly',
    amount: 25, currency: 'USD', payment_method: 'ABA KHQR', provider: 'payway', provider_approval_code: '123456', status: 'paid',
    paid_at: paid, period_start: '2026-09-03T00:00:00Z', period_end: '2026-09-12T00:00:00Z', issued_at: paid, created_at: paid,
    snapshot: { internal: 'NEVER_RETURN_THIS', proof_url: 'https://private.invalid/proof' }, ...extra };
}
function fixture(options = {}) {
  const db = database({
    team_members: options.members ?? ['A', 'B'].map(business_id => ({ id: `owner-${business_id}`, user_id: 'user', business_id, role: 'owner', is_active: true })),
    businesses: [{ id: 'A', name: 'Workspace A' }, { id: 'B', name: 'Workspace B' }],
    billing_transactions: options.payments ?? [payment(1)], manual_payment_requests: options.manual ?? [],
    tenh_billing_invoices: options.invoices ?? [invoice(1)],
    business_subscriptions: [{ business_id: 'B', current_period_start: '2030-01-01', current_period_end: '2031-01-01' }],
  });
  let selectedCalls = 0;
  const load = loader({
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }) } },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: 'user' } }, error: null }) } }) },
    '@/lib/auth/get-current-member': { getCurrentMember: async () => {
      selectedCalls++;
      return options.unauthenticated ? { success: false, status: 401, error: 'Unauthorized.' }
        : { success: true, user: { id: 'user' }, member: { id: 'selected-member', business_id: 'A', role: options.members?.find(member => member.business_id === 'A')?.role ?? 'owner' } };
    } },
    '@/lib/auth/require-permission': { memberHasPermission: async member => member.role === 'owner' },
  });
  const receipt = load('app/api/subscription/invoices/[invoiceId]/route.ts'), history = load('app/api/subscription/billing-history/route.ts');
  return { db, history: () => history.GET(), receipt: (invoiceId = id(101), query = '') => receipt.GET(new Request(`https://mock.invalid/api/subscription/invoices/${invoiceId}${query}`), { params: Promise.resolve({ invoiceId }) }), selectedCalls: () => selectedCalls };
}
test('owner of A and B opens B invoice independently of A selected workspace', async () => {
  const f = fixture(), response = await f.receipt(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.invoice.workspaceName, 'Workspace B at purchase'); assert.equal(f.selectedCalls(), 0);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const item = (await (await f.history()).json()).items[0]; assert.equal(item.businessId, 'B'); assert.equal(item.workspaceName, body.invoice.workspaceName);
});
test('owner of B with an agent-only selected A membership can view B', async () => {
  const f = fixture({ members: [{ user_id: 'user', business_id: 'A', role: 'agent', is_active: true }, { user_id: 'user', business_id: 'B', role: 'owner', is_active: true }] });
  assert.equal((await f.receipt()).status, 200); assert.equal((await f.history()).status, 200); assert.equal(f.selectedCalls(), 0);
});
test('agent-only, unrelated owner, removed owner and unauthenticated users cannot disclose invoice existence', async () => {
  for (const members of [
    [{ user_id: 'user', business_id: 'B', role: 'agent', is_active: true }],
    [{ user_id: 'user', business_id: 'A', role: 'owner', is_active: true }],
    [{ user_id: 'user', business_id: 'B', role: 'owner', is_active: false }],
  ]) {
    const f = fixture({ members });
    const denied = await f.receipt(id(101), '?businessId=B'), missing = await f.receipt(id(999));
    assert.equal(denied.status, 404); assert.equal(missing.status, 404); assert.deepEqual(await denied.json(), await missing.json());
    assert.equal(f.db.history.some(entry => entry.op !== 'read'), false);
  }
  const f = fixture({ unauthenticated: true }); assert.equal((await f.receipt()).status, 401); assert.equal((await f.history()).status, 401); assert.deepEqual(f.db.history, []);
});
test('history totals separate sandbox, confirmed production, manual and unverified approvals', async () => {
  const f = fixture({ payments: [payment(1, { metadata: { environment: 'sandbox', live_enabled: false } }), payment(2), payment(3, { metadata: {} })],
    manual: [{ id: id(4), business_id: 'B', status: 'approved', amount: 30, currency: 'USD', approved_at: paid, created_at: paid }],
    invoices: [invoice(1), invoice(2), invoice(3), invoice(4, { source_type: 'manual', provider: 'manual', source_transaction_id: 'SAVED-MANUAL-REF', amount: 30 })] });
  const { items, summary } = await (await f.history()).json();
  assert.equal(summary.approvedUsdTotal, 55); assert.equal(summary.testUsdTotal, 25); assert.equal(summary.unverifiedUsdTotal, 25);
  assert.equal(items.find(item => item.sourceId === id(1)).environment, 'sandbox');
  assert.equal(items.find(item => item.sourceId === id(2)).confirmedPaid, true);
  assert.equal(items.find(item => item.sourceId === id(3)).confirmedPaid, false);
  const manual = items.find(item => item.source === 'manual'); assert.equal(manual.providerVerified, false); assert.equal(manual.environment, 'manual'); assert.equal(manual.transactionId, 'SAVED-MANUAL-REF');
  assert.equal(JSON.stringify({ items, summary }).includes('NEVER_RETURN_THIS'), false); assert.equal(JSON.stringify(items).includes('private.invalid'), false);
});
test('pending and unsuccessful persisted payments have no issued receipt action or paid date', async () => {
  const statuses = ['pending', 'failed', 'declined', 'rejected', 'cancelled', 'recovery_required', 'draft'];
  const f = fixture({ payments: statuses.map((status, i) => payment(i + 1, { status })), invoices: statuses.map((_, i) => invoice(i + 1)) });
  const body = await (await f.history()).json(); assert.equal(body.items.length, statuses.length);
  for (const item of body.items) { assert.equal(item.invoiceId, null); assert.equal(item.paidAt, null); assert.equal(item.confirmedPaid, false); }
  assert.equal(body.summary.approvedUsdTotal, 0); assert.equal((await f.receipt()).status, 404);
});
test('approved missing invoice remains unavailable, without writes or synthesized historical coverage', async () => {
  const f = fixture({ invoices: [] }); const item = (await (await f.history()).json()).items[0];
  assert.equal(item.invoiceId, null); assert.equal(item.periodStart, null); assert.equal(item.periodEnd, null); assert.equal((await f.receipt()).status, 404);
  assert.equal(f.db.history.every(entry => entry.op === 'read'), true);
});
test('receipt and history preserve saved invoice amount, currency, reference, date and coverage', async () => {
  const saved = invoice(1, { amount: '81000', currency: 'KHR' }), f = fixture({ invoices: [saved] });
  const receipt = (await (await f.receipt()).json()).invoice, item = (await (await f.history()).json()).items[0];
  for (const row of [receipt, item]) {
    assert.equal(row.amount, 81000); assert.equal(row.currency, 'KHR'); assert.equal(row.transactionId, saved.source_transaction_id);
    assert.equal(row.paidAt, saved.paid_at); assert.equal(row.periodStart, saved.period_start); assert.equal(row.periodEnd, saved.period_end); assert.equal(row.confirmedPaid, false);
  }
  assert.equal(JSON.stringify(receipt).includes('NEVER_RETURN_THIS'), false);
  assert.equal(f.db.history.some(entry => entry.table === 'business_subscriptions'), false);
});
test('temporary lookups fail safely and malformed IDs cannot disclose data', async () => {
  const f = fixture(); f.db.failures.push({ table: 'tenh_billing_invoices', message: 'SECRET_DATABASE_DETAIL' });
  const response = await f.receipt(); assert.equal(response.status, 500); assert.equal(JSON.stringify(await response.json()).includes('SECRET_DATABASE_DETAIL'), false);
  const history = await f.history(); assert.equal(history.status, 500); assert.equal(JSON.stringify(await history.json()).includes('SECRET_DATABASE_DETAIL'), false);
  assert.equal((await fixture().receipt('invalid')).status, 400);
});
