const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { ROOT, loader } = require('../tenh-seven/harness.cjs');
const ts = require('node:module').createRequire(path.join(ROOT, 'package.json'))('typescript');
const { readMessagePageResponse } = loader()('lib/inbox/read-message-page-response.ts');
const { matchesOptimisticMessage } = loader()('lib/inbox/optimistic-message-match.ts');

// Execute the actual InboxView safety-net effect with controlled transport and
// state. The merge, cancellation, notification and retry code is not mocked.
const source = fs.readFileSync(path.join(ROOT, 'components/inbox/inbox-view.tsx'), 'utf8');
const marker = source.indexOf(' * Active-thread live safety net.');
const start = source.indexOf('useEffect(() => {', marker);
const end = source.indexOf('\n]);', start) + 4;
assert.ok(marker > 0 && start > marker && end > start);
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const row = (id, seconds = 0) => ({ id, conversation_id: 'c1', message_text: id, direction: 'incoming', created_at: new Date(Date.parse('2026-09-13T08:00:00Z') + seconds * 1000).toISOString() });
const flush = () => new Promise(resolve => setImmediate(resolve));

function run(fetchImpl, healthy = false, pendingPage) {
  let cleanup;
  const timers = new Map(), warnings = [], notifications = [], calls = [];
  let timerId = 0;
  const win = new EventTarget();
  win.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  win.clearTimeout = id => timers.delete(id);
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  const messages = { current: [row('old')] };
  const conversations = { current: [{ id: 'c1', contact: { full_name: 'Customer' } }] };
  vm.runInNewContext(code, {
    useEffect: fn => { cleanup = fn(); }, resolvedActiveConversationId: 'c1',
    window: win, document: doc, navigator: { onLine: true }, URLSearchParams, AbortController,
    MESSAGE_PAGE_SIZE: 25, readMessagePageResponse, INBOX_SYNC_EVENT: 'tenh:inbox-sync', SYNC_TIMEOUT_MS: 12000,
    matchesOptimisticMessage,
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    console: { warn: (...args) => warnings.push(args) },
    realtimeHealthyRef: { current: healthy }, liveMessagesRef: messages, liveConversationsRef: conversations,
    handledIncomingMessageIdsRef: { current: new Set() }, recentIncomingConversationAtRef: { current: new Map() },
    conversationMessageRequestRef: { current: pendingPage ? { c1: pendingPage } : {} },
    pendingSendsRef: { current: {} }, pendingAttachmentSendsRef: { current: {} },
    notifyIncomingMessage: value => notifications.push(value),
    setLiveMessages: update => { messages.current = update(messages.current); },
    setLiveConversations: update => { conversations.current = update(conversations.current); },
    messageOrderMs: m => Date.parse(m.created_at), sameOutgoingText: (a, b) => a === b,
    sortLiveConversations: value => value, getRealtimeMessagePreview: m => m.message_text,
    isAbortError: error => error?.name === 'AbortError',
  });
  return { cleanup: () => cleanup(), messages, conversations, warnings, notifications, calls, timers,
    resync: (conversationId = 'c1') => win.dispatchEvent(new CustomEvent('tenh:inbox-sync', { detail: { conversationId } })),
    tick: async () => { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.callback(); } };
}

test('HTML failure preserves history; the next successful poll merges and sounds once', async () => {
  let attempts = 0;
  const poll = run(async () => ++attempts === 1
    ? new Response('<!DOCTYPE html>Server unavailable', { status: 503 })
    : Response.json({ success: true, messages: [row('old'), row('new', 30)] }));
  await flush();
  assert.deepEqual(Array.from(poll.messages.current, m => m.id), ['old']);
  assert.equal(poll.notifications.length, 0);
  assert.equal(poll.warnings.length, 1);
  assert.equal(poll.warnings[0][1].status, 503);
  assert.equal(poll.calls[0].init.headers.Accept, 'application/json');
  assert.equal(poll.timers.values().next().value.delay, 3000);
  await poll.tick();
  assert.deepEqual(Array.from(poll.messages.current, m => m.id), ['old', 'new']);
  assert.equal(poll.notifications.length, 1);
  await poll.tick();
  assert.equal(poll.notifications.length, 1, 'repeated polls must not repeat an alert');
  poll.cleanup();
});

