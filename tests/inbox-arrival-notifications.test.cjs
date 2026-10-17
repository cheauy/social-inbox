const test = require('node:test'), assert = require('node:assert/strict');
const { loader, hooks } = require('./inbox-recovery-harness.cjs');

function fixture() {
  const h = hooks(), delivered = [], doc = new EventTarget(), win = new EventTarget();
  doc.visibilityState = 'visible'; doc.hasFocus = () => true;
  const useArrivalNotifications = loader({ react: h.React }, { document: doc, window: win })('lib/inbox/use-arrival-notifications.ts').useArrivalNotifications;
  const input = { scopeKey: 'member-a:workspace-a', listKey: 'all', activeConversationId: 'c1', conversations: [], unreadOnly: false, waitForNewConversation: false, messages: [], notify: arrival => delivered.push(arrival) };
  let result;
  const render = () => { result = h.render(() => useArrivalNotifications(input), {}); return result.enqueue; };
  return { h, delivered, input, doc, win, render, enqueue: render(), commit: (rows, key = input.listKey, filtered = false) => result.onListCommit(rows, key, filtered) };
}
const arrival = (id = 'm1', extra = {}) => ({ messageId: id, conversationId: 'c1', customerName: 'Fixture', body: id, messageTime: 1000, ...extra });
const message = (id = 'm1', time = 1000) => ({ id, conversation_id: 'c1', direction: 'incoming', created_at: new Date(time).toISOString() });

test('foreground arrival alerts after the matching message state commits, with no timer delay', () => {
  const d = fixture(); try {
    d.enqueue(arrival()); assert.equal(d.delivered.length, 0, 'enqueue is not audio playback');
    d.render(); assert.equal(d.delivered.length, 0, 'selected bubble is still absent');
    d.input.messages = [message()]; d.render(); assert.equal(d.delivered.length, 1);
    d.enqueue(arrival()); d.render(); assert.equal(d.delivered.length, 1, 'duplicate message ID is silent');
  } finally { d.h.cleanup(); }
});
test('conversation fallback then INSERT waits for the bubble and alerts exactly once', () => {
  const d = fixture(); try {
    d.enqueue(arrival('conversation-c1', { fallback: true })); d.render(); assert.equal(d.delivered.length, 0);
    d.enqueue(arrival()); d.input.messages = [message()]; d.render();
    assert.deepEqual(d.delivered.map(item => item.messageId), ['m1']);
    d.enqueue(arrival('poll-c1', { fallback: true })); d.render(); assert.equal(d.delivered.length, 1);
  } finally { d.h.cleanup(); }
});
test('two real IDs sharing one provider timestamp get separate alerts in either fallback order', () => {
  for (const fallbackFirst of [true, false]) {
    const d = fixture(); try {
      d.input.activeConversationId = null; d.render();
      if (fallbackFirst) { d.enqueue(arrival('fallback', { fallback: true })); d.render(); }
      d.enqueue(arrival()); d.enqueue(arrival('m2')); d.render();
      if (!fallbackFirst) { d.enqueue(arrival('fallback', { fallback: true })); d.render(); }
      assert.equal(d.delivered.length, 2, String(fallbackFirst));
      d.enqueue(arrival()); d.enqueue(arrival('m2')); d.render(); assert.equal(d.delivered.length, 2);
    } finally { d.h.cleanup(); }
  }
});
test('outside-selected-filter/thread and hidden tab alerts do not wait for a selected bubble or animation frame', () => {
  const d = fixture(); try {
    d.enqueue(arrival('other', { conversationId: 'hidden-by-filter' })); d.render(); assert.equal(d.delivered.length, 1);
    d.doc.visibilityState = 'hidden'; d.enqueue(arrival()); d.render(); assert.equal(d.delivered.length, 2);
  } finally { d.h.cleanup(); }
});
test('a pending foreground alert can deliver on tab blur without waiting for unavailable thread data', () => {
  const d = fixture(); try {
    d.enqueue(arrival()); d.render(); assert.equal(d.delivered.length, 0);
    d.doc.hasFocus = () => false; d.win.dispatchEvent(new Event('blur')); d.render(); assert.equal(d.delivered.length, 1);
  } finally { d.h.cleanup(); }
});
test('scope retirement discards pending alerts and rejects stale callbacks after workspace/user changes and unmount', () => {
  const d = fixture(); const retired = d.enqueue;
  d.enqueue(arrival()); d.render(); d.input.scopeKey = 'member-b:workspace-b'; d.input.messages = [message()];
  d.render(); assert.equal(d.delivered.length, 0);
  retired(arrival('stale')); d.render(); assert.equal(d.delivered.length, 0);
  const current = d.render(); d.h.cleanup(); current(arrival('unmounted')); assert.equal(d.delivered.length, 0);
});
test('matching already-visible fallback and late INSERT use one alert; a distinct same-time ID still alerts', () => {
  const d = fixture(); try {
    d.input.messages = [message('latest')]; d.render();
    d.enqueue(arrival('fallback', { fallback: true })); d.render(); assert.equal(d.delivered.length, 1);
    d.enqueue(arrival('latest')); d.render(); assert.equal(d.delivered.length, 1);
    d.input.messages = [...d.input.messages, message('another')]; d.enqueue(arrival('another')); d.render(); assert.equal(d.delivered.length, 2);
  } finally { d.h.cleanup(); }
});

