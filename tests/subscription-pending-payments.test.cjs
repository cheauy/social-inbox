/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic memberships/payments and real React only; no hosted or provider requests.
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { loader, database } = require('./tenh-seven/harness.cjs');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const ID = '10000000-0000-4000-8000-000000000001';
const START = Date.parse('2026-10-16T10:00:00Z');
function server(options = {}) {
  const db = database({ team_members: [
    { id: 'owner-a', user_id: 'user', business_id: A, role: 'owner', is_active: true },
    { id: 'joined-b', user_id: 'user', business_id: B, role: 'agent', is_active: true },
    { id: 'removed', user_id: 'user', business_id: 'removed', role: 'owner', is_active: false },
    { id: 'unrelated', user_id: 'other', business_id: 'other', role: 'owner', is_active: true },
  ], payment_cancellations: [], manual_payment_requests: [], manual_payment_uploads: [], billing_transactions: [], bakong_payment_attempts: [], ...options.seed });
  const load = loader({ '@/lib/supabase/admin': { supabaseAdmin: db }, '@/lib/supabase/server': {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: 'user' } }, error: null }) } }),
  } }, { URLSearchParams });
  return { db, get: () => load('app/api/subscription/pending-payments/route.ts').GET(new Request('https://app.tenhchat.com/api/subscription/pending-payments')) };
}
const billing = (patch = {}) => ({ id: ID, business_id: A, provider: 'bakong', provider_transaction_id: ID,
  plan_code: 'pro', billing_cycle: 'monthly', amount: '32.53', currency: 'USD', status: 'pending', created_at: '2026-10-16T10:00:00Z', ...patch });
