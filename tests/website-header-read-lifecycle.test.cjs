const test = require('node:test'), assert = require('node:assert/strict');
const { loader, hooks, nodes, tick } = require('./inbox-recovery-harness.cjs');
function widget() {
  const h = hooks(), requests = [], intervals = [], channels = [], win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible'; const timers = new Map(); let timer = 0;
  win.setTimeout = fn => { timers.set(++timer, fn); return timer; }; win.clearTimeout = id => timers.delete(id);
  win.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }; win.clearInterval = () => {};
  const load = loader({ react: h.React, 'react/jsx-runtime': h.jsx,
    'next/navigation': { useRouter: () => ({ push() {}, refresh() {} }) },
    '@/lib/inbox/notification-sounds': { getStoredNotificationVolume: () => 0 },
    '@/lib/supabase/client': { createClient: () => ({ channel: () => { const c = { events: [], on(_name, config, fn) { this.events.push({ config, fn }); return this; }, subscribe() { return this; } }; channels.push(c); return c; }, removeChannel() {} }) },
  }, { window: win, document: doc, Event, AbortController, Audio: class { addEventListener() {} pause() {} play() { return Promise.resolve(); } },
    fetch: (url, init = {}) => new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
  });
  const Component = load('components/dashboard/team-notification-center.tsx').TeamNotificationCenter;
  const render = () => h.render(Component, {});
  const click = () => { nodes(render(), n => n.type === 'button' && String(n.props['aria-label']).startsWith('Notifications'))[0].props.onClick(); render(); };
  render(); return { h, render, click, requests, channels, win, intervals, timers };
}
const team = (id = 'new') => ({ success: true, memberIds: ['m1'], currentBusinessId: 'b1', notifications: [{ id, business_id: 'b1', title: 'Note ' + id, notification_type: 'customer_note_mention', is_read: false, created_at: '2026-10-07T00:00:00Z', link: null }] });
const settle = async (r, body, status = 200) => { r.resolve(Response.json(body, { status })); await tick(); };
const text = tree => JSON.stringify(tree);
test('mount, bell and resume share overlapping reads but never cache completed responses', async () => {
  const w = widget(); try {
    w.click(); w.click(); w.click(); w.win.dispatchEvent(new Event('focus')); w.win.dispatchEvent(new Event('online'));
    for (const fn of w.timers.values()) fn(); w.timers.clear(); assert.equal(w.requests.length, 2);
    await settle(w.requests[0], team()); await settle(w.requests[1], { success: true, announcement: null });
    w.click(); w.click(); assert.equal(w.requests.length, 4);
  } finally { w.h.cleanup(); }
});
test('correct notifications publish before the announcement completes', async () => {
  const w = widget(); try { w.click(); await settle(w.requests[0], team('fast'));
    assert.match(text(w.render()), /Note fast/); assert.doesNotMatch(text(w.render()), /Loading notifications/);
  } finally { w.h.cleanup(); }
});
test('slow announcement cannot prevent the next 30-second notification poll', async () => {
  const w = widget(); try { await settle(w.requests[0], team()); w.intervals[0].fn();
    assert.equal(w.requests.length, 3); assert.equal(w.requests[2].url, '/api/team-notifications'); assert.equal(w.intervals[0].ms, 30000);
  } finally { w.h.cleanup(); }
});
test('workspace invalidation fences old responses even when transport ignores abort', async () => {
  const w = widget(); try {
    const old = [...w.requests]; w.win.dispatchEvent(new Event('tenh:workspace-data-changed')); assert.ok(old.every(r => r.init.signal.aborted));
    w.click(); assert.equal(w.requests.length, 4); await settle(w.requests[2], team('correct')); await settle(w.requests[3], { success: true, announcement: null });
    await settle(old[0], team('old')); await settle(old[1], { success: true, announcement: { title: 'Old workspace', id: 'old' } });
    assert.match(text(w.render()), /Note correct/); assert.doesNotMatch(text(w.render()), /Old workspace|Note old/);
  } finally { w.h.cleanup(); }
});
test('unmount aborts transports and does not publish a retired response', async () => {
  const w = widget(); w.h.cleanup(); assert.ok(w.requests.every(r => r.init.signal.aborted));
  await settle(w.requests[0], team('retired')); await settle(w.requests[1], { success: true, announcement: null });
  assert.equal(w.h.slots.find(v => Array.isArray(v) && v.some(row => row?.id === 'retired')), undefined);
});
test('failure retires the read and an explicit retry is fresh', async () => {
  const w = widget(); try {
    w.click(); w.requests[0].reject(Error('Synthetic offline')); w.requests[1].reject(Error('Synthetic offline')); await tick();
    assert.match(text(w.render()), /Unable to load notifications/);
    nodes(w.render(), n => n.type === 'button' && n.props.children === 'Try again')[0].props.onClick(); assert.equal(w.requests.length, 4);
    await settle(w.requests[2], team('recovered')); await settle(w.requests[3], { success: true, announcement: null }); assert.match(text(w.render()), /Note recovered/);
  } finally { w.h.cleanup(); }
});
for (const status of [401, 403]) test('denial ' + status + ' clears protected state and fences pending announcements', async () => {
  const w = widget(); try {
    w.click(); await settle(w.requests[0], team('old')); w.render(); w.click(); w.click();
    await settle(w.requests.findLast(r => r.url === '/api/team-notifications'), { success: false }, status);
    await settle(w.requests[1], { success: true, announcement: { id: 'late', title: 'Late private announcement' } });
    assert.doesNotMatch(text(w.render()), /Note old|Late private announcement/);
  } finally { w.h.cleanup(); }
});
test('realtime deletion cannot be overwritten by an older read snapshot', async () => {
  const w = widget(); try {
    w.click(); await settle(w.requests[0], team('old')); w.render(); w.click(); w.click(); const stale = w.requests.findLast(r => r.url === '/api/team-notifications');
    w.channels[0].events.find(e => e.config.event === 'DELETE').fn({ old: { id: 'old' } }); await settle(stale, team('old'));
    assert.doesNotMatch(text(w.render()), /Note old/);
  } finally { w.h.cleanup(); }
});
test('optimistic mark-read fences snapshots without another GET', async () => {
  const w = widget(); try {
    w.click(); await settle(w.requests[0], team('read-me')); await settle(w.requests[1], { success: true, announcement: null });
    w.render(); w.click(); w.click(); const stale = w.requests.findLast(r => r.url === '/api/team-notifications');
    nodes(w.render(), n => n.type === 'button' && n.key === 'read-me')[0].props.onClick(); const mutation = w.requests.at(-1); assert.equal(mutation.init.method, 'PATCH');
    await settle(mutation, { success: true }); await settle(stale, team('read-me')); assert.doesNotMatch(text(w.render()), /Note read-me/); assert.equal(w.requests.length, 5);
  } finally { w.h.cleanup(); }
});
