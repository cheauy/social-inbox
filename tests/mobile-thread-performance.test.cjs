// Actual mobile loader/effects and bounded memory cache; all transports are synthetic.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { hooks, tick, loader } = require('./inbox-recovery-harness.cjs');
const ROOT = process.env.TENH_TEST_ROOT || path.resolve(__dirname, '..');
const requireFixture = createRequire(path.join(ROOT, 'tests/mobile-sync-lifecycle-regression.test.cjs'));
const ts = requireFixture('typescript');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const raw = read('tests/mobile-sync-lifecycle-regression.test.cjs');
const fixtureModule = { exports: {} };
// Reuse the existing regression factories without registering their test cases.
vm.runInNewContext(raw.slice(0, raw.indexOf("test('initial join and reconnect")) +
  '\nmodule.exports={thread,provider,row,cursorFor,mergeMessages};', {
  require: id => id === 'node:test' ? () => {} : requireFixture(id), module: fixtureModule,
  __dirname: path.join(ROOT, 'tests'), process, console, URL, URLSearchParams, AbortController,
});
const { thread, provider, row, cursorFor, mergeMessages } = fixtureModule.exports;
const THREAD = 'mobile/app/conversation/[id].tsx';
function excerpt(file, start, end, append = '') {
  const source = read(file), a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, file + ': source markers');
  return ts.transpileModule(source.slice(a, b) + append, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const keyModule = { exports: {} };
vm.runInNewContext(excerpt('mobile/lib/api/client.ts', 'export function threadPreviewKey(', '\n// Explicit opt-in'), {
  module: keyModule, exports: keyModule.exports, JSON, encodeURIComponent,
});
const threadPreviewKey = keyModule.exports.threadPreviewKey;
function memory() {
  const exports = {}; let now = 1000;
  vm.runInNewContext(ts.transpileModule(read('mobile/lib/api/read-cache.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, Map, JSON, Date: { now: () => now } });
  return { ...exports, advance: ms => { now += ms; } };
}
const scope = { user: 'u1', business: 'b1', member: 'm1', conversation: 'c1' };
const keyFor = (s = scope) => threadPreviewKey(s.user, s.business, s.member, s.conversation);
const saved = () => ({ messages: Array.from({ length: 25 }, (_, i) => row(100 - i)),
  hasMore: true, nextCursor: cursorFor(row(76)) });
function screen(cache, s = scope, operational = true) {
  const c = {
    session: { user: { id: s.user } }, scopeId: s.business, id: s.conversation,
    workspaces: [{ businessId: s.business, memberId: s.member, subscriptionOperational: operational }],
    threadPreviewKey, peekReadCache: cache.peekReadCache, mergeMessages,
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useRef: value => ({ current: value }),
  };
  vm.runInNewContext(excerpt(THREAD, '  const previewKey = threadPreviewKey(', '\n  const messagesRef',
    '\nglobalThis.initial={previewKey,preview,messages};'), c);
  vm.runInNewContext(excerpt(THREAD, '  const [cursor, setCursor]', '\n  const [error, setError]',
    '\nglobalThis.paging={cursor,hasMore,loading};'), c);
  const h = thread();
  Object.assign(h.state, { messages: c.initial.messages, ...c.paging });
  h.context.messagesRef.current = h.state.messages;
  Object.assign(h.context, { previewKey: c.initial.previewKey, readCacheGeneration: cache.readCacheGeneration,
    storeReadCache: cache.storeReadCache, clearReadCache: cache.clearReadCache });
  return h;
}
function consumer(h, updates) {
  const renderHooks = hooks();
  const c = { id: 'c1', threadUpdates: updates, focused: true, foreground: true,
    load: h.load, useRef: renderHooks.React.useRef, useEffect: renderHooks.React.useEffect,
    syncRef: h.context.syncRef, readTimer: { current: undefined }, clearTimeout() {} };
  const code = excerpt(THREAD, '  // revision ticks:', '\n  /*\n   * Older messages,');
  vm.runInNewContext('(function(){ globalThis.Render=function(){' + code + '; return null;}; })()', c);
  return { render: next => { c.threadUpdates = next; renderHooks.render(c.Render, {}); },
    close: () => renderHooks.cleanup() };
}

test('cold screen stays loading; warm screen synchronously displays 25 rows before revalidation', async () => {
  const cache = memory(), cold = screen(cache);
  assert.equal(cold.state.messages.length, 0); assert.equal(cold.state.loading, true);
  cold.remote(Array.from({ length: 100 }, (_, i) => row(i + 1))); await cold.load(); cold.cleanup();
  const warm = screen(cache);
  assert.equal(warm.state.messages.length, 25); assert.equal(warm.state.loading, false);
  assert.equal(warm.calls.length, 0);
  let release; warm.answer(() => new Promise(resolve => { release = resolve; }));
  const work = warm.load(false, false); for (let i = 0; i < 5; i++) warm.load(false, false);
  assert.equal(warm.calls.length, 1); assert.equal(warm.state.messages.length, 25);
  release(saved()); await work; assert.equal(warm.calls.length, 1); warm.cleanup();
});

test('a real invalidation during a warm refresh forces a new read and retains displayed history', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  let release; h.answer(() => new Promise(resolve => { release = resolve; }));
  const work = h.load(); h.load(false, true);
  h.answer(() => ({ messages: [row(101)], hasMore: false, nextCursor: null }));
  release(saved()); await work;
  assert.equal(h.calls.length, 2); assert.ok(h.state.messages.some(r => r.id === row(101).id));
  assert.equal(h.state.cursor.id, row(76).id); h.cleanup();
});

for (const missed of [40, 140]) test('warm preview catches up ' + missed + ' missed rows without moving the history cursor', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  h.remote(Array.from({ length: 100 + missed }, (_, i) => row(i + 1)));
  await h.load(); for (let burst = 0; h.jobs.size && burst < 4; burst++) await h.next();
  assert.equal(h.jobs.size, 0, 'catch-up finishes without an unbounded retry loop');
  for (let i = 101; i <= 100 + missed; i++) assert.ok(h.state.messages.some(r => r.id === row(i).id));
  assert.equal(h.state.cursor.id, row(76).id);
  assert.equal(h.calls.length, missed === 40 ? 2 : 6); h.cleanup();
});

test('account, business, member and conversation partitions cannot reuse another preview', () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved());
  for (const name of ['user','business','member','conversation']) {
    const h = screen(cache, { ...scope, [name]: 'other' });
    assert.equal(h.state.messages.length, 0); h.cleanup();
  }
  assert.equal(threadPreviewKey('u1','b1',undefined,'c1'), null);
  const inactive = screen(cache, scope, false); assert.equal(inactive.state.messages.length, 0); inactive.cleanup();
});

