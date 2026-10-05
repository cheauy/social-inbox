const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

// All credentials are fixed synthetic fixtures inside the loader sandbox.
// No environment file, live provider, database, or browser is used.
function fixture() {
  let now = Date.parse('2026-10-03T12:00:00Z'), userId = 'user-A', manage = true;
  const jar = new Map([['tenh_active_business_id', 'A']]);
  const writes = [], graph = [], seenCodes = new Set();
  const members = new Map([
    ['A', { id: 'member-A', business_id: 'A', role: 'owner' }],
    ['B', { id: 'member-B', business_id: 'B', role: 'owner' }],
  ]);
  const options = { httpOnly: true, secure: true, sameSite: 'lax', path: '/', domain: '.tenhchat.com' };
  function write(name, value, attributes) { writes.push({ name, value, attributes }); }
  function response(url, status = 307) {
    const result = new Response(null, { status, headers: { Location: String(url) } });
    result.cookies = { set: write };
    return result;
  }
  const sandbox = {
    Buffer,
    Date: class extends Date { static now() { return now; } },
    console: { error() {}, warn() {}, log() {} },
    process: { env: {
      NODE_ENV: 'production', FACEBOOK_APP_ID: 'synthetic-app', FACEBOOK_APP_SECRET: 'synthetic-secret',
      FACEBOOK_LOGIN_FOR_BUSINESS_CONFIG_ID: 'synthetic-config',
      FACEBOOK_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co',
    } },
    fetch: async (value) => {
      const url = new URL(value); graph.push(url.pathname);
      if (url.pathname.endsWith('/me')) return Response.json({ id: '123' });
      if (url.searchParams.has('code')) {
        const code = url.searchParams.get('code');
        if (seenCodes.has(code)) return Response.json({ error: { message: 'Synthetic code already used.' } }, { status: 400 });
        seenCodes.add(code);
        return Response.json({ access_token: 'synthetic-short-token' });
      }
      return Response.json({ access_token: 'synthetic-long-token', expires_in: 3600 });
    },
  };
  const load = loader({
    'next/server': { NextResponse: { redirect: response, json: (data, init) => Response.json(data, init) } },
    'next/headers': { cookies: async () => ({
      get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
      set: write,
    }) },
    '@/lib/auth/get-current-member': { getCurrentMember: async strict => {
      assert.equal(strict, true, 'every entry and callback must retain strict auth');
      const member = members.get(jar.get('tenh_active_business_id'));
      return member ? { success: true, user: { id: userId }, member } : {
        success: false, status: 403, error: 'Your selected workspace is no longer available.',
      };
    } },
    '@/lib/auth/require-permission': { memberHasPermission: async (_, key, level) => {
      assert.equal(key, 'channels'); assert.equal(level, 'manage'); return manage;
    } },
    '@/lib/supabase/admin': { supabaseAdmin: { from: () => { throw new Error('Unexpected database query.'); } } },
    '@/lib/facebook/facebook-origin': {
      FACEBOOK_COOKIE_DOMAIN: '.tenhchat.com', getFacebookAppOrigin: () => 'https://app.tenhchat.com',
    },
  }, sandbox);
  const sessions = load('lib/facebook/facebook-oauth-session.ts');
  const request = url => ({ url, nextUrl: new URL(url), cookies: { getAll: () => [
    { name: 'sb-synthetic-auth-token', value: 'synthetic-native-session' },
    { name: 'tenh_active_business_id', value: jar.get('tenh_active_business_id') },
  ] } });
  async function invoke(file, url, method = 'GET') {
    writes.length = 0;
    const result = await load(file)[method](request(url));
    // Apply Set-Cookie only after the response, as a browser does.
    for (const { name, value, attributes } of writes) {
      if (attributes.maxAge === 0) jar.delete(name); else jar.set(name, value);
    }
    return result;
  }
  async function start(mobile = false) {
    if (mobile) {
      const bridge = await invoke('app/api/mobile/facebook-connect/route.ts', 'https://app.tenhchat.com/api/mobile/facebook-connect');
      assert.equal(new URL(bridge.headers.get('Location')).pathname, '/api/facebook/oauth/connect');
      assert.equal(jar.get('tenh_active_business_id'), 'A');
      assert.equal(jar.get('sb-synthetic-auth-token'), 'synthetic-native-session');
    }
    const result = await invoke('app/api/facebook/oauth/connect/route.ts', 'https://app.tenhchat.com/api/facebook/oauth/connect');
    const url = new URL(result.headers.get('Location'));
    return { result, state: url.searchParams.get('state'), url };
  }
  const callback = (state, code = 'synthetic-code') => invoke('app/api/facebook/oauth/callback/route.ts',
    `https://app.tenhchat.com/api/facebook/oauth/callback?state=${encodeURIComponent(state ?? '')}&code=${code}`);
  return { jar, writes, graph, members, sessions, start, callback, invoke, options,
    switchWorkspace: id => jar.set('tenh_active_business_id', id),
    switchUser: id => { userId = id; },
    revokePermission: () => { manage = false; },
    advance: ms => { now += ms; },
    failEncryption: () => { delete sandbox.process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY; },
  };
}

