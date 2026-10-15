/* eslint-disable @typescript-eslint/no-require-imports -- Actual boundary effect with isolated HTTP, timer and cookie-state mocks. */
const test = require('node:test'), assert = require('node:assert/strict'), React = require('react');
const { loader } = require('./tenh-seven/harness.cjs');
const flush = () => new Promise(setImmediate);
function fixture() {
  let effect, state, authState = 'synthetic-A', nextResponse, calls = 0, cleared = 0;
  const timers = new Map(), window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false });
  const load = loader({ react: { ...React, useEffect: callback => { effect = callback; }, useState: initial => [state ??= initial, value => { state = value; }], useRef: value => ({ current: value }) }, '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
    '@/lib/supabase/client': { createClient: () => ({ auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) },
    '@/lib/auth/browser-session': { currentBrowserSessionId: () => 'session-A', currentBrowserAuthState: () => authState, clearBrowserSession: (_id, expected) => { if (expected !== undefined && expected !== authState) return false; cleared++; return true; }, suspendPrivateSession() {}, resumeBrowserSession() {}, broadcastSessionEnd() {}, reloadForSessionChange() {}, SESSION_BROADCAST_CHANNEL: 'synthetic-channel', SESSION_END_EVENT: 'synthetic-end' },
  }, { window, document, AbortController, BroadcastChannel: class { close() {} },
    setTimeout: (callback, delay) => { const id = Symbol(); timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    fetch: async () => { calls++; return await nextResponse; },
  });
  load('components/dashboard/dashboard-session-boundary.tsx').DashboardSessionBoundary({ children: 'Private', initialSessionId: 'session-A', initialUserId: 'user-A' });
  const valid = () => Response.json({ success: true, sessionId: 'session-A', userId: 'user-A', kind: 'normal', expiresAt: '2027-01-01T00:00:00Z', remembered: true, serverTime: '2026-10-15T00:00:00Z' });
  return { window, timers, valid, setResponse: value => { nextResponse = value; }, rotate: () => { authState = 'synthetic-new-rotation'; }, start: () => effect(), state: () => state, calls: () => calls, cleared: () => cleared,
    fire(delay) { const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, `Timer ${delay}`); timers.delete(entry[0]); entry[1].callback(); } };
}

test('terminal validation stops polling and hides private state until login', async () => {
  const f = fixture(); f.setResponse(new Response(null, { status: 401 })); const dispose = f.start(); await flush();
  assert.equal(f.state(), 'expired'); assert.equal(f.cleared(), 1); assert.equal(f.timers.size, 0);
  f.window.dispatchEvent(new Event('focus')); await flush(); assert.equal(f.calls(), 1); dispose();
});

test('an unavailable validation preserves credentials and can recover', async () => {
  const f = fixture(); f.setResponse(new Response(null, { status: 503 })); const dispose = f.start(); await flush();
  assert.equal(f.state(), 'unavailable'); assert.equal(f.cleared(), 0);
  f.setResponse(f.valid()); f.fire(5000); await flush(); assert.equal(f.state(), 'valid'); assert.equal(f.cleared(), 0); dispose();
});

test('a stale401 cannot erase a newer rotated credential in the same session', async () => {
  const f = fixture(); let release; f.setResponse(new Promise(resolve => { release = resolve; })); const dispose = f.start(); await flush();
  f.rotate(); release(new Response(null, { status: 401 })); await flush();
  assert.equal(f.state(), 'checking'); assert.equal(f.cleared(), 0);
  f.setResponse(f.valid()); f.fire(0); await flush(); assert.equal(f.state(), 'valid'); assert.equal(f.calls(), 2); assert.equal(f.cleared(), 0); dispose();
});
