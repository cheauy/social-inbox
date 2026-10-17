/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic saved responses only: no account, provider, database or real payment access.
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom'), { loader } = require('./tenh-seven/harness.cjs');

async function fixture(patch = {}, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.tenhchat.com/dashboard/subscription/payment' });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const previous = {};
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous[key] = global[key]; global[key] = value;
  }
  const kind = options.kind ?? 'manual', requests = [], navigations = [], timers = new Map();
  let sequence = 0, resolveRead, resolveSwitch;
  const record = { kind, id: 'attempt-B', businessId: 'workspace-B', businessName: 'Workspace B', workspaceName: 'Workspace B',
    planCode: 'standard', billingCycle: '12-months', amount: 48.75, currency: 'USD', reference: 'saved-reference', customerReference: 'T7K9M2XP',
    status: 'approved', environment: kind === 'manual' ? 'manual' : 'production', invoiceId: 'invoice-B', application: 'active',
    state: 'applied', userId: 'user-B', memberId: 'member-B', createdAt: '2026-10-16T00:00:00Z', expiresAt: '2026-10-16T00:15:00Z',
    serverTime: '2026-10-16T00:01:00Z', nextCheckAt: '2026-10-16T00:05:00Z', checkout: 'open', canCheck: false,
    automaticChecksRemaining: 0, ...patch };
  const read = () => options.readError ? new Response('{}', { status: options.readError }) : Response.json({ success: true, attempt: { ...record } });
  const fetcher = async (url, init = {}) => {
    requests.push({ url, init });
    if (url === '/api/workspaces/switch') {
      if (options.delaySwitch) return new Promise(resolve => { resolveSwitch = resolve; });
      return Response.json(options.switchFailure ? { success: false } : { success: true, businessId: record.businessId });
    }
    assert.equal(init.method ?? 'GET', 'GET', 'success display never verifies or creates another payment');
    if (options.delayRead) return new Promise(resolve => { resolveRead = () => resolve(read()); });
    return read();
  };
  const schedule = fn => { timers.set(++sequence, fn); return sequence; };
  const router = { replace: path => navigations.push(path) };
  const load = loader({ react: React,
    'next/link': ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children),
    'next/navigation': { useRouter: () => router },
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => options.language ?? 'en' },
    '@/lib/supabase/client': { createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) },
  }, { window: { HTMLElement: dom.window.HTMLElement, addEventListener: dom.window.addEventListener.bind(dom.window), removeEventListener: dom.window.removeEventListener.bind(dom.window), location: { assign: path => navigations.push(path) } },
    document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, AbortController, URLSearchParams, performance: { now: () => 0 },
    setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: schedule, clearInterval: id => timers.delete(id) });
  const { PaymentAttemptView } = load('components/subscription/payment-attempt-view.tsx');
  const root = createRoot(dom.window.document.querySelector('#root'));
  const render = () => act(async () => root.render(React.createElement(PaymentAttemptView, { kind, attemptId: record.id, businessId: record.businessId })));
  await render();
  return { dom, record, requests, navigations, root, render,
    refreshSaved: () => act(async () => dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'))),
    text: () => dom.window.document.body.textContent,
    click: label => act(async () => [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === label).click()),
    releaseRead: () => act(async () => resolveRead()),
    releaseSwitch: result => act(async () => resolveSwitch(Response.json(result))),
    async reload() { await act(async () => root.render(null)); await render(); },
    async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } },
  };
}

test('live manual, ABA and Bakong success use saved summary, exact receipt and no test label', async t => {
  for (const kind of ['manual', 'payway', 'bakong']) await t.test(kind, async () => {
    const f = await fixture({}, { kind });
    try {
      assert.equal(f.dom.window.document.querySelector('h1').textContent, 'Payment successful');
      assert.match(f.text(), /Your subscription is active\./);
      for (const text of ['Workspace B', 'Team', '1 Year', '$48.75', kind === 'payway' ? 'ABA PayWay' : kind === 'bakong' ? 'Bakong KHQR' : 'Manual transfer']) assert.ok(f.text().includes(text), text);
      assert.ok(!f.text().includes('Test payment')); assert.ok(!f.text().includes('$25'));
      const receipt = [...f.dom.window.document.querySelectorAll('a')].find(a => a.textContent === 'View receipt');
      assert.match(receipt.getAttribute('href'), /^\/dashboard\/subscription\/invoices\/invoice-B\?return_to=/);
      assert.match(decodeURIComponent(receipt.getAttribute('href')), /purchase_business=workspace-B/);
      assert.ok(!f.text().includes('official ABA'));
      await f.reload(); assert.equal(f.dom.window.document.querySelector('h1').textContent, 'Payment successful');
      assert.ok(f.requests.every(request => (request.init.method ?? 'GET') === 'GET'));
    } finally { await f.close(); }
  });
});

test('sandbox results never assert real payment or active paid access', async t => {
  for (const kind of ['payway', 'bakong']) await t.test(kind, async () => {
    const f = await fixture({ environment: 'sandbox', ...(kind === 'bakong' ? { state: 'test_paid', application: 'none' } : {}) }, { kind });
    try {
      assert.match(f.text(), /Test payment confirmed/); assert.match(f.text(), /Test amount/);
      assert.match(f.text(), /No real-money settlement/);
      assert.ok(!f.text().includes('Payment successful')); assert.ok(!f.text().includes('Your subscription is active'));
    } finally { await f.close(); }
  });
});

