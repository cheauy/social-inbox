/* eslint-disable @typescript-eslint/no-require-imports */
// Real React with synthetic time, saved attempts and HTTP only; no provider or hosted access.
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom'), { loader } = require('./tenh-seven/harness.cjs');
const ID = '00000000-0000-4000-8000-000000000001', BUSINESS = '00000000-0000-4000-8000-000000000002';
const START = Date.now(), LIFETIME = 900000;

async function fixture(options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/dashboard/subscription/payment' });
  Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: false });
  if (options.locks) Object.defineProperty(dom.window.navigator, 'locks', { configurable: true, value: options.locks });
  const previous = {};
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous[key] = global[key]; global[key] = value;
  }
  let clock = options.elapsed ?? 0, sequence = 0, record = {
    id: ID, businessId: BUSINESS, userId: 'synthetic-user', memberId: 'synthetic-member', workspaceName: 'Synthetic workspace',
    recipientName: 'SYNTHETIC RECEIVER',
    planCode: 'custom', billingCycle: '12-months', amount: '32.53', currency: 'USD', reference: 'SYNTHETIC', transactionReference: null,
    environment: 'production', state: 'pending', application: 'none', qrImage: 'data:image/png;base64,c3ludGhldGlj',
    createdAt: new Date(START).toISOString(), expiresAt: new Date(START + LIFETIME).toISOString(), nextCheckAt: new Date(START + 300000).toISOString(),
    serverTime: new Date(START + clock).toISOString(), invoiceId: null, canCheck: true, automaticChecksRemaining: 3,
    ...options.record,
  };
  const timers = new Map(), requests = [], navigations = [], authListeners = new Set(), root = createRoot(dom.window.document.querySelector('#root'));
  const schedule = (fn, delay, repeat = false) => { const id = ++sequence; timers.set(id, { fn, at: clock + delay, delay, repeat }); return id; };
  const router = { replace: href => navigations.push(href) };
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? 'GET'; requests.push({ url, method });
    assert.ok(url.startsWith('/api/bakong/payments/'), 'no creation, workspace mutation, provider or external requests');
    assert.ok(url.includes(`purchase_business=${BUSINESS}`));
    if (method === 'POST') {
      record.automaticChecksRemaining = Math.max(0, record.automaticChecksRemaining - 1);
      record.nextCheckAt = new Date(START + clock + 300000).toISOString();
    }
    const result = { ...record, serverTime: new Date(START + clock).toISOString() };
    return options.response ? options.response(result, method, init) : Response.json({ success: true, attempt: result });
  };
  const load = loader({
    react: React, 'next/link': ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children),
    'next/navigation': { useRouter: () => router },
    '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => options.language ?? 'en' },
    '@/lib/supabase/client': { createClient: () => ({ auth: { onAuthStateChange: fn => {
      authListeners.add(fn); return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } };
    } } }) },
  }, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, fetch: fetcher, AbortController,
    performance: { now: () => clock }, setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id) });
  const { BakongPaymentView } = load('components/subscription/bakong-payment-view.tsx');
  const render = props => act(async () => root.render(React.createElement(React.StrictMode, null,
    Array.from({ length: options.tabs ?? 1 }, (_, key) => React.createElement(BakongPaymentView, { key, attemptId: ID, businessId: BUSINESS, ...props })))));
  const advance = ms => act(async () => {
    clock += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= clock && timers.has(id)) {
      if (timer.repeat) timer.at = clock + timer.delay; else timers.delete(id);
      timer.fn();
    }
  });
  return { dom, root, record, requests, navigations, timers, render, advance, authListeners,
    async visibility(hidden) {
      Object.defineProperty(dom.window.document, 'hidden', { configurable: true, value: hidden });
      await act(async () => dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')));
    },
    async network(online) {
      Object.defineProperty(dom.window.navigator, 'onLine', { configurable: true, value: online });
      await act(async () => dom.window.dispatchEvent(new dom.window.Event(online ? 'online' : 'offline')));
    },
    async refresh() {
      const details = dom.window.document.querySelector('details'); if (details) details.open = true;
      await act(async () => [...dom.window.document.querySelectorAll('button')].find(button => ['Refresh status', 'Retry activation'].includes(button.textContent)).click());
    },
    clock: value => { clock = value; },
    setRecord: patch => Object.assign(record, patch),
    async reload(props) { await act(async () => root.render(null)); await render(props); },
    async close() {
      await act(async () => root.unmount()); dom.window.close();
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; }
    },
  };
}