test('read-only summary scopes private attempts to current billing managers, with no proof or provider payload', async () => {
  const f = server({ seed: { billing_transactions: [billing(), billing({ id: 'other', business_id: B, provider: 'payway' }), billing({ id: 'removed', business_id: 'removed' }), billing({ id: 'unrelated', business_id: 'other' })],
    bakong_payment_attempts: [{ id: ID, business_id: A, state: 'pending', expires_at: '2099-01-01T00:00:00Z', qr: 'PRIVATE', credential_fingerprint: 'SECRET' }],
    manual_payment_requests: [{ ...billing({ id: 'manual', provider: undefined }), status: 'submitted', proof_path: 'PRIVATE', metadata: { secret: 'SECRET' } }],
  } });
  const response = await f.get(), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.userId, 'user');
  assert.equal(data.items.length, 2); assert.ok(data.items.every(x => x.businessId === A && x.memberId === 'owner-a'));
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.ok(!JSON.stringify(data).includes('PRIVATE') && !JSON.stringify(data).includes('SECRET'));
  assert.ok(f.db.history.every(x => x.op === 'read'));
});
test('submitted proof wins over its prepared ticket and never inherits a payment deadline; approved and rejected are resolved', async () => {
  for (const status of ['submitted', 'approved', 'rejected']) {
    const f = server({ seed: { manual_payment_requests: [{ ...billing(), status }], manual_payment_uploads: [{ id: ID, business_id: A, member_id: 'owner-a', state: 'submitted', request_payload: billing() }] } });
    const data = await (await f.get()).json();
    assert.equal(data.items.length, status === 'submitted' ? 1 : 0);
    if (status === 'submitted') { assert.equal(data.items[0].status, 'submitted'); assert.equal(data.items[0].expiresAt, null); }
  }
});
test('only the initiating member resumes prepared manual upload; PayWay has no invented deadline', async () => {
  const f = server({ seed: { manual_payment_uploads: [
    { id: ID, business_id: A, member_id: 'owner-a', state: 'prepared', request_payload: billing() },
    { id: 'different-member', business_id: A, member_id: 'another-owner', state: 'prepared', request_payload: billing() },
  ], billing_transactions: [billing({ provider: 'payway', provider_transaction_id: 'SAVED_REFERENCE' })] } });
  const data = await (await f.get()).json(); assert.equal(data.items.length, 2);
  assert.ok(data.items.every(x => x.expiresAt === null && x.status === 'pending'));
  assert.ok(data.items.some(x => x.resumeUrl.includes('manual_request=' + ID)));
  assert.ok(data.items.some(x => x.resumeUrl.includes('tran_id=SAVED_REFERENCE') && x.resumeUrl.includes('purchase_business=' + A)));
});
test('expired unpaid KHQR is hidden but retained without writes; query/auth failures fail closed', async () => {
  const f = server({ seed: { billing_transactions: [billing()], bakong_payment_attempts: [{ id: ID, business_id: A, state: 'pending', expires_at: '2000-01-01T00:00:00Z' }] } });
  assert.deepEqual((await (await f.get()).json()).items, []); assert.equal(f.db.tables.bakong_payment_attempts.length, 1);
  assert.ok(f.db.history.every(x => x.op === 'read'));
  f.db.failures.push({ table: 'team_members' }); assert.equal((await f.get()).status, 503);
  assert.equal((await server({ unauthenticated: true }).get()).status, 401);
});
test('newest active membership determines access, with explicit billing delegation required for joined users', async () => {
  const f = server({ seed: { team_members: [
    { id: 'new-agent', user_id: 'user', business_id: A, role: 'agent', permissions: {}, is_active: true },
    { id: 'old-owner', user_id: 'user', business_id: A, role: 'owner', is_active: true },
  ], billing_transactions: [billing({ provider: 'payway', provider_transaction_id: 'SAVED' })] } });
  assert.deepEqual((await (await f.get()).json()).items, []);
  f.db.tables.team_members[0].permissions = { billing: 'manage' };
  const data = await (await f.get()).json(); assert.equal(data.items.length, 1); assert.equal(data.items[0].memberId, 'new-agent');
  f.db.failures.push({ table: 'payment_cancellations' }); assert.equal((await f.get()).status, 503);
});
test('provider review stays visible; an expired or customer-closed unpaid KHQR checkout is hidden', async () => {
  const future = new Date(Date.now() + 600000).toISOString();
  for (const mode of ['open', 'expired', 'closed', 'review', 'late-paid-after-close']) {
    const f = server({ seed: { billing_transactions: [billing()],
      bakong_payment_attempts: [{ id: ID, business_id: A, state: mode === 'review' || mode === 'late-paid-after-close' ? 'review' : 'pending',
        verified_hash: mode === 'late-paid-after-close' ? 'a'.repeat(64) : null, expires_at: mode === 'expired' ? '2000-01-01T00:00:00Z' : future }],
      payment_cancellations: mode === 'closed' || mode === 'late-paid-after-close' ? [{ kind: 'bakong', payment_id: ID, business_id: A, outcome: 'checkout_closed' }] : [],
    } });
    const data = await (await f.get()).json();
    if (mode === 'expired' || mode === 'closed') assert.deepEqual(data.items, [], mode);
    else assert.equal(data.items[0].status, mode === 'open' ? 'pending' : 'reconciliation_required', mode);
    assert.ok(f.db.history.every(x => x.op === 'read'));
  }
});
const workspace = (patch = {}) => ({ memberId: 'owner-a', businessId: A, businessName: 'Active workspace', role: 'owner', canManageBilling: true, ownerName: 'Owner', usage: { members: 2, channels: 3 },
  subscription: { id: 'sub-active', plan_code: 'standard', status: 'active', member_limit: 8, channel_limit: 12, current_period_end: '2099-01-01T00:00:00Z', billing_cycle: 'monthly', last_paid_amount: 20, last_paid_currency: 'USD', pricing_snapshot: {} }, ...patch });
