/* eslint-disable @typescript-eslint/no-require-imports -- Real browser cleanup and logout contracts with isolated SDK/storage mocks. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');

function fixture(options = {}) {
  const sessionId = options.sessionId || 'session-A';
  const hint = `${Buffer.from(JSON.stringify({ sessionId, remembered: true, expiresAt: '2027-01-01T00:00:00Z' })).toString('base64url')}.synthetic-signature`;
  const jar = new Map([['sb-fixture-auth-token', 'synthetic-cookie'], ['sb-fixture-auth-token.0', 'synthetic-chunk'], ['sb-fixture-auth-token-code-verifier', 'synthetic-verifier'], ['sb-other-auth-token', 'unrelated-project'], ['tenh_session_hint', hint], ['tenh_auth_intent', 'synthetic-intent'], ['tenh_recovery_grant', 'synthetic-grant'], ['choice', 'keep']]);
  const storage = new Map([['tenh_verification_email', 'synthetic@example.invalid'], ['tenh_pending_invitation_token', 'synthetic-invite'], ['tenh-display-language', 'km'], ['unrelated-choice', 'keep']]);
  const requests = [], messages = [], navigations = [], calls = { cache: 0, channels: 0, stop: 0, start: 0, forbiddenSignOut: 0 };
  const document = { get cookie() { return [...jar].map(([key, value]) => `${key}=${value}`).join('; '); }, set cookie(value) { const [pair] = value.split(';'), index = pair.indexOf('='); if (/Max-Age=0/.test(value)) jar.delete(pair.slice(0, index)); else jar.set(pair.slice(0, index), pair.slice(index + 1)); } };
  class CustomEvent extends Event { constructor(type, init) { super(type); this.detail = init.detail; } }
  class BroadcastChannel { postMessage(value) { messages.push(value); } close() {} }
  const window = Object.assign(new EventTarget(), { setTimeout: (callback, ms) => setTimeout(callback, options.timeout ? 0 : ms), clearTimeout, location: { href: 'https://app.tenhchat.com/dashboard/inbox', replace: url => navigations.push(url) } });
  const client = { removeAllChannels: async () => { calls.channels++; }, auth: { stopAutoRefresh: async () => { calls.stop++; }, startAutoRefresh: async () => { calls.start++; }, signOut: async () => { calls.forbiddenSignOut++; throw new Error('No remote SDK sign out'); } } };
  const load = loader({ '@/lib/supabase/client': { createClient: () => client }, '@/lib/storage/workspace-storage-cache': { clearWorkspaceStorageCache: () => { calls.cache++; } } }, {
    window, document, location: { protocol: 'https:' }, sessionStorage: { removeItem: key => storage.delete(key) }, CustomEvent, BroadcastChannel, AbortController,
    atob: value => Buffer.from(value, 'base64').toString('utf8'), process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co' } },
    fetch: async (url, init) => {
      requests.push({ url, ...init, body: JSON.parse(init.body) });
      if (options.timeout) return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Synthetic timeout'))));
      if (options.throw) throw new Error('Synthetic network failure');
      return Response.json(options.failure ? { success: false, signedOutLocally: true, remoteRevocationConfirmed: false } : { success: true, signedOutLocally: true, remoteRevocationConfirmed: true }, { status: options.failure ? 502 : 200 });
    },
  });
  return { api: load('lib/auth/browser-session.ts'), jar, storage, requests, messages, navigations, calls };
}

for (const scope of ['local', 'global']) test(`confirmed ${scope} logout posts explicit scope and clears only private application state`, async () => {
  const f = fixture(); const result = await f.api.signOutBrowser(scope);
  assert.equal(result.remoteRevocationConfirmed, true); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, '/api/auth/sign-out'); assert.equal(f.requests[0].method, 'POST'); assert.equal(f.requests[0].headers['Content-Type'], 'application/json'); assert.equal(f.requests[0].body.scope, scope);
  assert.equal(f.jar.has('sb-fixture-auth-token'), false); assert.equal(f.jar.has('sb-fixture-auth-token.0'), false); assert.equal(f.jar.has('sb-fixture-auth-token-code-verifier'), false);
  assert.equal(f.jar.get('sb-other-auth-token'), 'unrelated-project'); assert.equal(f.jar.get('choice'), 'keep'); assert.equal(f.jar.has('tenh_session_hint'), false);
  assert.equal(f.storage.has('tenh_verification_email'), false); assert.equal(f.storage.has('tenh_pending_invitation_token'), false); assert.equal(f.storage.get('tenh-display-language'), 'km'); assert.equal(f.storage.get('unrelated-choice'), 'keep');
  assert.equal(f.calls.cache, 1); assert.equal(f.calls.channels, 1); assert.equal(f.calls.stop, 1); assert.equal(f.calls.forbiddenSignOut, 0); assert.equal(f.navigations[0], '/login');
  assert.deepEqual(Object.keys(f.messages[0]).sort(), ['reason', 'sessionId', 'type']); assert.equal(f.messages[0].sessionId, 'session-A'); assert.equal(JSON.stringify(f.messages).includes('synthetic-cookie'), false);
});
for (const options of [{ failure: true }, { throw: true }, { timeout: true }]) test(`uncertain logout still clears local data and reports uncertainty (${Object.keys(options)[0]})`, async () => {
  const f = fixture(options); const result = await f.api.signOutBrowser('global');
  assert.equal(result.remoteRevocationConfirmed, false); assert.equal(f.jar.has('sb-fixture-auth-token'), false); assert.equal(f.calls.cache, 1); assert.equal(f.calls.forbiddenSignOut, 0); assert.equal(f.navigations[0], '/login?logout=uncertain');
});
test('a delayed cleanup for session A cannot erase a new session B', () => {
  const f = fixture({ sessionId: 'session-B' }); assert.equal(f.api.clearBrowserSession('session-A'), false);
  assert.equal(f.jar.has('sb-fixture-auth-token'), true); assert.equal(f.calls.cache, 0); assert.equal(f.storage.has('tenh_verification_email'), true);
});

function profileFixture(confirm) {
  const scopes = [], confirmations = []; let stateCall = 0;
  const React = require('react');
  const ProfileMenu = loader({ react: { ...React, useState: () => [stateCall++ === 0 ? true : null, () => {}], useRef: () => ({ current: false }) }, 'next/link': 'a', '@/lib/auth/browser-session': { signOutBrowser: async scope => scopes.push(scope) }, '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' } }, { window: { confirm: message => { confirmations.push(message); return confirm; } } })('components/dashboard/profile-menu.tsx').ProfileMenu;
  const tree = ProfileMenu({ name: 'Synthetic agent', email: 'synthetic@example.invalid' });
  const nodes = item => !item || typeof item !== 'object' ? [] : [item, ...[item.props?.children].flat(Infinity).flatMap(nodes)];
  const find = label => nodes(tree).find(node => node.type === 'button' && [node.props.children].flat(Infinity).includes(label));
  return { scopes, confirmations, find };
}
test('profile menu has separate local/global actions and requires confirmation only for global', async () => {
  const local = profileFixture(true); await local.find('Sign out this device').props.onClick(); assert.deepEqual(local.scopes, ['local']); assert.equal(local.confirmations.length, 0);
  const cancelled = profileFixture(false); await cancelled.find('Sign out all devices').props.onClick(); assert.equal(cancelled.scopes.length, 0); assert.equal(cancelled.confirmations.length, 1);
  const global = profileFixture(true); const action = global.find('Sign out all devices').props.onClick; await action(); await action(); assert.deepEqual(global.scopes, ['global']); assert.equal(global.confirmations.length, 1);
});