function errorMessage(response) {
  const url = new URL(response.headers.get('Location'));
  assert.equal(url.searchParams.get('facebook'), 'error');
  return url.searchParams.get('message');
}

for (const mobile of [false, true]) test(`${mobile ? 'native bridge' : 'web'} keeps the initiating binding through callback and clears state`, async () => {
  const f = fixture(), attempt = await f.start(mobile);
  assert.equal(attempt.url.hostname, 'www.facebook.com');
  assert.match(attempt.state, /^[a-f0-9]{64}$/);
  const encrypted = f.jar.get('tenh_facebook_oauth_state');
  assert.notEqual(encrypted, attempt.state);
  assert.doesNotMatch(encrypted, /user-A|member-A/);
  const state = f.sessions.decodeFacebookOAuthState(encrypted);
  assert.equal(state.userId, 'user-A'); assert.equal(state.businessId, 'A'); assert.equal(state.memberId, 'member-A');
  const stateWrite = f.writes.find(write => write.name === 'tenh_facebook_oauth_state');
  assert.equal(stateWrite.attributes.maxAge, 600);
  for (const [key, value] of Object.entries(f.options)) assert.equal(stateWrite.attributes[key], value);
  const result = await f.callback(attempt.state);
  assert.equal(new URL(result.headers.get('Location')).pathname, '/dashboard/integrations/facebook/select');
  assert.equal(f.graph.length, 3);
  assert.equal(f.jar.has('tenh_facebook_oauth_state'), false);
  const selection = f.sessions.decodeFacebookOAuthSession(f.jar.get('tenh_facebook_oauth_session'));
  assert.equal(selection.businessId, 'A'); assert.equal(selection.memberId, 'member-A');
  const sessionWrite = f.writes.find(write => write.name === 'tenh_facebook_oauth_session');
  assert.equal(sessionWrite.attributes.domain, '.tenhchat.com'); assert.equal(sessionWrite.attributes.maxAge, 900);
});

for (const change of ['workspace', 'user', 'member']) test(`${change} change is rejected before any token exchange`, async () => {
  const f = fixture(), { state } = await f.start();
  if (change === 'workspace') f.switchWorkspace('B');
  if (change === 'user') f.switchUser('user-B');
  if (change === 'member') f.members.set('A', { id: 'replacement-member-A', business_id: 'A', role: 'owner' });
  assert.match(errorMessage(await f.callback(state)), /different TENH workspace or member/);
  assert.equal(f.graph.length, 0); assert.equal(f.jar.has('tenh_facebook_oauth_session'), false);
  assert.equal(f.jar.has('tenh_facebook_oauth_state'), false);
});

test('removed membership and revoked channel permission cannot exchange an authorization code', async () => {
  for (const removed of [true, false]) {
    const f = fixture(), { state } = await f.start();
    if (removed) f.members.delete('A'); else f.revokePermission();
    assert.match(errorMessage(await f.callback(state)), removed ? /selected workspace/ : /no longer have permission/);
    assert.equal(f.graph.length, 0); assert.equal(f.jar.has('tenh_facebook_oauth_session'), false);
  }
});

for (const corruption of ['expired', 'future', 'mismatch', 'tampered', 'legacy']) test(`${corruption} state is rejected before exchange`, async () => {
  const f = fixture(), { state } = await f.start();
  if (corruption === 'expired') f.advance(600_000);
  if (corruption === 'future') f.advance(-60_000);
  if (corruption === 'tampered') f.jar.set('tenh_facebook_oauth_state', f.jar.get('tenh_facebook_oauth_state').slice(0, -8) + 'AAAAAAAA');
  if (corruption === 'legacy') f.jar.set('tenh_facebook_oauth_state', state);
  assert.match(errorMessage(await f.callback(corruption === 'mismatch' ? '0'.repeat(64) : state)), /Invalid or expired/);
  assert.equal(f.graph.length, 0); assert.equal(f.jar.has('tenh_facebook_oauth_session'), false);
  assert.equal(f.jar.has('tenh_facebook_oauth_state'), corruption === 'mismatch');
});

