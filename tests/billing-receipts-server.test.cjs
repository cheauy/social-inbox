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

test('customer history excludes unpaid projections before caps and counts, preserving terminal records and late payment receipts', async () => {
  const pending = Array.from({ length: 310 }, (_, n) => payment(n + 1000, { status: 'pending', created_at: '2026-10-17' }));
  const f = fixture({ payments: [...pending, payment(1), payment(2, { status: 'failed' }), payment(3, { status: 'refunded' }),
    payment(4, { status: 'pending', provider: 'bakong', metadata: { bakong_state: 'test_paid', environment: 'sandbox' } })],
    manual: [{ id: id(5), business_id: 'B', status: 'submitted' }, { id: id(6), business_id: 'B', status: 'rejected', amount: 3, currency: 'USD', created_at: paid }] });
  const before = JSON.stringify(f.db.tables), first = await (await f.history()).json();
  assert.equal(first.items.length, 5); assert.equal(first.summary.total, 5); assert.equal(first.summary.pending, 0);
  assert.ok(first.items.some(x => x.status === 'failed') && first.items.some(x => x.status === 'refunded'));
  assert.ok(first.items.some(x => x.source === 'bakong' && x.status === 'test_paid'));
  assert.equal(JSON.stringify(f.db.tables), before); assert.ok(f.db.history.every(x => x.op === 'read'));
  const row = f.db.tables.billing_transactions.find(x => x.id === id(1000)); row.status = 'approved';
  f.db.tables.tenh_billing_invoices.push(invoice(1000));
  const second = await (await f.history()).json(), late = second.items.find(x => x.sourceId === id(1000));
  assert.equal(second.summary.total, 6); assert.equal(late.status, 'approved'); assert.equal(late.invoiceId, id(1100));
});
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
  const body = await (await f.history()).json(); assert.equal(body.items.length, statuses.length - 2); assert.ok(body.items.every(item => !["pending", "draft"].includes(item.status)));
  for (const item of body.items) { assert.equal(item.invoiceId, null); assert.equal(item.paidAt, null); assert.equal(item.confirmedPaid, false); }
  assert.equal(body.summary.approvedUsdTotal, 0); assert.equal((await f.receipt()).status, 404);
});
test('approved missing invoice remains unavailable, without writes or synthesized historical coverage', async () => {
  const f = fixture({ invoices: [] }); const item = (await (await f.history()).json()).items[0];
  assert.equal(item.invoiceId, null); assert.equal(item.periodStart, null); assert.equal(item.periodEnd, null); assert.equal((await f.receipt()).status, 404);
  assert.equal(f.db.history.every(entry => entry.op === 'read'), true);
});

test('ended unpaid PayWay sessions have no customer billing row; later money, review and receipts remain visible',async()=>{
 const metadata={environment:'production',checkout_session:{version:1,state:'closed',closed_at:'2026-10-17T12:00:00Z'}};
 const unpaid=payment(7,{status:'pending',provider_status:'PENDING',verified_at:null,metadata}),failed=payment(8,{status:'failed',provider_status:'FAILED',verified_at:null,metadata});
 const f=fixture({payments:[unpaid,failed],invoices:[]}),before=JSON.stringify(f.db.tables);
 assert.equal((await(await f.history()).json()).items.length,0);assert.equal(JSON.stringify(f.db.tables),before);assert.ok(f.db.history.every(x=>x.op==='read'));
 const row=f.db.tables.billing_transactions[0];row.status='approved';row.metadata=payment(7).metadata;row.metadata.checkout_session=metadata.checkout_session;row.provider_status='APPROVED';row.verified_at=paid;
 f.db.tables.tenh_billing_invoices.push(invoice(7));
 const history=await(await f.history()).json();assert.equal(history.items.length,1);assert.equal(history.items[0].invoiceId,id(107));assert.equal(history.items[0].status,'approved');
 f.db.tables.billing_transactions[1].status='recovery_required';assert.equal((await(await f.history()).json()).items.length,2);
});

test('hidden failed sessions do not consume the visible cap ahead of an older paid transaction and issued receipt',async()=>{
 const metadata={environment:'production',checkout_session:{version:1,state:'closed',closed_at:'2026-10-17T12:00:00Z'}};
 const hidden=Array.from({length:610},(_,n)=>payment(n+1000,{status:'failed',provider_status:'FAILED',verified_at:null,created_at:'2026-10-17',metadata}));
 const f=fixture({payments:[...hidden,payment(1)],invoices:[invoice(1)]}),before=JSON.stringify(f.db.tables);
 const response=await f.history(),result=await response.json();assert.equal(response.status,200);assert.equal(result.items.length,1);assert.equal(result.items[0].sourceId,id(1));assert.equal(result.items[0].invoiceId,id(101));assert.equal(result.summary.receipts,1);
 assert.equal(JSON.stringify(f.db.tables),before);assert.ok(f.db.history.every(x=>x.op==='read'));assert.equal(f.db.history.filter(x=>x.table==='billing_transactions').length,4,'three scoped PayWay pages and unchanged historical Bakong lookup');
});

test('history fails explicitly at its bounded scan instead of silently returning an incomplete visible list',async()=>{
 const metadata={checkout_session:{version:1,state:'closed',closed_at:'2026-10-17T12:00:00Z'}};
 const hidden=Array.from({length:3000},(_,n)=>payment(n+1000,{status:'failed',provider_status:'FAILED',metadata}));
 const f=fixture({payments:[...hidden,payment(1)],invoices:[invoice(1)]});const response=await f.history(),result=await response.json();
 assert.equal(response.status,500);assert.equal(result.success,false);assert.equal(result.items,undefined);assert.equal(f.db.history.filter(x=>x.table==='billing_transactions').length,11);assert.ok(f.db.history.every(x=>x.op==='read'));
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