for (const status of [401,403,404]) test('protected denial ' + status + ' clears displayed rows and memory preview', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  h.answer(() => { throw new h.context.ApiError(status); }); await h.load();
  assert.equal(h.state.messages.length, 0); assert.equal(h.state.cursor, null);
  assert.equal(cache.peekReadCache(keyFor()), undefined); assert.equal(h.jobs.size, 0); h.cleanup();
});

test('offline warm refresh keeps rows and cursor, schedules retry and does no background work', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  h.answer(() => { throw Error('synthetic offline'); }); await h.load();
  assert.equal(h.state.messages.length, 25); assert.equal(h.state.cursor.id, row(76).id);
  assert.equal([...h.jobs.values()][0].ms, 1000);
  h.context.AppState.currentState = 'background'; await h.next(); assert.equal(h.calls.length, 1); h.cleanup();
});

test('logout or membership invalidation during an in-flight preview write cannot repopulate memory', async () => {
  const cache = memory(), h = screen(cache); let release;
  h.answer(() => new Promise(resolve => { release = resolve; }));
  const work = h.load(); cache.clearReadCache(); release(saved()); await work;
  assert.equal(cache.peekReadCache(keyFor()), undefined); h.cleanup();
});

test('same-render older callbacks share one page request and retain correct paging cursor', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  let release; h.answer(() => new Promise(resolve => { release = resolve; }));
  const first = h.older(), second = h.context.older();
  assert.equal(h.calls.length, 1);
  release({ messages: [row(75)], hasMore: true, nextCursor: cursorFor(row(75)) });
  await Promise.all([first,second]);
  assert.equal(h.state.messages.filter(r => r.id === row(75).id).length, 1);
  assert.equal(h.state.cursor.id, row(75).id); assert.equal(h.context.olderFlight.current, null); h.cleanup();
});