test('an ordinary browser callback replay has no state and cannot exchange again', async () => {
  const f = fixture(), { state } = await f.start();
  await f.callback(state);
  const selection = f.jar.get('tenh_facebook_oauth_session'), calls = f.graph.length;
  assert.match(errorMessage(await f.callback(state)), /Invalid or expired/);
  assert.equal(f.graph.length, calls); assert.equal(f.jar.get('tenh_facebook_oauth_session'), selection);
});

test('a copied old state cookie cannot bypass the provider single-use authorization code', async () => {
  const f = fixture(), { state } = await f.start(), encrypted = f.jar.get('tenh_facebook_oauth_state');
  await f.callback(state);
  f.jar.set('tenh_facebook_oauth_state', encrypted); f.jar.delete('tenh_facebook_oauth_session');
  assert.match(errorMessage(await f.callback(state)), /already used/);
  assert.equal(f.graph.length, 4); assert.equal(f.jar.has('tenh_facebook_oauth_session'), false);
  assert.equal(f.jar.has('tenh_facebook_oauth_state'), false);
});

test('starting again replaces the attempt and clears the prior selection on its production domain', async () => {
  const f = fixture(), first = await f.start(); await f.callback(first.state);
  const second = await f.start(); assert.notEqual(second.state, first.state);
  const cleared = f.writes.find(write => write.name === 'tenh_facebook_oauth_session');
  assert.equal(cleared.attributes.domain, '.tenhchat.com'); assert.equal(cleared.attributes.maxAge, 0);
  assert.equal(f.jar.has('tenh_facebook_oauth_session'), false);
  const pending = f.jar.get('tenh_facebook_oauth_state');
  assert.match(errorMessage(await f.callback(first.state)), /Invalid or expired/); assert.equal(f.graph.length, 3);
  assert.equal(f.jar.get('tenh_facebook_oauth_state'), pending);
});

for (const errorField of ['error_description', 'error_message']) test(`matching provider refusal ${errorField} clears the attempt without exchanging a code`, async () => {
  const f = fixture(), { state } = await f.start();
  const result = await f.invoke('app/api/facebook/oauth/callback/route.ts',
    `https://app.tenhchat.com/api/facebook/oauth/callback?state=${state}&${errorField}=Cancelled`);
  assert.equal(errorMessage(result), 'Cancelled'); assert.equal(f.graph.length, 0);
  assert.equal(f.jar.has('tenh_facebook_oauth_state'), false);
  const cleared = f.writes.find(write => write.name === 'tenh_facebook_oauth_state');
  assert.equal(cleared.attributes.maxAge, 0); assert.equal(cleared.attributes.domain, '.tenhchat.com');
});

for (const kind of ['stale', 'forged', 'missing']) test(`${kind} provider error cannot consume the newer attempt`, async () => {
  const f = fixture(), old = await f.start(), newer = await f.start();
  const pending = f.jar.get('tenh_facebook_oauth_state');
  const state = kind === 'stale' ? old.state : kind === 'forged' ? '0'.repeat(64) : '';
  const result = await f.invoke('app/api/facebook/oauth/callback/route.ts',
    `https://app.tenhchat.com/api/facebook/oauth/callback?state=${state}&error_description=Cancelled`);
  assert.match(errorMessage(result), /Invalid or expired/);
  assert.equal(f.jar.get('tenh_facebook_oauth_state'), pending);
  assert.equal(f.writes.length, 0); assert.equal(f.graph.length, 0);
  const accepted = await f.callback(newer.state);
  assert.equal(new URL(accepted.headers.get('Location')).pathname, '/dashboard/integrations/facebook/select');
  assert.equal(f.graph.length, 3);
});

test('switching after callback cannot move the authorized selection into another workspace', async () => {
  const f = fixture(), { state } = await f.start(); await f.callback(state);
  f.switchWorkspace('B');
  const result = await f.invoke('app/api/facebook/oauth/select/route.ts', 'https://app.tenhchat.com/api/facebook/oauth/select', 'POST');
  assert.match(errorMessage(result), /different TENH workspace or member/);
  assert.equal(f.graph.length, 3); assert.equal(f.jar.has('tenh_facebook_oauth_session'), false);
});

test('missing existing encryption configuration fails closed without initiating an attempt', async () => {
  const f = fixture(); f.failEncryption();
  const { result } = await f.start();
  assert.match(errorMessage(result), /token-encryption configuration/);
  assert.equal(f.jar.has('tenh_facebook_oauth_state'), false); assert.equal(f.graph.length, 0);
});