test('KHQR card uses the saved QR, server receiver and exact amount with actions outside the card', async () => {
  const f = await fixture();
  try {
    await f.render();
    const card = f.dom.window.document.querySelector('figure[aria-label="KHQR payment card"]');
    assert.ok(card); assert.match(card.textContent, /SYNTHETIC RECEIVER/);
    assert.ok(!card.textContent.includes(f.record.workspaceName));
    const logo = card.querySelector('img[alt="KHQR"]');
    assert.equal(logo.getAttribute('src'), '/images/khqr.png');
    assert.equal(Number(logo.getAttribute('width')) / Number(logo.getAttribute('height')), 1248 / 514);
    const amount = card.querySelector('[aria-label="32.53 USD"]');
    assert.deepEqual([...amount.children].map(child => child.textContent), ['32.53', 'USD']);
    const qr = card.querySelector('img[alt="Scan Bakong KHQR to pay"]');
    assert.equal(qr.getAttribute('src'), f.record.qrImage); assert.ok(qr.parentElement.classList.contains('p-3'));
    assert.ok(card.querySelector('.border-dashed')); assert.equal(card.querySelector('button, a'), null);
    assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'), null, 'waiting is not active verification');
    assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(button => /Check payment|Refresh status/.test(button.textContent)));
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
  } finally { await f.close(); }
});

test('automatic inquiry uses POST only after five visible online minutes, not the initial status GET', async () => {
  const f = await fixture({ record: { nextCheckAt: new Date(START).toISOString() } });
  try {
    await f.render(); assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
    await f.advance(299999); assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
    await f.advance(1); assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
    assert.equal(f.record.automaticChecksRemaining, 2);
  } finally { await f.close(); }
});

test('visibility refresh reads status without moving the original five-minute verification deadline', async () => {
  const f = await fixture({ record: { nextCheckAt: new Date(START).toISOString() } });
  try {
    await f.render(); await f.advance(240000);
    await act(async () => f.dom.window.document.dispatchEvent(new f.dom.window.Event('visibilitychange')));
    assert.ok(f.requests.filter(request => request.method === 'GET').length >= 2);
    await f.advance(60000); assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
    await f.advance(240000); assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
  } finally { await f.close(); }
});

test('QR closes at its saved absolute 15-minute deadline and replaces the route once', async () => {
  const f = await fixture();
  try {
    await f.render(); assert.ok(f.dom.window.document.querySelector('img'));
    await f.advance(LIFETIME - 1); assert.ok(f.dom.window.document.querySelector('img')); assert.equal(f.navigations.length, 0);
    await f.advance(1);
    assert.equal(f.dom.window.document.querySelector('img'), null);
    // Expiry closes the checkout and returns to Subscription without an expired-payment panel.
    assert.deepEqual(f.navigations, ['/dashboard/subscription']);
    await f.advance(10000); assert.equal(f.navigations.length, 1);
    assert.equal(f.record.state, 'pending'); assert.equal(f.record.expiresAt, new Date(START + LIFETIME).toISOString());
  } finally { await f.close(); }
});

test('reload cannot renew the saved QR deadline', async () => {
  const f = await fixture({ elapsed: LIFETIME - 1000 });
  try {
    await f.render(); await f.reload();
    await f.advance(1000); assert.equal(f.navigations.length, 1); assert.equal(f.dom.window.document.querySelector('img'), null);
    await f.reload(); assert.equal(f.navigations.length, 2); assert.equal(f.dom.window.document.querySelector('img'), null);
    assert.ok(f.requests.every(r => r.method === 'GET'));
  } finally { await f.close(); }
});

test('a QR loaded after expiry returns immediately without another payment or provider check', async () => {
  const f = await fixture({ elapsed: LIFETIME + 10000 });
  try {
    await f.render(); assert.equal(f.navigations.length, 1); assert.equal(f.dom.window.document.querySelector('img'), null);
    assert.ok(f.requests.every(r => r.method === 'GET'));
  } finally { await f.close(); }
});

