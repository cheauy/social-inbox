const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function setup(result = { type: 'success', url: 'tenhchat://auth/callback?code=test-code' }, exchangeError = null) {
  const calls = { exchanges: [], starts: [], browsers: [] };
  const module = { exports: {} };
  const dependencies = {
    'expo-linking': { createURL: (path, { scheme }) => `${scheme}://${path}` },
    'expo-web-browser': { openAuthSessionAsync: async (...args) => { calls.browsers.push(args); return result; } },
    '../supabase/client': { supabase: { auth: {
      signInWithOAuth: async (options) => { calls.starts.push(options); return { data: { url: 'https://auth.example/authorize' }, error: null }; },
      exchangeCodeForSession: async (code) => { calls.exchanges.push(code); return { error: exchangeError }; },
    } } },
  };
  const source = fs.readFileSync(require.resolve('./oauth.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', 'module', compiled)((name) => dependencies[name], module.exports, module);
  return { ...module.exports, calls };
}
for (const provider of ['google', 'facebook']) test(`${provider} returns to the native callback and exchanges the code`, async () => {
  const app = setup();
  assert.equal(await app.signInWithProvider(provider), true);
  assert.equal(app.calls.starts[0].options.redirectTo, 'tenhchat://auth/callback');
  assert.equal(app.calls.starts[0].options.skipBrowserRedirect, true);
  assert.equal(app.calls.browsers[0][1], 'tenhchat://auth/callback');
  assert.deepEqual(app.calls.exchanges, ['test-code']);
});
test('Router and auth browser exchange the same code once', async () => {
  const app = setup();
  await Promise.all([app.completeAuthCode('test-code'), app.signInWithProvider('google')]);
  assert.deepEqual(app.calls.exchanges, ['test-code']);
});
test('cancel does not exchange or create a session', async () => {
  const app = setup({ type: 'cancel' });
  assert.equal(await app.signInWithProvider('facebook'), false);
  assert.equal(app.calls.exchanges.length, 0);
});
test('provider errors remain errors', async () => {
  const app = setup({ type: 'success', url: 'tenhchat://auth/callback?error_description=Denied' });
  await assert.rejects(app.signInWithProvider('google'), /Denied/);
  assert.equal(app.calls.exchanges.length, 0);
});
test('expired codes do not report successful sign-in', async () => {
  const app = setup(undefined, new Error('Expired code'));
  await assert.rejects(app.signInWithProvider('google'), /Expired code/);
});
