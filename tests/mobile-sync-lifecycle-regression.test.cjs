// Real mobile source with bounded hooks/transports; no native modules or live requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hooks, tick, loader } = require('./inbox-recovery-harness.cjs');
const ROOT = process.env.TENH_TEST_ROOT || path.resolve(__dirname, '..');
const ts = require('node:module').createRequire(path.join(ROOT, 'package.json'))('typescript');
const THREAD = 'mobile/app/conversation/[id].tsx';
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
function excerpt(file, start, end, append = '') {
  const source = read(file), a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `${file}: source markers`);
  return ts.transpileModule(source.slice(a, b) + append, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const mergeContext = { Date, Map, sentAt: row => Date.parse(row.platform_created_at ?? row.created_at) };
vm.runInNewContext(excerpt(THREAD, 'function mergeMessages(', '\ntype Tag =', '\nglobalThis.merge = mergeMessages;'), mergeContext);
const mergeMessages = mergeContext.merge;
const row = n => ({ id: String(n).padStart(5, '0'), conversation_id: 'c1', direction: 'incoming',
  created_at: new Date(Date.UTC(2026, 9, 3, 0, 0, n)).toISOString() });
const cursorFor = row => ({ sentAt: row.created_at, id: row.id });
class ApiError extends Error { constructor(status) { super('rejected'); this.status = status; } }

function thread() {
  const state = { messages: Array.from({ length: 25 }, (_, i) => row(100 - i)), cursor: cursorFor(row(76)),
    hasMore: true, loading: true, loadingOlder: false, error: '', loadedRevision: 0, readRetry: 0 };
  const jobs = new Map(), calls = []; let timer = 0;
  let remote = Array.from({ length: 140 }, (_, i) => row(i + 1));
  let answer = (url) => {
    const before = new URL(url, 'https://fixture.invalid').searchParams.get('beforeId');
    const ordered = remote.filter(r => !before || r.id < before).sort((a, b) => b.id.localeCompare(a.id));
    const page = ordered.slice(0, 25), hasMore = ordered.length > 25;
    return { messages: page.slice().reverse(), hasMore, nextCursor: hasMore ? cursorFor(page.at(-1)) : null };
  };
  const context = {
    id: 'c1', scopeId: 'b1', PAGE_SIZE: 25, AppState: { currentState: 'active' }, focused: true, foreground: true,
    session: { user: { id: 'u1' } },
    focusedRef: { current: true }, screenAlive: { current: true }, ownerRef: { current: 'b1:c1' },
    requestRef: { current: 0 }, messagesRef: { current: state.messages },
    previewKey: null, readCacheGeneration: () => 0, storeReadCache() {}, clearReadCache() {}, olderFlight: { current: null },
    syncRef: { current: { pending: null, dirty: false, controller: null, timer: undefined, failures: 0, gap: null } },
    readWatermark: { current: null }, readPending: { current: null }, readSuppressed: { current: false },
    readFailures: { current: 0 }, readTimer: { current: undefined }, conversation: { unread_count: 1 },
    setTimeout: (fn, ms) => { jobs.set(++timer, { fn, ms }); return timer; }, clearTimeout: id => jobs.delete(id),
    sentAt: row => Date.parse(row.platform_created_at ?? row.created_at), mergeMessages, ApiError,
    URLSearchParams, AbortController, encodeURIComponent, useCallback: fn => fn,
    api: async (url, scope, init) => { calls.push({ url, scope, init }); return answer(url, scope, init); },
    updateConversation: (_id, patch) => Object.assign(context.conversation, patch),
    ...Object.fromEntries(Object.keys(state).map(key => ['set' + key[0].toUpperCase() + key.slice(1), value => {
      state[key] = typeof value === 'function' ? value(state[key]) : value;
    }])),
  };
  vm.runInNewContext(excerpt(THREAD, '  const load = useCallback(', '\n  // revision ticks', '\nglobalThis.loadThread = load;'), context);
  const olderCode = excerpt(THREAD, '  const loadOlder = useCallback(', '\n  // Acknowledge', '\nglobalThis.older = loadOlder;');
  return { state, context, calls, jobs, load: context.loadThread, remote: rows => { remote = rows; },
    answer: fn => { answer = fn; },
    older: () => { Object.assign(context, { cursor: state.cursor, hasMore: state.hasMore, loadingOlder: state.loadingOlder });
      vm.runInNewContext(olderCode.replace('const loadOlder =', 'var loadOlder ='), context); return context.older(); },
    readEffect: () => {
      Object.assign(context, { messages: state.messages, loadedRevision: state.loadedRevision, readRetry: state.readRetry });
      context.useEffect = fn => fn();
      vm.runInNewContext(excerpt(THREAD, '  // Acknowledge successfully', '\n  // A clip'), context);
    },
    next: async () => { const job = jobs.entries().next().value; assert.ok(job, 'scheduled continuation');
      jobs.delete(job[0]); await job[1].fn(); await tick(); },
    cleanup: () => { context.screenAlive.current = false; context.syncRef.current.controller?.abort(); jobs.clear(); },
  };
}

test('resume recovers all 40 missed messages and preserves the visited history cursor', async () => {
  const h = thread(); await h.load();
  for (let i = 101; i <= 140; i++) assert.ok(h.state.messages.some(r => r.id === row(i).id));
  assert.equal(h.calls.length, 2); assert.equal(h.state.cursor.id, row(76).id);
  assert.equal(h.context.syncRef.current.gap, null); h.cleanup();
});
test('larger resume gap uses four-page bursts and continues without skipping history', async () => {
  const h = thread(); h.remote(Array.from({ length: 240 }, (_, i) => row(i + 1)));
  await h.load(); assert.equal(h.calls.length, 4); assert.ok(h.context.syncRef.current.gap);
  await h.next();
  for (let i = 101; i <= 240; i++) assert.ok(h.state.messages.some(r => r.id === row(i).id));
  assert.equal(h.calls.length, 6); assert.equal(h.context.syncRef.current.gap, null); h.cleanup();
});
test('an event during an in-flight request schedules a fresh uncached request afterward', async () => {
  const h = thread(); let release;
  h.answer(() => new Promise(resolve => { release = resolve; }));
  const first = h.load(); h.load(false, true);
  h.answer(() => ({ messages: [row(141)], hasMore: false, nextCursor: null }));
  release({ messages: [row(100)], hasMore: false, nextCursor: null }); await first;
  assert.equal(h.calls.length, 2); assert.equal(h.state.messages[0].id, row(141).id); h.cleanup();
});
test('transient message refresh failure retries with backoff; background stops requests', async () => {
  const h = thread(); h.answer(() => { throw new Error('offline'); }); await h.load();
  assert.equal(h.calls.length, 1); assert.equal([...h.jobs.values()][0].ms, 1000);
  h.context.AppState.currentState = 'background'; await h.next(); assert.equal(h.calls.length, 1);
  h.context.AppState.currentState = 'active';
  h.answer(() => ({ messages: [row(101)], hasMore: false, nextCursor: null }));
  await h.load(); assert.equal(h.calls.length, 2); assert.equal(h.state.error, ''); h.cleanup();
});
test('late newest and older responses cannot update an unmounted or changed scope', async () => {
  for (const older of [false, true]) {
    const h = thread(); let release; h.answer(() => new Promise(resolve => { release = resolve; }));
    const pending = older ? h.older() : h.load();
    h.context.ownerRef.current = 'b2:c2'; h.state.messages = [];
    release({ messages: [row(50)], hasMore: false, nextCursor: null }); await pending;
    assert.equal(h.state.messages.length, 0); h.cleanup();
  }
});
test('realtime invalidation during older paging drops the stale page and releases its spinner', async () => {
  const h = thread(); let release; h.answer(() => new Promise(resolve => { release = resolve; }));
  const pending = h.older(); h.context.requestRef.current++;
  release({ messages: [row(50)], hasMore: false, nextCursor: null }); await pending;
  assert.equal(h.state.messages.some(r => r.id === row(50).id), false);
  assert.equal(h.state.loadingOlder, false); h.cleanup();
});
test('read watermark advances only on success and acknowledges later displayed incoming messages', async () => {
  const h = thread(); h.remote([row(100)]); await h.load();
  h.readEffect(); await tick(); assert.equal(h.context.readWatermark.current, row(100).id);
  h.context.conversation.unread_count = 1;
  h.state.messages = mergeMessages(h.state.messages, [row(101)]); h.context.messagesRef.current = h.state.messages;
  h.readEffect(); await tick(); assert.equal(h.context.readWatermark.current, row(101).id);
  assert.equal(h.calls.filter(c => c.url.endsWith('/read')).length, 2); h.cleanup();
});
test('failed read remains unread, retries after its timer, and never reads a background or covered thread', async () => {
  const h = thread(); h.state.loadedRevision = 1;
  h.answer(() => { throw new Error('offline'); }); h.readEffect(); await tick();
  assert.equal(h.context.readWatermark.current, null); assert.equal(h.context.conversation.unread_count, 1);
  assert.equal(h.calls.length, 1); assert.equal([...h.jobs.values()][0].ms, 1000);
  h.context.focused = false; h.readEffect(); assert.equal(h.calls.length, 1);
  h.context.focused = true; h.context.foreground = false; h.readEffect(); assert.equal(h.calls.length, 1);
  h.context.foreground = true; await h.next(); h.answer(() => ({})); h.readEffect(); await tick();
  assert.equal(h.context.conversation.unread_count, 0); assert.equal(h.calls.length, 2); h.cleanup();
});
test('explicit Mark unread waits for an earlier read and suppresses subsequent acknowledgment', async () => {
  const h = thread(); h.state.loadedRevision = 1; let release;
  h.answer(() => new Promise(resolve => { release = resolve; })); h.readEffect();
  const writes = []; Object.assign(h.context, { runAction: async () => { writes.push('unread'); return true; },
    setPanelOpen() {}, router: { back() {} } });
  vm.runInNewContext(excerpt(THREAD, '  async function markUnread()', '\n  const commentThreads', '\nglobalThis.mark = markUnread;'), h.context);
  const marked = h.context.mark(); assert.equal(writes.length, 0); release({}); await marked;
  assert.deepEqual(writes, ['unread']); h.readEffect(); assert.equal(h.calls.length, 1); h.cleanup();
});

function provider({ readCache = { clearReadCache() {} } } = {}) {
  const h = hooks(); h.React.createContext = () => ({ Provider: 'provider' });
  const jobs = new Map(), intervals = new Map(), listeners = new Set(), channels = [], calls = []; let timer = 0;
  let answer = () => ({ conversations: Array.from({ length: 30 }, (_, i) => ({ ...row(i + 1), business_id: 'b1' })),
    hasMore: true, nextOffset: 30, member: { id: 'm1' }, permissions: { channels: 'manage' } });
  const auth = { session: { user: { id: 'u1' } } };
  let availableWorkspaces = [{ businessId: 'b1', memberId: 'm1', subscriptionOperational: true }];
  const app = { currentState: 'active', addEventListener: (_name, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };
  const api = async (url, scope, init) => {
    calls.push({ url, scope, init });
    if (url === '/api/workspaces') return { workspaces: availableWorkspaces };
    if (url.startsWith('/api/mobile/bootstrap')) return answer(url);
    if (url === '/api/team-notifications') return { notifications: [] };
    return { announcement: null };
  };
  const supabase = { channel: name => {
    const channel = { name, events: [], on(type, filter, fn) { this.events.push({ type, filter, fn }); return this; },
      subscribe(fn) { this.status = fn; return this; } }; channels.push(channel); return channel;
  }, removeChannel: async channel => { channel.removed = true; } };
  const deps = { react: h.React, 'react/jsx-runtime': h.jsx, 'react-native': { AppState: app },
    './api/client': { api, ApiError }, './api/read-cache': readCache,
    './inbox-cache': { readInboxCache: async () => null, writeInboxCache() {}, clearInboxCache: async () => {} },
    './auth/provider': { useAuth: () => auth }, './auth/secure-storage': { sessionStorage: {
      getItem: async () => 'b1', setItem: async () => {},
    } }, './notification-sound': { useNotificationSound: () => ({ play() {}, enabled: true }) }, './supabase/client': { supabase },
  };
  const Provider = loader(deps, { setTimeout: (fn, ms) => { jobs.set(++timer, { fn, ms }); return timer; },
    clearTimeout: id => jobs.delete(id), setInterval: (fn, ms) => { intervals.set(++timer, { fn, ms }); return timer; },
    clearInterval: id => intervals.delete(id) })('mobile/lib/inbox-provider.tsx').InboxProvider;
  const render = () => h.render(Provider, {}).props.value;
  const flush = async () => { const pending = [...jobs.values()]; jobs.clear(); for (const j of pending) await j.fn(); await tick(); return render(); };
  const boot = async () => { render(); await tick(); render(); await flush(); await tick(); return render(); };
  return { h, channels, calls, jobs, intervals, app, listeners, auth, boot, render, flush, answer: fn => { answer = fn; }, workspaces: rows => { availableWorkspaces = rows; } };
}
test('initial join and reconnect each reconcile through the protected bootstrap', async () => {
  const p = provider(); try {
    await p.boot(); const c = p.channels.find(c => c.name === 'tenh-mobile-b1');
    const count = () => p.calls.filter(c => c.url.startsWith('/api/mobile/bootstrap')).length;
    const before = count(); c.status('SUBSCRIBED'); await p.flush(); assert.equal(count(), before + 1);
    c.status('CHANNEL_ERROR'); c.status('SUBSCRIBED'); await p.flush(); assert.equal(count(), before + 2);
  } finally { p.h.cleanup(); }
});
test('failed targeted refresh keeps IDs pending and retries; background pauses the timer', async () => {
  const p = provider(); try {
    await p.boot(); const c = p.channels.find(c => c.name === 'tenh-mobile-b1');
    p.answer(() => { throw new Error('offline'); });
    c.events.find(e => e.filter.table === 'messages' && e.filter.event === '*').fn({ new: { conversation_id: 'c1' }, old: {} });
    await p.flush(); assert.equal([...p.jobs.values()][0].ms, 1000);
    p.app.currentState = 'background'; for (const fn of p.listeners) fn('background'); assert.equal(p.jobs.size, 0);
    p.app.currentState = 'active'; p.answer(() => ({ conversations: [], member: { id: 'm1' } }));
    for (const fn of p.listeners) fn('active'); await p.flush(); assert.equal(p.render().error, '');
  } finally { p.h.cleanup(); }
});
test('resume retains 60 loaded rows; minute fallback rotates bounded authorized tag reconciliation', async () => {
  const p = provider(); try {
    await p.boot(); p.answer(url => ({ conversations: Array.from({ length: 30 }, (_, i) => ({
      ...row(i + (url.includes('offset=30') ? 31 : 1)), business_id: 'b1', contact: { id: 'contact1', tags: [] },
    })), hasMore: true, nextOffset: url.includes('offset=30') ? 60 : 30, member: { id: 'm1' } }));
    await p.render().loadMore(); assert.equal(p.render().conversations.length, 60);
    await p.render().refresh(); assert.equal(p.render().conversations.length, 60);
    const c = p.channels.find(c => c.name === 'tenh-mobile-b1'); c.status('SUBSCRIBED'); await p.flush();
    const batches = [];
    p.answer(url => {
      const ids = new URL(url, 'https://fixture.invalid').searchParams.get('conversationIds')?.split(',') || [];
      batches.push(ids); return { conversations: ids.map(id => ({ id, business_id: 'b1', contact: { id: 'contact1', tags: [{ id: 'vip' }] } })), member: { id: 'm1' } };
    });
    for (let n = 0; n < 2; n++) {
      for (const interval of p.intervals.values()) interval.fn(); await tick(); p.render();
    }
    assert.deepEqual(batches.map(ids => ids.length), [50, 10]);
    assert.equal(p.render().conversations.every(row => row.contact.tags[0].id === 'vip'), true);
    assert.equal(p.channels.some(c => c.events.some(e => e.filter.table === 'contact_tags')), false);
  } finally { p.h.cleanup(); }
});
test('logout removes listeners and ignores late subscription callbacks', async () => {
  const p = provider(); await p.boot(); const c = p.channels.find(c => c.name === 'tenh-mobile-b1');
  p.auth.session = null; p.render(); await tick(); p.render();
  assert.ok(c.removed); c.status('SUBSCRIBED'); assert.equal(p.render().live, false);
  assert.equal(p.render().conversations.length, 0); p.h.cleanup(); assert.equal(p.listeners.size, 0);
});
test('logout invalidates a protected bootstrap request already in flight', async () => {
  const p = provider(); await p.boot(); let release;
  p.answer(() => new Promise(resolve => { release = resolve; }));
  const pending = p.render().refresh(); await tick();
  p.auth.session = null; p.render(); await tick(); p.render();
  release({ conversations: [{ ...row(1), business_id: 'b1' }], member: { id: 'old' }, permissions: { channels: 'manage' } });
  await pending; assert.equal(p.render().conversations.length, 0); assert.equal(p.render().member, null);
  assert.equal(p.render().loading, false); p.h.cleanup();
});

test('Notifications rejects late workspace A responses after workspace B has loaded', async () => {
  const state = { loading: true }, releases = new Map();
  const shared = { session: { user: { id: 'u1' } }, ownerRef: { current: 'u1:b1' }, loadSequence: { current: 0 },
    loadController: { current: null }, loadAlive: { current: true }, useCallback: fn => fn, AbortController,
    api: (url, scope) => new Promise(resolve => releases.set(scope + url, resolve)),
    ...Object.fromEntries(['items', 'announcement', 'subscription', 'reminders', 'error', 'loading'].map(key => [
      'set' + key[0].toUpperCase() + key.slice(1), value => { state[key] = value; },
    ])),
  };
  const code = excerpt('mobile/app/(tabs)/notifications.tsx', '  const load = useCallback(', '\n  useEffect(() =>', '\nglobalThis.runLoad = load;');
  const a = { ...shared, workspace: { businessId: 'b1' } }; vm.runInNewContext(code, a); const pa = a.runLoad();
  shared.ownerRef.current = 'u1:b2';
  const b = { ...shared, workspace: { businessId: 'b2' } }; vm.runInNewContext(code, b); const pb = b.runLoad(true);
  const finish = scope => {
    releases.get(scope + '/api/team-notifications')({ notifications: [{ id: scope }] });
    releases.get(scope + '/api/system-announcements/current')({ announcement: { id: scope } });
    releases.get(scope + '/api/subscription/current')({ subscription: { id: scope } });
    releases.get(scope + '/api/reminders')({ reminders: [{ id: scope, remind_at: '2026-10-03T00:00:00Z' }] });
  };
  finish('b2'); await pb; finish('b1'); await pa;
  assert.equal(state.subscription.id, 'b2'); assert.equal(state.reminders[0].id, 'b2');
  assert.equal(state.loading, false, 'quiet refresh superseding initial load still releases the loader');
});

test('an authoritative pin refresh removes old pins omitted from the newest message page', async () => {
  const h = hooks(), actions = loader()('lib/inbox/message-actions.ts'); const appListeners = new Set();
  const pin = { ...row(1), raw_payload: { tenh_message_pin: { pinned: true, updated_at: '2026-10-03T00:00:00Z' } } };
  let pins = [pin], calls = 0;
  const PinBar = loader({ react: h.React, 'react/jsx-runtime': h.jsx,
    'react-native': { AppState: { addEventListener: (_n, fn) => { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } }, Pressable: 'button', Text: 'text', View: 'view' },
    '@expo/vector-icons': { Ionicons: 'icon' }, '../../lib/inbox/message-actions': actions,
    '../lib/api/client': { api: async () => { calls++; return { pins }; } }, './ui': { colors: {} },
  })('mobile/components/pinned-message-bar.tsx').PinnedMessageBar;
  const props = { conversationId: 'c1', workspaceId: 'b1', messages: [pin, row(100)], updated: [], busy: false,
    revision: 0, enabled: true, onJump() {}, onUnpin() {} };
  h.render(PinBar, props); await tick(); let tree = h.render(PinBar, props); assert.ok(tree.props.children[0]);
  pins = []; props.revision++; h.render(PinBar, props); await tick(); tree = h.render(PinBar, props);
  assert.equal(tree.props.children[0], null); assert.equal(calls, 2);
  props.enabled = false; props.revision++; h.render(PinBar, props); assert.equal(calls, 2); h.cleanup();
});
test('open quick replies refresh on settings revision and cancel stale responses', async () => {
  let effect, applied, release, cleaned;
  const context = { replyOpen: true, focused: true, foreground: true, scopeId: 'b1', id: 'c1', replies: [], settingsRevision: 1,
    ownerRef: { current: 'b1:c1' }, screenAlive: { current: true }, AbortController,
    setRepliesLoading() {}, setError() {}, setReplies: rows => { applied = rows; },
    api: () => new Promise(resolve => { release = resolve; }), useEffect: fn => { effect = fn; },
  };
  const source = read(THREAD), start = source.indexOf('  useEffect(() => {\n    if (!replyOpen');
  const end = source.indexOf('\n  /*', start);
  vm.runInNewContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  cleaned = effect(); context.ownerRef.current = 'b2:c2'; cleaned(); release({ savedReplies: [{ id: 'old' }] }); await tick();
  assert.equal(applied, undefined);
  context.ownerRef.current = 'b1:c1'; cleaned = effect(); release({ savedReplies: [{ id: 'new' }] }); await tick();
  assert.equal(applied[0].id, 'new'); cleaned();
});
test('presence chooses later device timestamps before independent revision counters', () => {
  const context = {};
  vm.runInNewContext(excerpt('mobile/lib/presence.tsx', 'function atLeastAsNew(', '\nexport function PresenceProvider', '\nglobalThis.choose = atLeastAsNew;'), context);
  assert.equal(context.choose({ revision: 1, updated_at: '2026-10-03T12:00:00Z' }, { revision: 1000, updated_at: '2026-10-03T11:00:00Z' }), true);
});
test('presence publishes away then restores the focused thread without background heartbeat traffic', async () => {
  const h = hooks(); h.React.createContext = () => ({ Provider: 'presence' }); const events = [], intervals = [], channels = [];
  const app = { currentState: 'active', addEventListener: (_name, fn) => { events.push(fn); return { remove() {} }; } };
  const supabase = { channel: () => {
    const c = { tracks: [], on() { return this; }, presenceState: () => ({}), subscribe(fn) { this.status = fn; return this; },
      track: async payload => { c.tracks.push(payload); }, untrack: async () => {} }; channels.push(c); return c;
  }, removeChannel: async () => {} };
  const Provider = loader({ react: h.React, 'react/jsx-runtime': h.jsx, 'react-native': { AppState: app },
    './account': { useAccount: () => ({ name: 'Fixture' }) }, './auth/provider': { useAuth: () => ({ session: { user: { id: 'u1' } } }) },
    './inbox-provider': { useInbox: () => ({ workspace: { businessId: 'b1' }, member: { id: 'm1' } }) },
    './supabase/client': { supabase }, './auth/secure-storage': { sessionStorage: { getItem: async () => 'key1', setItem: async () => {} } },
  }, { setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval() {} })('mobile/lib/presence.tsx').PresenceProvider;
  let state = h.render(Provider, {}).props.value; await tick(); channels[0].status('SUBSCRIBED'); await tick();
  state.setViewing('c1'); state.setTyping(true); await tick();
  events[0]('background'); await tick(); const count = channels[0].tracks.length; intervals[0](); await tick();
  assert.equal(channels[0].tracks.length, count); assert.equal(channels[0].tracks.at(-1).conversation_id, null);
  events[0]('active'); await tick(); assert.equal(channels[0].tracks.at(-1).conversation_id, 'c1');
  assert.equal(channels[0].tracks.at(-1).is_typing, true); h.cleanup();
});