test('two tabs close the same saved QR without creating or extending an obligation', async () => {
  const f = await fixture({ elapsed: LIFETIME - 1000, tabs: 2 });
  try {
    await f.render(); assert.equal(f.dom.window.document.querySelectorAll('img[alt="Scan Bakong KHQR to pay"]').length, 2);
    await f.advance(1000); assert.equal(f.dom.window.document.querySelectorAll('img').length, 0);
    assert.equal(f.navigations.length, 2); assert.equal(new Set(f.navigations).size, 1);
    assert.ok(f.requests.every(r => r.method === 'GET'));
  } finally { await f.close(); }
});

test('a delayed response cannot add its transit time to QR validity', async () => {
  let release;
  const f = await fixture({ response: record => new Promise(resolve => { release = () => resolve(Response.json({ success: true, attempt: record })); }) });
  try {
    await f.render(); f.clock(LIFETIME + 1); await act(async () => release());
    assert.equal(f.dom.window.document.querySelector('img'), null); assert.equal(f.navigations.length, 1);
  } finally { await f.close(); }
});

test('closed QR on Subscription keeps reconciliation reachable and honors saved remaining inquiries', async () => {
  const f = await fixture({ elapsed: LIFETIME + 1, record: { automaticChecksRemaining: 1 } });
  try {
    await f.render({ qrClosed: true });
    assert.equal(f.navigations.length, 0); assert.equal(f.dom.window.document.querySelector('img'), null);
    assert.match(f.dom.window.document.body.textContent, /Select a plan again for a new QR/);
    await f.advance(300000); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
    await f.advance(300000); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
    assert.equal(f.record.state, 'pending');
  } finally { await f.close(); }
});

test('verified or successful payment at the boundary is not replaced by an expiry action', async t => {
  for (const state of ['verified', 'applied', 'test_paid', 'review']) await t.test(state, async () => {
    const f = await fixture({ elapsed: LIFETIME, record: { state, application: state === 'applied' ? 'active' : 'none', qrImage: null, canCheck: false } });
    try {
      await f.render(); await f.advance(1000);
      assert.equal(f.navigations.length, 0); assert.equal(f.dom.window.document.querySelector('img'), null);
    } finally { await f.close(); }
  });
});

test('a pending inquiry racing expiry keeps the saved result available on Subscription', async () => {
  let release;
  const f = await fixture({ elapsed: LIFETIME - 1000, record: { nextCheckAt: new Date(START).toISOString() }, response: (record, method) =>
    method === 'POST' ? new Promise(resolve => { release = () => resolve(Response.json({ success: true, attempt: { ...record, state: 'applied', application: 'active', qrImage: null, canCheck: false } })); }) : Response.json({ success: true, attempt: record }) });
  try {
    await f.render();
    await f.refresh();
    assert.equal(typeof release, 'function');
    assert.match(f.dom.window.document.body.textContent, /Checking payment status/);
    const spinner = f.dom.window.document.querySelector('[class*="animate-spin"]');
    assert.ok(spinner); assert.ok(spinner.classList.contains('motion-reduce:animate-none'));
    const status = spinner.closest('[role="status"]'); assert.equal(status.getAttribute('aria-live'), 'polite');
    await f.advance(1000); assert.equal(f.dom.window.document.querySelector('img'), null); assert.equal(f.navigations.length, 1);
    assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'), null, 'expiry stops the spinner while preserving the in-flight result');
    await act(async () => release()); assert.match(f.dom.window.document.body.textContent, /Subscription active/);
    assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'), null);
    assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  } finally { await f.close(); }
});

test('a successful inquiry just before expiry takes precedence over the pending timer', async () => {
  const f = await fixture({ elapsed: LIFETIME - 1000, record: { nextCheckAt: new Date(START).toISOString() }, response: (record, method) =>
    Response.json({ success: true, attempt: method === 'POST' ? { ...record, state: 'applied', application: 'active', qrImage: null, canCheck: false } : record }) });
  try {
    await f.render();
    await f.refresh();
    await f.advance(1000); assert.equal(f.navigations.length, 0); assert.match(f.dom.window.document.body.textContent, /Subscription active/);
  } finally { await f.close(); }
});