test('older-page failure releases its flight; denied older reads revoke the cached preview', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  h.answer(() => { throw Error('synthetic offline'); }); await h.older();
  assert.equal(h.context.olderFlight.current, null); assert.equal(h.state.messages.length, 25);
  h.answer(() => { throw new h.context.ApiError(403); }); await h.older();
  assert.equal(h.calls.length, 2); assert.equal(h.state.messages.length, 0);
  assert.equal(cache.peekReadCache(keyFor()), undefined); h.cleanup();
});

test('unrelated realtime messages refresh their Inbox row without fetching the open thread', async () => {
  const p = provider(), h = thread(); h.remote(Array.from({ length: 100 }, (_, i) => row(i + 1)));
  let view;
  try {
    await p.boot(); view = consumer(h, p.render().threadUpdates); view.render(p.render().threadUpdates); await tick();
    const before = h.calls.length, channel = p.channels.find(c => c.name === 'tenh-mobile-b1');
    const changed = channel.events.find(e => e.filter.table === 'messages' && e.filter.event === '*');
    changed.fn({ new: { conversation_id: 'another-thread' }, old: {} }); await p.flush();
    view.render(p.render().threadUpdates); await tick(); assert.equal(h.calls.length, before);
    assert.ok(p.calls.some(c => c.url.includes('conversationIds=another-thread')));
    changed.fn({ new: { conversation_id: 'c1' }, old: {} }); await p.flush();
    view.render(p.render().threadUpdates); await tick(); assert.equal(h.calls.length, before + 1);
  } finally { view?.close(); p.h.cleanup(); h.cleanup(); }
});

test('resume signals coalesce with the current read; membership events invalidate previews', async () => {
  const cache = memory(), p = provider({ readCache: cache }), h = thread(); let view, release;
  try {
    await p.boot(); cache.storeReadCache(keyFor(), saved());
    h.answer(() => new Promise(resolve => { release = resolve; }));
    view = consumer(h, p.render().threadUpdates); view.render(p.render().threadUpdates);
    p.app.currentState = 'active'; for (const fn of p.listeners) fn('active');
    view.render(p.render().threadUpdates); await p.flush(); view.render(p.render().threadUpdates);
    assert.equal(h.calls.length, 1); assert.ok(cache.peekReadCache(keyFor()));
    release(saved()); await h.context.syncRef.current.pending;
    p.channels.find(c => c.name === 'tenh-mobile-workspaces-u1').events.find(e => e.filter.table === 'team_members').fn({});
    assert.equal(cache.peekReadCache(keyFor()), undefined);
  } finally { view?.close(); p.h.cleanup(); h.cleanup(); }
});

test('authoritative removed conversation and revoked workspace purge cached previews', async () => {
  const cache = memory(), p = provider({ readCache: cache });
  try {
    await p.boot(); cache.storeReadCache(keyFor(), saved());
    p.answer(() => ({ conversations: [], removedConversationIds: ['c1'], member: { id: 'm1' } }));
    await p.render().refresh(); assert.equal(cache.peekReadCache(keyFor()), undefined);
    cache.storeReadCache(keyFor(), saved()); p.workspaces([]);
    await p.render().loadWorkspaces(true); assert.equal(cache.peekReadCache(keyFor()), undefined);
  } finally { p.h.cleanup(); }
});