test('a brand-new foreground All/Unread arrival waits for the committed displayed row, then alerts once', () => {
  const d = fixture(); try {
    d.input.activeConversationId = null; d.input.waitForNewConversation = true; d.render();
    d.enqueue(arrival('new-message', { conversationId: 'new-conversation' })); d.render();
    assert.equal(d.delivered.length, 0, 'the new row is not hydrated yet');
    d.commit([{ id: 'new-conversation', last_message_at: new Date(1000).toISOString() }]); d.render();
    assert.equal(d.delivered.length, 1); d.render(); assert.equal(d.delivered.length, 1);
  } finally { d.h.cleanup(); }
});
test('a new conversation filtered out by channel/box or Smart View still alerts, and background never waits for hydration', () => {
  const d = fixture(); try {
    d.input.activeConversationId = null; d.enqueue(arrival('outside', { conversationId: 'outside' })); d.render();
    assert.equal(d.delivered.length, 1);
    d.input.waitForNewConversation = true; d.doc.visibilityState = 'hidden';
    d.enqueue(arrival('background', { conversationId: 'unknown' })); d.render(); assert.equal(d.delivered.length, 2);
  } finally { d.h.cleanup(); }
});

test('queued delivery retains the existing No sound setting in the real browser notification hook', () => {
  const h = hooks(), win = new EventTarget(), doc = new EventTarget(); let plays = 0;
  doc.visibilityState = 'visible'; doc.hasFocus = () => true;
  win.Notification = class { static permission = 'denied'; };
  win.localStorage = { getItem: key => key === 'tenh-chat-notification-sound' ? 'none' : null };
  class Audio { load() {} pause() {} play() { plays++; return Promise.resolve(); } }
  const load = loader({ react: h.React }, { window: win, document: doc, Notification: win.Notification, Audio });
  const notifications = load('lib/inbox/use-browser-notifications.ts').useBrowserNotifications;
  const arrivals = load('lib/inbox/use-arrival-notifications.ts').useArrivalNotifications;
  const render = () => h.render(() => arrivals({ scopeKey: 'a', listKey: 'all', activeConversationId: null, conversations: [], unreadOnly: false, waitForNewConversation: false, messages: [], notify: notifications().notifyIncomingMessage }), {}).enqueue;
  try { const enqueue = render(); render(); enqueue(arrival()); render(); assert.equal(plays, 0); }
  finally { h.cleanup(); }
});

test('old list acknowledgements cannot release a new view and search-filtered arrivals stay audible', () => {
  const d = fixture(); try {
    d.input.activeConversationId = null; d.input.waitForNewConversation = true; d.input.listKey = 'unread'; d.render();
    d.enqueue(arrival()); d.commit([{ id: 'c1', last_message_at: new Date(1000).toISOString() }], 'all'); d.render();
    assert.equal(d.delivered.length, 0);
    d.commit([], 'unread', true); d.render(); assert.equal(d.delivered.length, 1);
  } finally { d.h.cleanup(); }
});

