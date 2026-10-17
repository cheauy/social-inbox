/* eslint-disable @typescript-eslint/no-require-imports -- Offline auth regression fixtures. */
const test = require('node:test'), assert = require('node:assert/strict');
const { dashboardFixture, loginFixture, user } = require('./fixtures/login-performance.cjs');

for (const [name, options, expected] of [
  ['configured admin', {}, true],
  ['ordinary user', { user: { ...user, id: '20000000-0000-4000-8000-000000000002' } }, false],
  ['unverified address', { user: { ...user, email_confirmed_at: null } }, false],
  ['wrong email', { user: { ...user, email: 'other@example.test' } }, false],
  ['missing configuration', { env: { TENH_ADMIN_USER_ID: '' } }, false],
]) test(`dashboard navigation reuses its verified user (${name})`, async () => {
  const f = dashboardFixture(options), tree = await f.render();
  assert.equal(tree.props.isAdmin, expected); assert.equal(f.calls.member, 1);
  assert.equal(f.calls.extraUser, 0); assert.equal(f.calls.subscription, 1);
});

test('an unauthenticated dashboard still redirects before reading private subscription data', async () => {
  const f = dashboardFixture({ auth: { success: false, status: 401 } });
  await assert.rejects(f.render(), error => error.redirect === '/login');
  assert.equal(f.calls.subscription, 0); assert.equal(f.calls.extraUser, 0);
});

test('remember duration is fetched only when selected; login remains server-controlled', async () => {
  const f = loginFixture(); await f.settle(); assert.equal(f.requests.length, 0);
  f.input('remember-me', true); await f.settle();
  assert.equal(f.requests.filter(request => request.url === '/api/auth/policy').length, 1);
  f.submit(); await f.settle();
  assert.equal(JSON.parse(f.requests.at(-1).init.body).rememberMe, true); f.dispose();
});

for (const provider of ['email', 'google', 'facebook']) test(`${provider} stays single-flight through the redirect transition`, async () => {
  let release;
  const f = loginFixture({ response: () => new Promise(resolve => { release = resolve; }) });
  const click = () => provider === 'email' ? f.submit() : f.oauth(provider);
  click(); click(); f.oauth(provider === 'google' ? 'facebook' : 'google');
  assert.equal(f.requests.filter(request => request.init?.method === 'POST').length, 1);
  release(Response.json({ success: true, redirect: '/dashboard/inbox', url: 'https://provider.test/authorize' })); await f.settle();
  click(); await f.settle();
  assert.equal(f.requests.filter(request => request.init?.method === 'POST').length, 1);
  assert.equal(f.navigations.length, 1); f.dispose();
});

for (const response of [new TypeError('Synthetic offline'), () => Response.json({ success: false, code: 'AUTH_INVALID_CREDENTIALS' }, { status: 400 })]) test(`failed email login can retry (${typeof response === 'function' ? 'wrong credentials' : 'network'})`, async () => {
  const f = loginFixture({ response }); f.submit(); await f.settle(); f.submit(); await f.settle();
  assert.equal(f.requests.filter(request => request.init?.method === 'POST').length, 2); assert.equal(f.navigations.length, 0); f.dispose();
});

test('returning from an OAuth provider via browser history restores the login controls', async () => {
  const f = loginFixture(); f.oauth('google'); await f.settle();
  f.restore(); f.render(); f.oauth('google'); await f.settle();
  assert.equal(f.requests.filter(request => request.init?.method === 'POST').length, 2); assert.equal(f.navigations.length, 2); f.dispose();
});

for (const redirect of ['https://other.example.test', '//other.example.test', '/\\other.example.test']) test(`an unsafe server redirect stays on the login form (${redirect})`, async () => {
  const f = loginFixture({ response: () => Response.json({ success: true, redirect }) });
  f.submit(); await f.settle(); f.submit(); await f.settle();
  assert.equal(f.navigations.length, 0); assert.equal(f.requests.filter(request => request.init?.method === 'POST').length, 2); f.dispose();
});

test('a login response arriving after unmount cannot navigate the old page', async () => {
  let release;
  const f = loginFixture({ response: () => new Promise(resolve => { release = resolve; }) }); f.submit();
  f.dispose(); release(Response.json({ success: true, redirect: '/dashboard/inbox' })); await f.settle();
  assert.equal(f.navigations.length, 0);
});

test('an aborted response cannot overwrite a newer login after browser-history restoration', async () => {
  const pending = []; let attempts = 0;
  const f = loginFixture({ response: () => ++attempts === 1 ? { ok: false, status: 400, json: () => new Promise(resolve => { pending[0] = resolve; }) } : new Promise(resolve => { pending[1] = resolve; }) });
  f.submit(); await f.settle(); f.restore(); f.render(); f.submit();
  pending[0]({ success: false, code: 'AUTH_INVALID_CREDENTIALS' }); await f.settle();
  assert.equal(f.hasError(), false); assert.equal(f.navigations.length, 0);
  assert.equal(f.requests[0].init.signal.aborted, true); assert.equal(f.requests[1].init.signal.aborted, false);
  pending[1](Response.json({ success: true, redirect: '/dashboard/inbox' })); await f.settle();
  assert.deepEqual(f.navigations, ['/dashboard/inbox']); f.dispose();
});