test('switching chats aborts the request and ignores even a late successful response', async () => {
  let resolve;
  const poll = run(() => new Promise(done => { resolve = done; }), true);
  assert.ok([...poll.timers.values()].some(timer => timer.delay === 60000));
  poll.cleanup();
  assert.equal(poll.calls[0].init.signal.aborted, true);
  assert.equal(poll.timers.size, 0);
  resolve(Response.json({ success: true, messages: [row('wrong-thread', 30)] }));
  await flush();
  assert.deepEqual(Array.from(poll.messages.current, m => m.id), ['old']);
  assert.equal(poll.notifications.length, 0);
  assert.equal(poll.warnings.length, 0);
});

test('an aborted request after cleanup produces no warning', async () => {
  const poll = run((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  }));
  poll.cleanup(); await flush();
  assert.equal(poll.warnings.length, 0);
});

test('cold selection joins its unresolved newest-page read instead of starting a duplicate fetch', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const poll = run(() => { throw Error('duplicate fetch'); }, true, pending);
  assert.equal(poll.calls.length, 0);
  resolve({ messages: [row('old'), row('new', 30)], hasMore: false }); await flush();
  assert.deepEqual(Array.from(poll.messages.current, m => m.id), ['old', 'new']);
  assert.equal(poll.calls.length, 0); poll.cleanup();
});
test('batched recovery during a read runs one trailing read and never starts parallel requests', async () => {
  const responses = [];
  const poll = run(() => new Promise(resolve => responses.push(resolve)), true);
  assert.equal(poll.calls.length, 1);
  for (let n = 0; n < 5; n++) poll.resync();
  poll.resync('different-thread'); assert.equal(poll.calls.length, 1);
  responses[0](Response.json({ success: true, messages: [row('old')] })); await flush();
  assert.equal(poll.calls.length, 2, 'exactly one trailing catch-up after the obsolete snapshot');
  responses[1](Response.json({ success: true, messages: [row('old'), row('new', 30)] })); await flush();
  assert.equal(poll.calls.length, 2); assert.equal(poll.messages.current.at(-1).id, 'new'); poll.cleanup();
});
test('retiring a request discards queued recovery and even an ignored abort cannot update the old thread', async () => {
  let resolve;
  const poll = run(() => new Promise(done => { resolve = done; }), true);
  poll.resync(); poll.cleanup(); resolve(Response.json({ success: true, messages: [row('wrong', 30)] })); await flush();
  assert.equal(poll.calls.length, 1); assert.equal(poll.notifications.length, 0);
  assert.deepEqual(Array.from(poll.messages.current, m => m.id), ['old']);
});
test('an unchanged newest page preserves message and preview references; a renewed media URL still updates', async () => {
  let payload = { ...row('old'), attachment_url: 'https://fixture.invalid/media?token=one' };
  const poll = run(async () => Response.json({ success: true, messages: [payload] }), true); await flush();
  const messages = poll.messages.current, preview = poll.conversations.current[0];
  await poll.tick(); assert.equal(poll.messages.current, messages); assert.equal(poll.conversations.current[0], preview);
  payload = { ...payload, attachment_url: 'https://fixture.invalid/media?token=two' };
  await poll.tick(); assert.notEqual(poll.messages.current, messages); assert.equal(poll.messages.current[0].attachment_url, payload.attachment_url);
  poll.cleanup();
});

test('own outgoing messages merge without an incoming alert', async () => {
  const outgoing = { ...row('own-outgoing', 30), direction: 'outgoing' };
  const poll = run(async () => Response.json({ success: true, messages: [row('old'), outgoing] }), true);
  await flush(); assert.equal(poll.messages.current.at(-1).id, outgoing.id); assert.equal(poll.notifications.length, 0);
  await poll.tick(); assert.equal(poll.notifications.length, 0); poll.cleanup();
});