test('preview memory obeys 100-entry, 4 MiB, five-minute and invalidation bounds', async () => {
  const cache = memory();
  for (let i = 0; i < 101; i++) cache.storeReadCache('entry'+i, saved());
  assert.equal(cache.peekReadCache('entry0'), undefined); assert.ok(cache.peekReadCache('entry100'));
  cache.clearReadCache();
  for (let i = 0; i < 5; i++) cache.storeReadCache('bytes'+i, { text: 'x'.repeat(600000) });
  assert.equal(cache.peekReadCache('bytes0'), undefined); assert.ok(cache.peekReadCache('bytes4'));
  cache.storeReadCache('oversize', { text: 'x'.repeat(3 * 1024 * 1024) });
  assert.equal(cache.peekReadCache('oversize'), undefined);
  cache.storeReadCache('expires', saved()); cache.advance(300000);
  assert.equal(cache.peekReadCache('expires'), undefined);
  const epoch = cache.readCacheGeneration(); cache.clearReadCache();
  cache.storeReadCache('late', saved(), epoch); assert.equal(cache.peekReadCache('late'), undefined);
});

test('targeted invalidation retains unrelated in-flight deduplication', async () => {
  const cache = memory(); let release, reads = 0;
  const load = () => { reads++; return new Promise(resolve => { release = resolve; }); };
  const first = cache.cachedRead('A', load); cache.clearReadCache(key => key === 'B');
  const second = cache.cachedRead('A', load); assert.equal(reads, 1);
  release(saved()); await Promise.all([first,second]);
});

test('a confirmed send during a pending refresh gets fresh transport and warms the new cache epoch', async () => {
  const cache = memory(); cache.storeReadCache(keyFor(), saved()); const h = screen(cache);
  let release; h.answer(() => new Promise(resolve => { release = resolve; }));
  const first = h.load(false, false); cache.clearReadCache();
  h.load(); // Existing confirmed-send callers retain invalidation semantics.
  h.answer(() => ({ messages: [row(101)], hasMore: true, nextCursor: cursorFor(row(76)) }));
  release(saved()); await first;
  assert.equal(h.calls.length, 2); assert.equal(cache.peekReadCache(keyFor()).messages[0].id, row(101).id); h.cleanup();
});

for (const user of ['u1', 'other-user']) test('actual API checks thread transport account ' + user + ' before HTTP', async () => {
  let requests = 0;
  const client = loader({
    'expo-file-system': {}, '../supabase/client': { authCookieName: 'mock-cookie', supabase: { auth: {
      getSession: async () => ({ data: { session: { user: { id: user } } }, error: null }),
    } } }, './session-cookie': { sessionCookie: () => 'mock-session' },
  }, { AbortController, FormData, fetch: async () => { requests++; return Response.json(saved()); } })('mobile/lib/api/client.ts');
  if (user === 'u1') {
    await client.api('/api/conversations/c1/messages?limit=25', 'b1', { expectedUserId: 'u1' }); assert.equal(requests, 1);
  } else {
    await assert.rejects(client.api('/api/conversations/c1/messages?limit=25', 'b1', { expectedUserId: 'u1' }), e => e.status === 401);
    assert.equal(requests, 0);
  }
});

test('resume cannot downgrade a queued membership invalidation into an ordinary refresh', async () => {
  const p = provider();
  try {
    await p.boot(); const before = p.render().threadUpdates.all;
    p.channels.find(c => c.name === 'tenh-mobile-workspaces-u1').events.find(e => e.filter.table === 'team_members').fn({});
    p.app.currentState = 'active'; for (const fn of p.listeners) fn('active');
    await p.flush(); assert.equal(p.render().threadUpdates.all, before + 1);
  } finally { p.h.cleanup(); }
});
