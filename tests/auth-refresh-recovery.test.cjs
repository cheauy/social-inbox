/* eslint-disable @typescript-eslint/no-require-imports -- Server adapter with isolated cookie stores and synthetic provider responses. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const ssr = require('@supabase/ssr');
const url = 'https://project.supabase.invalid';
const user = { id: 'synthetic-user' };
const authName = 'sb-project-auth-token';
const initial = [[authName, 'synthetic-session-A'], ['tenh_session_hint', 'synthetic-hint-A'], ['tenh_active_business_id', 'synthetic-workspace'], ['sb-other-auth-token', 'other-project'], ['theme', 'keep']];

function fixture(options = {}) {
  const values = new Map(options.initial || initial), writes = []; let config, providerCalls = 0;
  const store = { getAll: () => [...values].map(([name, value]) => ({ name, value })), get: name => values.has(name) ? { name, value: values.get(name) } : undefined,
    set(name, value, cookieOptions = {}) { if (options.readOnly) throw new Error('Synthetic read-only component'); writes.push({ name, value, ...cookieOptions }); if (cookieOptions.maxAge === 0) values.delete(name); else values.set(name, value); } };
  const createServerClient = (_url, key, sdkOptions) => {
    config = sdkOptions;
    if (options.realSdk) return ssr.createServerClient(_url, key, { ...sdkOptions, global: { fetch: async () => { providerCalls++; return Response.json({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Synthetic missing refresh token' }, { status: 400 }); } } });
    return { auth: { getUser: async () => { providerCalls++; if (options.duringLookup) await options.duringLookup(config);
      if (options.throw) throw new TypeError('Synthetic network failure');
      return { data: { user: options.error ? null : user }, error: options.error || null }; } } };
  };
  const server = loader({ '@supabase/ssr': { createServerClient }, 'next/headers': { cookies: async () => store }, '@/lib/auth/session-policy': { checkSessionPolicy: async () => ({ allowed: true }) }, '@/lib/auth/auth-ticket': { verifyAuthTicket: () => false } }, {
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key', NODE_ENV: 'test' } },
  })('lib/supabase/server.ts');
  return { values, writes, store, server, count: () => providerCalls };
}

for (const code of ['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired']) test(`confirmed ${code} expires only this app's cookies`, async () => {
  const f = fixture({ error: { status: 400, code } }), client = await f.server.createClient({ authFlow: true });
  assert.equal((await client.auth.getUser()).error.code, code);
  for (const name of [authName, 'tenh_session_hint', 'tenh_active_business_id']) assert.equal(f.values.has(name), false);
  assert.equal(f.values.get('sb-other-auth-token'), 'other-project'); assert.equal(f.values.get('theme'), 'keep');
  assert.ok(f.writes.every(write => write.maxAge === 0));
});

for (const error of [{ status: 503 }, { status: 429 }, { status: 0, name: 'AuthRetryableFetchError' }, { status: 400, code: 'request_timeout' }, { status: 400, code: 'unknown' }]) test(`temporary or ambiguous failure preserves cookies, including premature SDK removals: ${JSON.stringify(error)}`, async () => {
  const f = fixture({ error, duringLookup: config => config.cookies.setAll([{ name: authName, value: '', options: { maxAge: 0 } }]) });
  const client = await f.server.createClient(); await client.auth.getUser();
  assert.equal(f.writes.length, 0); assert.equal(f.values.get(authName), 'synthetic-session-A'); assert.equal(f.values.get('tenh_session_hint'), 'synthetic-hint-A');
});

test('a delayed refresh rejection cannot erase a newer session or its rotation in the same cookie store', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const f = fixture({ error: { status: 400, code: 'refresh_token_not_found' }, duringLookup: async config => { await held; config.cookies.setAll([{ name: authName, value: '', options: { maxAge: 0 } }]); } });
  const client = await f.server.createClient({ authFlow: true }), result = client.auth.getUser();
  f.values.set(authName, 'synthetic-session-B'); f.values.set('tenh_session_hint', 'synthetic-hint-B'); release(); await result;
  assert.equal(f.values.get(authName), 'synthetic-session-B'); assert.equal(f.values.get('tenh_session_hint'), 'synthetic-hint-B'); assert.equal(f.writes.length, 0);
});

test('an SDK-local session removal after an outage cannot turn a repeated lookup into destructive cleanup', async () => {
  const options = { error: { status: 400, code: 'request_timeout' }, duringLookup: config => config.cookies.setAll([{ name: authName, value: '', options: { maxAge: 0 } }]) };
  const f = fixture(options), client = await f.server.createClient();
  await client.auth.getUser(); options.error = { status: 400, name: 'AuthSessionMissingError' };
  assert.equal((await client.auth.getUser()).error.code, 'request_timeout');
  assert.equal(f.count(), 1); assert.equal(f.writes.length, 0); assert.equal(f.values.get(authName), 'synthetic-session-A');
});

test('successful refresh writes survive; concurrent lookups share one operation; read-only components fail closed', async () => {
  const f = fixture({ duringLookup: config => config.cookies.setAll([{ name: authName, value: 'synthetic-rotation', options: { path: '/', maxAge: 60 } }]) });
  const client = await f.server.createClient({ authFlow: true });
  const results = await Promise.all([client.auth.getUser(), client.auth.getUser()]);
  assert.ok(results.every(result => result.data.user.id === user.id)); assert.equal(f.count(), 1); assert.equal(f.values.get(authName), 'synthetic-rotation');
  const readOnly = fixture({ readOnly: true, error: { status: 400, code: 'refresh_token_not_found' } });
  assert.equal((await (await readOnly.server.createClient()).auth.getUser()).data.user, null);
});

test('installed SDK and real server adapter stop retrying a dead synthetic refresh token after cleanup', async () => {
  const session = { access_token: 'synthetic-expired-access', refresh_token: 'synthetic-refresh', expires_at: Math.floor(Date.now() / 1000) - 60, expires_in: 3600, token_type: 'bearer', user };
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
  const f = fixture({ realSdk: true, initial: [[authName, encoded], ['tenh_session_hint', 'synthetic-hint']] }), client = await f.server.createClient({ authFlow: true });
  const first = await client.auth.getUser(), second = await client.auth.getUser();
  assert.equal(first.error.code, 'refresh_token_not_found'); assert.equal(second.data.user, null);
  assert.equal(f.count(), 1); assert.equal(f.values.has(authName), false); assert.equal(f.values.has('tenh_session_hint'), false);
});
