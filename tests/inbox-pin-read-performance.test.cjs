const test = require('node:test'), assert = require('node:assert/strict');
const { loader, hooks, tick } = require('./inbox-recovery-harness.cjs');

function fixture(globals = {}) {
  const h = hooks(), win = new EventTarget(), doc = new EventTarget(), calls = [];
  doc.visibilityState = 'visible';
  const hook = loader({ react: h.React }, { window: win, document: doc, AbortController, CustomEvent,
    fetch: (url, init) => new Promise(resolve => calls.push({ url, init, resolve })), ...globals })('lib/inbox/use-pinned-messages.ts').usePinnedMessages;
  let conversation = 'a'; const messages = [];
  const render = () => h.render(() => hook(conversation, messages), {});
  const event = row => win.dispatchEvent(new CustomEvent('tenh:message-row-changed', { detail: { row, eventType: 'UPDATE' } }));
  return { h, win, doc, calls, render, event, select: id => { conversation = id; return render(); } };
}
const row = (id, conversation_id = 'a', pinned = false) => ({ id, conversation_id, raw_payload: pinned ? { tenh_message_pin: { pinned: true, updated_at: '2026-10-17T00:00:00Z' } } : {}, message_text: id });

test('resume bursts coalesce pin reads and retain one trailing catch-up rather than parallel requests', async () => {
  const d = fixture(); try {
    d.render(); for (let i = 0; i < 3; i++) d.win.dispatchEvent(new Event('focus'));
    d.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(d.calls.length, 1);
    d.calls[0].resolve(Response.json({ success: true, pins: [] })); await tick(); assert.equal(d.calls.length, 2);
    d.calls[1].resolve(Response.json({ success: true, pins: [] })); await tick(); assert.equal(d.calls.length, 2);
  } finally { d.h.cleanup(); }
});
test('ordinary unpinned realtime changes preserve pin state references instead of rendering another full thread', async () => {
  const d = fixture(); try {
    d.render(); d.calls[0].resolve(Response.json({ success: true, pins: [] })); await tick(); const before = d.render().pins;
    for (let i = 0; i < 100; i++) d.event(row(`m${i}`));
    assert.equal(d.render().pins, before);
  } finally { d.h.cleanup(); }
});
test('switching conversations aborts pin transport; an ignored late response cannot replace the current pins', async () => {
  const d = fixture(); try {
    d.render(); const old = d.calls[0]; d.select('b'); assert.equal(old.init.signal.aborted, true);
    d.calls[1].resolve(Response.json({ success: true, pins: [row('b-pin', 'b', true)] })); await tick();
    old.resolve(Response.json({ success: true, pins: [row('a-pin', 'a', true)] })); await tick();
    assert.deepEqual(Array.from(d.render().pins, item => item.id), ['b-pin']);
  } finally { d.h.cleanup(); }
});
test('pin changes during the historical read preserve both the live change and unrelated older pins', async () => {
  const d = fixture(); try {
    d.render(); d.event(row('live', 'a', true));
    d.calls[0].resolve(Response.json({ success: true, pins: [row('history', 'a', true)] })); await tick();
    assert.deepEqual([...d.render().pins.map(item => item.id)].sort(), ['history', 'live']);
  } finally { d.h.cleanup(); }
});
test('failed pin reads remain retryable and successful retry clears the error', async () => {
  const d = fixture(); try {
    d.render(); d.calls[0].resolve(Response.json({ success: false, error: 'Fixture failure' }, { status: 503 })); await tick();
    assert.ok(d.render().error); void d.render().refresh(); assert.equal(d.calls.length, 2);
    d.calls[1].resolve(Response.json({ success: true, pins: [row('retry', 'a', true)] })); await tick();
    assert.equal(d.render().error, null); assert.deepEqual(Array.from(d.render().pins, item => item.id), ['retry']);
  } finally { d.h.cleanup(); }
});
test('deadline during response body reading rejects late pins and allows a fresh retry', async () => {
  const deadline = new AbortController(); let expired = false;
  const d = fixture({ AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout: () => expired ? new AbortController().signal : deadline.signal } });
  try {
    d.render(); let finishBody;
    d.calls[0].resolve({ ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) }); await tick();
    deadline.abort(new DOMException('Fixture deadline', 'TimeoutError')); expired = true;
    finishBody({ success: true, pins: [row('late', 'a', true)] }); await tick();
    assert.ok(d.render().error); assert.equal(d.render().pins.length, 0);
    void d.render().refresh(); d.calls[1].resolve(Response.json({ success: true, pins: [] })); await tick(); assert.equal(d.render().error, null);
  } finally { d.h.cleanup(); }
});
test('rapid A to B to A retires old catch-up work and ignores both obsolete responses', async () => {
  const d = fixture(); try {
    d.render(); d.win.dispatchEvent(new Event('focus')); d.select('b'); d.select('a');
    assert.equal(d.calls.length, 3); assert.equal(d.calls[0].init.signal.aborted, true); assert.equal(d.calls[1].init.signal.aborted, true);
    d.calls[2].resolve(Response.json({ success: true, pins: [row('current', 'a', true)] })); await tick();
    d.calls[0].resolve(Response.json({ success: true, pins: [row('retired-a', 'a', true)] }));
    d.calls[1].resolve(Response.json({ success: true, pins: [row('retired-b', 'b', true)] })); await tick();
    assert.equal(d.calls.length, 3); assert.deepEqual(Array.from(d.render().pins, item => item.id), ['current']);
  } finally { d.h.cleanup(); }
});