const entry = (patch = {}) => ({ id: ID, kind: 'bakong', businessId: A, memberId: 'owner-a', planCode: 'pro', billingCycle: 'monthly', amount: 32.53, currency: 'USD', status: 'pending', expiresAt: new Date(START + 120000).toISOString(), resumeUrl: '/dashboard/subscription/payment?bakong_attempt=' + ID + '&purchase_business=' + A, ...patch });
async function ui(options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/dashboard/subscription' });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  const previous = {}; for (const [k, v] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) { previous[k] = global[k]; global[k] = v; }
  let clock = options.elapsed ?? 0, next = 0, listener; const timers = new Map(), requests = [];
  const model = { payments: options.payments ?? [entry()], workspaces: options.workspaces ?? [workspace()], userId: 'user', ...options.model };
  const schedule = (fn, delay, repeat) => { const id = ++next; timers.set(id, { fn, delay, at: clock + delay, repeat }); return id; };
  const client = { auth: { getSession: async () => ({ data: { session: { user: { id: model.userId } } } }), onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; } } };
  const load = loader({ react: React, '@/lib/supabase/client': { createClient: () => client }, '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => options.language ?? 'en' },
    '@/lib/workspaces/read-workspaces': { invalidateWorkspaceRead() {}, readWorkspaces: async () => Response.json({ success: true, currentBusinessId: A, workspaces: model.workspaces }) },
  }, { AbortController, window: dom.window, document: dom.window.document, navigator: { onLine: true }, performance: { now: () => clock },
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id), setTimeout: (fn, delay) => schedule(fn, delay, false), clearTimeout: id => timers.delete(id),
    fetch: async (url, init = {}) => { requests.push({ url, method: init.method ?? 'GET' }); if (options.fetch) return options.fetch(url, model); return Response.json({ success: true, userId: model.userId, serverTime: new Date(START + clock).toISOString(), items: model.payments }); },
  });
  const Component = load('components/subscription/subscription-membership-list.tsx').SubscriptionMembershipList;
  const root = createRoot(dom.window.document.querySelector('#root'));
  const render = () => act(async () => root.render(React.createElement(Component)));
  await render();
  return { dom, model, requests, render, root, text: () => dom.window.document.body.textContent,
    auth: async (event, session) => act(async () => listener(event, session)),
    click: async name => act(async () => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === name).click()),
    advance: async ms => { clock += ms; await act(async () => { for (const [id, t] of [...timers]) if (t.at <= clock) { if (t.repeat) t.at = clock + t.delay; else timers.delete(id); await t.fn(); } }); },
    close: async () => { await act(async () => root.unmount()); dom.window.close(); for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete global[k]; else global[k] = v; } },
  };
}
test('upgrade countdown/resume preserves the Active row and hides only its expired pending entry', async () => {
  const f = await ui(); try {
    assert.match(f.text(), /Pending payment/); assert.match(f.text(), /Requested plan/); assert.match(f.text(), /02:00/);
    const active = f.dom.window.document.querySelector('tbody tr'); assert.match(active.textContent, /Active/);
    const resume = [...f.dom.window.document.querySelectorAll('a')].find(a => a.textContent === 'Continue payment'); assert.equal(resume.getAttribute('href'), entry().resumeUrl);
    await f.advance(30000); assert.match(f.text(), /01:30/); await f.click('Refresh'); assert.match(f.text(), /01:30/);
    await f.advance(91000); assert.doesNotMatch(f.text(), /Pending payment|Reconciliation required/); assert.equal(f.dom.window.document.querySelector('ul'), null); assert.equal(f.dom.window.document.querySelector('tbody tr'), active);
    assert.match(f.text(), /3 \/ 12/); assert.match(f.text(), /2 \/ 8/); assert.ok(f.requests.every(x => x.method === 'GET'));
  } finally { await f.close(); }
});
test('manual review outlives deadlines; authoritative resolution refreshes Active without claiming a payment result', async () => {
  const f = await ui({ payments: [entry({ kind: 'manual', status: 'submitted', expiresAt: new Date(START - 1).toISOString() })] }); try {
    assert.match(f.text(), /Submitted for review/); assert.equal(f.dom.window.document.querySelector('time'), null);
    await f.advance(3600000); assert.match(f.text(), /Submitted for review/);
    f.model.payments = []; f.model.workspaces = [workspace({ subscription: { ...workspace().subscription, plan_code: 'pro', channel_limit: 13 } })];
    await f.click('Refresh'); assert.doesNotMatch(f.text(), /Submitted for review/); assert.match(f.text(), /3 \/ 13/);
  } finally { await f.close(); }
});
test('filters, deduplication, unauthorized identity, empty states and logout keep private attempts scoped', async () => {
  const f = await ui({ payments: [entry(), entry(), entry({ businessId: B, memberId: 'joined-b' })], workspaces: [workspace(), workspace({ businessId: B, memberId: 'joined-b', role: 'agent', canManageBilling: false })] }); try {
    assert.equal(f.dom.window.document.querySelectorAll('a').length, 1);
    await f.click('Joined'); assert.doesNotMatch(f.text(), /Pending payment/); await f.click('Owned'); assert.match(f.text(), /Pending payment/);
    await f.auth('SIGNED_OUT', null); assert.doesNotMatch(f.text(), /Pending payment|Active workspace/);
  } finally { await f.close(); }
  const empty = await ui({ payments: [], workspaces: [] }); try { assert.match(empty.text(), /No current subscriptions/); } finally { await empty.close(); }
});
test('new mount retains the saved deadline and server refresh handles rejection without changing Active', async () => {
  const f = await ui({ elapsed: 90000 }); try {
    assert.match(f.text(), /00:30/);
    f.model.payments = []; await f.advance(30000);
    assert.doesNotMatch(f.text(), /Awaiting payment/); assert.match(f.text(), /3 \/ 12/);
    assert.equal(f.model.workspaces[0].subscription.plan_code, 'standard');
  } finally { await f.close(); }
});
test('a wrong response identity fails closed and a failed summary never removes the Active subscription', async () => {
  for (const mode of ['wrong-user', 'network']) {
    const f = await ui({ fetch: () => { if (mode === 'network') throw Error('offline'); return Response.json({ success: true, userId: 'other-user', serverTime: new Date(START).toISOString(), items: [entry()] }); } });
    try { assert.doesNotMatch(f.text(), /Awaiting payment/); assert.match(f.text(), /Unable to load payments/); assert.match(f.text(), /Active workspace/); }
    finally { await f.close(); }
  }
});
test('logout invalidates delayed reads before they can restore private memberships or payments', async () => {
  let release;
  const f = await ui({ fetch: () => new Promise(resolve => { release = resolve; }) }); try {
    await f.auth('SIGNED_OUT', null);
    await act(async () => release(Response.json({ success: true, userId: 'user', serverTime: new Date(START).toISOString(), items: [entry()] })));
    assert.doesNotMatch(f.text(), /Pending payment|Active workspace/);
  } finally { await f.close(); }
});
test('permitted joined billing manager sees only their current membership and sorting applies to payment rows', async () => {
  const f = await ui({ workspaces: [workspace({ businessName: 'Zed' }), workspace({ businessId: B, businessName: 'Alpha', memberId: 'joined-b', role: 'agent', canManageBilling: true })],
    payments: [entry(), entry({ id: 'second', businessId: B, memberId: 'joined-b' }), entry({ id: 'stale', memberId: 'removed-member' })] });
  try {
    assert.equal(f.dom.window.document.querySelectorAll('ul li').length, 2);
    const select = f.dom.window.document.querySelector('select');
    await act(async () => { select.value = 'name'; select.dispatchEvent(new f.dom.window.Event('change', { bubbles: true })); });
    assert.match(f.dom.window.document.querySelector('ul li').textContent, /Alpha/);
    await f.click('Joined'); assert.equal(f.dom.window.document.querySelectorAll('ul li').length, 1);
    assert.match(f.dom.window.document.querySelector('ul li').textContent, /Alpha/);
  } finally { await f.close(); }
});
test('saved-state polling is bounded, pauses while hidden, and never calls a provider or mutation', async () => {
  const f = await ui({ payments: [entry({ expiresAt: null })] }); try {
    Object.defineProperty(f.dom.window.document, 'hidden', { configurable: true, value: true });
    await f.advance(30000); assert.equal(f.requests.length, 1);
    Object.defineProperty(f.dom.window.document, 'hidden', { configurable: true, value: false });
    for (let i = 0; i < 25; i++) await f.advance(30000);
    assert.equal(f.requests.length, 21);
    assert.ok(f.requests.every(request => request.method === 'GET' && request.url === '/api/subscription/pending-payments'));
  } finally { await f.close(); }
});
test('subscription reads follow saved payment resolution instead of accepting an older parallel entitlement snapshot', async () => {
  const f = await ui({ fetch: async (url, model) => {
    await Promise.resolve();
    model.workspaces = [workspace({ subscription: { ...workspace().subscription, channel_limit: 13 } })];
    return Response.json({ success: true, userId: model.userId, serverTime: new Date(START).toISOString(), items: [] });
  } });
  try { assert.match(f.text(), /3 \/ 13/); assert.doesNotMatch(f.text(), /Awaiting payment/); }
  finally { await f.close(); }
});
test('expired pending stays hidden on reload while server-recorded review remains available without a timer', async () => {
  const f = await ui({ elapsed: 300000, payments: [entry(), entry({ id: 'review', status: 'reconciliation_required' })] });
  try {
    assert.equal(f.dom.window.document.querySelectorAll('ul li').length, 1);
    assert.match(f.text(), /Reconciliation required/); assert.doesNotMatch(f.text(), /Pending payment/);
    assert.equal(f.dom.window.document.querySelector('time'), null);
    assert.equal(f.model.payments[0].status, 'pending');
    await f.click('Refresh'); assert.equal(f.dom.window.document.querySelectorAll('ul li').length, 1);
    assert.ok(![...f.dom.window.document.querySelectorAll('a')].some(a => a.textContent === 'Continue payment'));
  } finally { await f.close(); }
});
