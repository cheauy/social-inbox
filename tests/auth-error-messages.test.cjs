/* eslint-disable @typescript-eslint/no-require-imports -- Actual form handlers with isolated React hooks and HTTP responses. */
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react');
const { loader } = require('./tenh-seven/harness.cjs');

function formFixture(kind, language, response) {
  const states = [], requests = [], navigations = []; let cursor = 0, tree;
  const hooks = { ...React, useEffect() {}, useSyncExternalStore: () => true,
    useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; },
    useRef(initial) { const slot = cursor++; return states[slot] ??= { current: initial }; },
  };
  const component = loader({ react: hooks, 'next/link': 'a', 'next/navigation': { useSearchParams: () => new URLSearchParams() }, '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => language } }, {
    AbortController, sessionStorage: { setItem() {} }, window: { location: { assign: url => navigations.push(url) } },
    fetch: async (url, options) => { requests.push({ url, options }); if (response instanceof Error) throw response; return Response.json(response.body, { status: response.status }); },
  })(`components/auth/${kind}-form.tsx`)[kind === 'login' ? 'LoginForm' : 'RegisterForm'];
  const nodes = item => !item || typeof item !== 'object' ? [] : [item, ...[item.props?.children].flat(Infinity).flatMap(nodes)];
  const text = item => typeof item === 'string' ? item : !item || typeof item !== 'object' ? '' : [item.props?.children].flat(Infinity).map(text).join('');
  function render() { cursor = 0; tree = component(); }
  render();
  const values = kind === 'login' ? { 'login-email': 'synthetic@example.invalid', 'login-password': 'Synthetic123' } : { 'register-name': 'Synthetic person', 'register-workspace': 'Synthetic workspace', 'register-email': 'synthetic@example.invalid', 'register-password': 'Synthetic123', 'register-confirm-password': 'Synthetic123' };
  for (const [id, value] of Object.entries(values)) nodes(tree).find(node => node.props.id === id).props.onChange({ target: { value } });
  render();
  return { requests, navigations, async submit() { await nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await new Promise(setImmediate); render(); return text(nodes(tree).find(node => node.props.role === 'alert')); } };
}

for (const language of ['en', 'km']) test(`login shows safe localized credential, rate, unavailable and fallback messages (${language})`, async () => {
  const credentials = language === 'km' ? 'អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។ សូមព្យាយាមម្ដងទៀត។' : 'Incorrect email or password. Please try again.';
  const messages = [];
  for (const [response, expected] of [
    [{ status: 400, body: { success: false, code: 'AUTH_INVALID_CREDENTIALS', error: 'Private provider detail' } }, credentials],
    [{ status: 429, body: { success: false } }, language === 'km' ? null : 'Too many attempts. Wait and try again.'],
    [{ status: 503, body: { success: false } }, language === 'km' ? null : 'Sign-in is temporarily unavailable. Try again.'],
    [new TypeError('Synthetic network failure'), language === 'km' ? null : 'Sign-in is temporarily unavailable. Try again.'],
    [{ status: 400, body: { success: false, code: 'unknown', error: 'Private provider detail' } }, language === 'km' ? null : 'Unable to sign in. Check your details or try another sign-in method.'],
  ]) {
    const f = formFixture('login', language, response), message = await f.submit();
    messages.push(message);
    if (expected !== null) assert.equal(message, expected); else assert.ok(message);
    assert.equal(message.includes('Private provider detail'), false); assert.equal(f.requests.length, 1); assert.equal(f.navigations.length, 0);
  }
  assert.notEqual(messages[0], messages[1]); assert.notEqual(messages[1], messages[2]); assert.notEqual(messages[0], messages[2]); assert.equal(messages[2], messages[3]);
});

test('login success still follows the server destination', async () => {
  const f = formFixture('login', 'en', { status: 200, body: { success: true, redirect: '/dashboard/inbox' } });
  assert.equal(await f.submit(), ''); assert.deepEqual(f.navigations, ['/dashboard/inbox']);
});

for (const language of ['en', 'km']) test(`register displays the provider-confirmed duplicate message (${language})`, async () => {
  const f = formFixture('register', language, { status: 409, body: { success: false, code: 'ACCOUNT_EXISTS', error: 'Private provider detail' } });
  assert.equal(await f.submit(), language === 'km' ? 'អ៊ីមែលនេះបានចុះឈ្មោះរួចហើយ។ សូមចូលគណនី។' : 'This email is already registered. Please sign in.');
  assert.equal(f.requests.length, 1); assert.equal(f.navigations.length, 0);
});

test('register success still opens verification and operational failure does not claim a duplicate', async () => {
  const success = formFixture('register', 'en', { status: 202, body: { success: true } });
  assert.equal(await success.submit(), ''); assert.ok(success.navigations[0].startsWith('/verify-email?email='));
  const unavailable = formFixture('register', 'en', { status: 503, body: { success: false, code: 'AUTH_TEMPORARILY_UNAVAILABLE', error: 'Authentication is temporarily unavailable.' } });
  assert.equal(await unavailable.submit(), 'Authentication is temporarily unavailable.'); assert.equal(unavailable.navigations.length, 0);
});