test('a selected off-page thread uses its committed bubble even when the paged list has no row', () => {
  const d = fixture(); try {
    d.input.waitForNewConversation = true; d.input.messages = [message()]; d.enqueue(arrival()); d.render();
    assert.equal(d.delivered.length, 1);
  } finally { d.h.cleanup(); }
});

for (const readByTeammate of [false, true]) test(`global hydration waits for real pager qualification; teammate read=${readByTeammate}`, async () => {
  const { tick } = require('./inbox-recovery-harness.cjs');
  const h = hooks(), win = new EventTarget(), doc = new EventTarget(), jobs = new Map(), delivered = [];
  doc.visibilityState = 'visible'; doc.hasFocus = () => true; let timer = 0, release;
  const load = loader({ react: h.React }, { window: win, document: doc, AbortController, CustomEvent,
    setTimeout: fn => { jobs.set(++timer, fn); return timer; }, clearTimeout: id => jobs.delete(id),
    fetch: () => new Promise(resolve => { release = resolve; }) });
  const pagerHook = load('lib/inbox/use-conversation-pages.ts').useConversationPages;
  const arrivalHook = load('lib/inbox/use-arrival-notifications.ts').useArrivalNotifications;
  const first = { id: 'c1', business_id: 'b1', last_message_at: new Date(0).toISOString(), unread_count: 1, status: 'open' };
  const incoming = { ...first, id: 'new-conversation', last_message_at: new Date(1000).toISOString() };
  let live = [first];
  const view = readByTeammate ? 'unread' : 'all';
  const request = { status: 'all', view, search: '', channelId: null, workspaceId: null, workspaceContextId: 'b1', cursor: null };
  const key = JSON.stringify(['all', view, null, null]);
  const counts = { views: { all: 1, unread: 1 }, totalUnreadCount: 1, unreadConversationCount: 1 };
  const page = { ids: ['c1'], counts, hasMore: false, cursor: null, total: 1, searchMatches: {} };
  const initial = { request, page };
  const render = () => h.render(() => {
    const pager = pagerHook(initial, request, live);
    const queue = arrivalHook({ scopeKey: 'member:b1', listKey: key, activeConversationId: null, conversations: live, unreadOnly: readByTeammate, waitForNewConversation: true, messages: [], notify: arrival => delivered.push(arrival) });
    h.React.useEffect(() => queue.onListCommit(pager.rows, key, false), [pager.rows, queue.onListCommit]);
    return { pager, queue };
  }, {});
  try {
    let state = render(); state.queue.enqueue(arrival('new-message', { conversationId: incoming.id }));
    live = [first, incoming]; state = render(); render(); assert.equal(delivered.length, 0);
    for (const fn of jobs.values()) fn(); jobs.clear(); await tick();
    state = render(); assert.equal(state.pager.rows.some(row => row.id === incoming.id), false); assert.equal(delivered.length, 0);
    if (readByTeammate) live = [first, { ...incoming, unread_count: 0 }];
    release(Response.json({ success: true, page: { ...page, conversations: readByTeammate ? [first] : [first, incoming], updates: [], matchedKnownIds: readByTeammate ? [] : [incoming.id], counts } }));
    await tick(); render(); render(); assert.equal(delivered.length, 1);
  } finally { h.cleanup(); }
});

test('an old read snapshot cannot release a newer Unread arrival before its displayed update', () => {
  const d = fixture(); try {
    d.input.activeConversationId = null; d.input.unreadOnly = true; d.input.waitForNewConversation = true;
    d.input.conversations = [{ id: 'c1', unread_count: 0, last_message_at: new Date(0).toISOString() }];
    d.enqueue(arrival()); d.render(); assert.equal(d.delivered.length, 0);
    d.input.conversations = [{ ...d.input.conversations[0], last_message_at: new Date(1000).toISOString() }];
    d.render(); assert.equal(d.delivered.length, 1);
  } finally { d.h.cleanup(); }
});