test('unresolved, terminal, historical, unknown and conflicting states cannot enter live success', async t => {
  const states = [
    { status: 'submitted', application: 'pending' }, { status: 'pending', application: 'pending' },
    ...['failed', 'cancelled', 'expired', 'rejected', 'declined'].map(status => ({ status, application: null })),
    { application: 'pending' }, { application: 'historical' }, { application: 'review' }, { environment: 'unknown' },
    { status: 'pending', application: 'active' },
  ];
  for (const patch of states) await t.test(JSON.stringify(patch), async () => {
    const f = await fixture(patch);
    try { assert.ok(!f.text().includes('Payment successful')); assert.ok(!f.text().includes('Your subscription is active')); assert.ok(!f.text().includes('Go to inbox')); }
    finally { await f.close(); }
  });
  for (const patch of [{ state: 'pending', application: 'active' }, { state: 'verified', application: 'none' }, { state: 'review' }, { reconciliationRequired: true }, { application: 'historical' }]) {
    const f = await fixture(patch, { kind: 'bakong' });
    try { assert.ok(!f.text().includes('Payment successful')); assert.ok(!f.text().includes('Go to inbox')); }
    finally { await f.close(); }
  }
});

test('loading, denied and temporary read errors never show success; missing receipt has no fabricated link', async () => {
  const loading = await fixture({}, { delayRead: true });
  try { assert.match(loading.text(), /Preparing payment/); assert.ok(!loading.text().includes('Payment successful')); await loading.releaseRead(); assert.match(loading.text(), /Payment successful/); }
  finally { await loading.close(); }
  for (const status of [401, 403, 404, 503]) {
    const f = await fixture({}, { readError: status });
    try { assert.ok(!f.text().includes('Payment successful')); assert.ok(f.dom.window.document.querySelector('[role="alert"]')); }
    finally { await f.close(); }
  }
  const f = await fixture({ invoiceId: null });
  try { assert.match(f.text(), /Receipt unavailable/); assert.equal(f.dom.window.document.querySelector('a'), null); }
  finally { await f.close(); }
});

test('navigation switches to purchased workspace, deduplicates clicks and preserves retry on failure', async () => {
  const f = await fixture({}, { delaySwitch: true });
  try {
    await f.click('Go to inbox'); await f.click('Go to inbox');
    const switches = f.requests.filter(request => request.url === '/api/workspaces/switch');
    assert.equal(switches.length, 1); assert.deepEqual(JSON.parse(switches[0].init.body), { businessId: 'workspace-B' });
    assert.deepEqual(f.navigations, []);
    await f.releaseSwitch({ success: true, businessId: 'workspace-B' }); assert.deepEqual(f.navigations, ['/dashboard/inbox']);
  } finally { await f.close(); }
  for (const kind of ['manual','payway','bakong']) {
    const failed = await fixture({}, { switchFailure: true, kind });
    try {
      await failed.click('Go to inbox'); assert.match(failed.text(), /Unable to open workspace/); assert.deepEqual(failed.navigations, []);
      await failed.click('Go to inbox'); assert.equal(failed.requests.filter(request => request.url === '/api/workspaces/switch').length, 2);
      assert.equal(failed.dom.window.document.querySelector('h1').textContent,'Payment successful');
      assert.ok(!failed.text().includes('Unable to check payment'));assert.ok(!failed.requests.some(request=>request.url.startsWith('/api/payway/status')));
    } finally { await failed.close(); }
  }
  const back = await fixture();
  try { await back.click('Back to subscription'); assert.deepEqual(back.navigations, ['/dashboard/subscription']); }
  finally { await back.close(); }
});

test('Khmer copy and keyboard focus keep all success controls accessible', async () => {
  const f = await fixture({}, { language: 'km' });
  try {
    assert.equal(f.dom.window.document.querySelector('h1').textContent, 'ការទូទាត់ជោគជ័យ');
    const controls = [...f.dom.window.document.querySelectorAll('button,a')]; assert.equal(controls.length, 4);
    for (const control of controls) { control.focus(); assert.equal(f.dom.window.document.activeElement, control); assert.match(control.className, /min-h-11/); assert.match(control.className, /focus-visible:outline/); }
  } finally { await f.close(); }
});

test('legacy saved Bakong status reopens its modal after success becomes historical and preserves reconciliation behavior',async()=>{
 const f=await fixture({}, {kind:'bakong'});try{
  assert.match(f.text(),/Payment successful/);f.record.application='historical';await f.refreshSaved();
  const dialog=f.dom.window.document.querySelector('dialog');assert.ok(dialog);assert.equal(dialog.open,true);
  assert.ok(!f.text().includes('Payment successful'));assert.ok(!f.text().includes('Go to inbox'));
  f.record.application='active';await f.refreshSaved();assert.match(f.text(),/Payment successful/);
  assert.equal(f.dom.window.document.querySelector('dialog'),null);assert.ok(f.requests.every(r=>(r.init.method??'GET')==='GET'));
 }finally{await f.close();}
});