test('an offline or failed inquiry hides the QR at expiry without discarding the saved obligation', async () => {
  const f = await fixture({ elapsed: LIFETIME - 1000, record: { nextCheckAt: new Date(START).toISOString() }, response: (record, method) => {
    if (method === 'POST') throw new TypeError('Synthetic network failure');
    return Response.json({ success: true, attempt: record });
  } });
  try {
    await f.render();
    await f.refresh();
    assert.match(f.dom.window.document.body.textContent, /Payment status unavailable/);
    assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'), null);
    await f.advance(1000); assert.equal(f.navigations.length, 1); assert.equal(f.record.state, 'pending');
    assert.equal(f.dom.window.document.querySelector('img'), null);
  } finally { await f.close(); }
});

test('auth revocation clears the private payment and cannot initiate an expiry redirect', async () => {
  const f = await fixture({ elapsed: LIFETIME - 1000 });
  try {
    await f.render(); await act(async () => { for (const listener of f.authListeners) listener('SIGNED_OUT'); });
    await f.advance(1000); assert.equal(f.navigations.length, 0); assert.equal(f.dom.window.document.querySelector('img'), null);
    assert.ok(!f.dom.window.document.body.textContent.includes('Synthetic workspace'));
  } finally { await f.close(); }
});

test('exhausted shared inquiry allowance shows review, hides QR/checks and never starts a new payment', async () => {
  const f = await fixture({ record: { qrImage: null, canCheck: false, automaticChecksRemaining: 0,
    reconciliationRequired: true, reconciliationReason: 'INQUIRY_LIMIT_REVIEW' } });
  try {
    await f.render(); assert.match(f.dom.window.document.body.textContent, /Payment needs review/);
    assert.match(f.dom.window.document.body.textContent, /verification limit has been reached/);
    assert.match(f.dom.window.document.body.textContent, /Do not pay again/);
    assert.equal(f.dom.window.document.querySelector('img'), null);
    assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(button => button.textContent.includes('Refresh status')));
    await f.advance(300000); assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
    assert.equal(f.record.state, 'pending');
    assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'), null);
  } finally { await f.close(); }
});

test('Subscription starts with its overview and links to closed payment status without embedding a payment card', async () => {
  const marker = () => null;
  const denied = () => { throw Error('Unexpected checkout/auth/database execution'); };
  const load = loader({
    '@/components/subscription/subscription-view': { SubscriptionView: marker },
    '@/components/subscription/subscription-payment-view': { SubscriptionPaymentView: marker },
    '@/components/subscription/payment-attempt-view': { PaymentAttemptView: marker },
    '@/components/subscription/bakong-payment-view': { BakongPaymentView: marker },
    '@/components/display/workspace-language-text': { WorkspaceLanguageText: marker },
    '@/lib/auth/get-current-member': { getCurrentMember: denied },
    '@/lib/auth/require-permission': { memberHasPermission: denied },
    '@/lib/supabase/admin': { supabaseAdmin: new Proxy({}, { get: denied }) },
    '@/lib/subscription/plan-change-security': {}, '@/lib/subscription/sync-subscription-lifecycle': {},
    'next/navigation': { redirect: denied },
  });
  const payment = await load('app/dashboard/subscription/payment/page.tsx').default({ searchParams: Promise.resolve({ bakong_attempt: ID, purchase_business: BUSINESS }) });
  assert.equal(payment.props.children.props.businessId, BUSINESS);
  const subscription = await load('app/dashboard/subscription/page.tsx').default({ searchParams: Promise.resolve({ bakong_closed: ID, purchase_business: BUSINESS }) });
  const children = React.Children.toArray(subscription.props.children);
  assert.equal(children[0].type, marker, 'Subscription overview is first');
  assert.ok(!children.some(child => child.props.attemptId || child.props.qrClosed));
  const href = children[1].props.children.props.href;
  const params = new URL(href, 'https://fixture.invalid').searchParams;
  assert.equal(params.get('bakong_attempt'), ID); assert.equal(params.get('purchase_business'), BUSINESS);
  const saved = await load('app/dashboard/subscription/payment/page.tsx').default({ searchParams: Promise.resolve(Object.fromEntries(params)) });
  assert.equal(saved.props.children.props.qrClosed, true); assert.equal(saved.props.children.props.businessId, BUSINESS);
  const invalid = await load('app/dashboard/subscription/page.tsx').default({ searchParams: Promise.resolve({ bakong_closed: 'bad', purchase_business: BUSINESS }) });
  assert.equal(React.Children.toArray(invalid.props.children).length, 1);
});
