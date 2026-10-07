const test = require('node:test'), assert = require('node:assert/strict');
const { loader, hooks, nodes, tick } = require('./inbox-recovery-harness.cjs');

function fixture(file, name) {
  const h = hooks(), calls = [], timers = new Map(), intervals = new Map();
  let timerId = 0;
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  const schedule = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  win.setTimeout = schedule; win.clearTimeout = id => timers.delete(id);
  win.setInterval = fn => { const id = ++timerId; intervals.set(id, fn); return id; }; win.clearInterval = id => intervals.delete(id);
  const channel = { on() { return this; }, subscribe() { return this; } };
  const load = loader({
    react: h.React, 'react/jsx-runtime': h.jsx, 'next/link': { default: 'a' },
    '@/lib/analytics/use-analytics-filters':{useAnalyticsFilters(initial='today'){
      const [period,setPeriod]=h.React.useState(initial),[slaMinutes,setSlaMinutes]=h.React.useState(10);
      return{period,setPeriod,slaMinutes,setSlaMinutes,timezone:'UTC',businessId:'business-a',query:new URLSearchParams({period,slaMinutes:String(slaMinutes),tzOffsetMinutes:String(new Date().getTimezoneOffset())}).toString()};
    }},
    '@/lib/display/foreground-loading': { useForegroundLoading() {}, beginForegroundLoading: () => () => {} },
    '@/lib/supabase/client': { createClient: () => ({ channel: () => channel, removeChannel() {}, auth: { getSession: async () => ({ data: { session: null } }) } }) },
  }, { window: win, document: doc, AbortController, URLSearchParams, queueMicrotask: schedule, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    fetch: (url, init) => new Promise((resolve, reject) => calls.push({ url, init, resolve, reject })) });
  const Panel = load(file)[name];
  const render = () => h.render(Panel, {});
  const jobs = () => { const work = [...timers.values()]; timers.clear(); for (const fn of work) fn(); };
  const settle = async (from = 0, summary = {}) => { for (const call of calls.slice(from)) call.resolve(Response.json({ success: true, businessId: 'business-a', start:'2026-10-05T00:00:00Z',end:'2026-10-06T00:00:00Z',snapshotAt:'2026-10-06T12:00:00Z',summary, channels: [], analytics: call.url.startsWith('/api/analytics/overview')?{
    definitionVersion:'human-overview-v1',scope:['messenger','comment','telegram'],current:{unassigned:0,unread:0,waitingOverSla:0,unknownWaiting:0,overdue:0},
    period:{conversations:0,commentThreads:0,resolved:0,firstResponses:0,avgFirstResponseSeconds:null,slaMet:0,slaMissed:0,slaDenominator:0,slaRate:null,humanEvaluableConversations:0,unknownHumanConversations:0},
    messages:{incoming:0,outgoing:0,humanOutgoing:0,botOutgoing:0,unknownOutgoing:0},customers:{active:0,new:0,returning:0},daily:[],channels:[{channel:'messenger',value:0},{channel:'comment',value:0},{channel:'telegram',value:0}],hours:Array.from({length:24},(_,hour)=>({hour,value:0}))
  }:{ summary } })); await tick(); return render(); };
  return { h, calls, win, doc, intervals, render, jobs, settle, load };
}
const periodButton = (tree, label) => nodes(tree, n => n.type === 'button' && n.props.children === label)[0];

for (const [file, name] of [['agent-performance-panel', 'AgentPerformancePanel'], ['customer-insights-panel', 'CustomerInsightsPanel'], ['conversation-reports-panel', 'ConversationReportsPanel'], ['sla-analytics-panel', 'SlaAnalyticsPanel'], ['channel-performance-panel', 'ChannelPerformancePanel'], ['dashboard-overview-panel', 'DashboardOverviewPanel']]) {
  test(name + ' ignores late success/error/finally after changing period during a refresh', async () => {
    const d = fixture(`components/analytics/${file}.tsx`, name);
    try {
      d.render(); d.jobs(); await d.settle(); const initial = d.render(); const start = d.calls.length;
      d.win.dispatchEvent(new Event('focus')); d.jobs(); const old = d.calls.slice(start); assert.ok(old.length);
      const choice = nodes(initial, n => n.type === 'button' && typeof n.props.onClick === 'function' && /^(30d|30 days|Last 30 days)$/.test(n.props.children))[0];
      assert.ok(choice, name); choice.props.onClick(); d.render(); d.jobs(); const newer = d.calls.slice(start + old.length); assert.ok(newer.length);
      for (const call of old) assert.equal(call.init.signal.aborted, true);
      await d.settle(start + old.length, { conversations: 111, received: 111, totalCustomers: 111, totalOutgoing: 111, receivedConversations: 111 });
      const settled = JSON.stringify(d.render());
      old.forEach((call, i) => i % 2 ? call.reject(Error('retired failure')) : call.resolve(Response.json({ success: true, summary: { conversations: 1162 }, analytics: { summary: { received: 1162, totalCustomers: 1162, totalOutgoing: 1162, receivedConversations: 1162 } }, channels: [] })));
      await tick(); assert.equal(JSON.stringify(d.render()), settled);
    } finally { d.h.cleanup(); }
  });
}

test('same-key live invalidations retain one trailing refresh and retire it on navigation', async () => {
  const d = fixture('components/analytics/channel-performance-panel.tsx', 'ChannelPerformancePanel');
  try {
    const requestHook = d.load('lib/analytics/use-analytics-request.ts').useAnalyticsRequest;
    const requests = d.h.render(requestHook); let followUps = 0;
    const first = requests.start('business-a/today');
    for (let i = 0; i < 20; i++) assert.equal(requests.start('business-a/today', true, () => followUps++), null);
    first.finish(); d.jobs(); assert.equal(followUps, 1);
    const second = requests.start('business-a/today'); requests.start('business-a/today', true, () => followUps++);
    second.finish(); requests.start('business-b/today'); d.jobs(); assert.equal(followUps, 1);
    assert.equal(first.current(), false); assert.equal(second.current(), false);
  } finally { d.h.cleanup(); }
});

test('Agent performance carries the browser timezone like the dashboard and SLA panels', () => {
  const d = fixture('components/analytics/agent-performance-panel.tsx', 'AgentPerformancePanel');
  try { d.render(); assert.equal(new URL(d.calls[0].url, 'https://fixture.invalid').searchParams.get('tzOffsetMinutes'), String(new Date().getTimezoneOffset())); }
  finally { d.h.cleanup(); }
});

test('empty SLA results cannot display a successful 100 percent even if the RPC sends that legacy value', async () => {
  const d = fixture('components/analytics/sla-analytics-panel.tsx', 'SlaAnalyticsPanel');
  try {
    d.render(); await d.settle(0, { received: 0, responded: 0, slaMet: 0, slaMissed: 0, slaRate: 100 });
    assert.equal(nodes(d.render(), n => n.props.children === '100%').length, 0);
  } finally { d.h.cleanup(); }
});

test('Channel performance Today -> 90 days -> Today retires the slow response, including finally', async () => {
  const d = fixture('components/analytics/channel-performance-panel.tsx', 'ChannelPerformancePanel');
  try {
    let tree = d.render(); await d.settle(); tree = d.render();
    periodButton(tree, 'Today').props.onClick(); d.render(); await d.settle(1, { conversations: 9 }); tree = d.render();
    periodButton(tree, '90 days').props.onClick(); d.render(); const older = d.calls.at(-1);
    periodButton(tree, 'Today').props.onClick(); d.render(); const newer = d.calls.at(-1);
    assert.equal(older.init.signal?.aborted, true, 'obsolete transport must be cancelled');
    older.resolve(Response.json({ success: true, summary: { conversations: 1162 }, channels: [] })); await tick();
    assert.equal(nodes(d.render(), n => n.type === 'button' && n.props.children === 'Refreshing...').length, 1, 'old finally cannot end Today loading');
    newer.resolve(Response.json({ success: true, summary: { conversations: 9 }, channels: [] })); await tick(); tree = d.render();
    assert.ok(nodes(tree, n => n.type === 'p' && n.props.children === '9').length);
    assert.equal(nodes(tree, n => n.type === 'p' && n.props.children === '1162').length, 0);
  } finally { d.h.cleanup(); }
});

test('Channel focus revalidation preserves the populated panel while its read is pending', async () => {
  const d = fixture('components/analytics/channel-performance-panel.tsx', 'ChannelPerformancePanel');
  try {
    d.render(); await d.settle(0, { conversations: 9 });
    const before = JSON.stringify(d.render());
    d.win.dispatchEvent(new Event('focus')); d.jobs();
    assert.equal(d.calls.length, 2);
    assert.equal(JSON.stringify(d.render()), before);
  } finally { d.h.cleanup(); }
});

test('Dashboard preserves all period and SLA controls during the first fetch and period changes', async () => {
  const d = fixture('components/analytics/dashboard-overview-panel.tsx', 'DashboardOverviewPanel');
  try {
    let tree = d.render(); d.jobs();
    for (const label of ['Today', 'Yesterday', '7 days', '30 days']) assert.ok(periodButton(tree, label), label);
    assert.equal(nodes(tree, n => n.type === 'select').length, 2);
    await d.settle(); tree = d.render(); periodButton(tree, 'Yesterday').props.onClick(); tree = d.render(); d.jobs();
    assert.ok(periodButton(tree, 'Today')); assert.equal(d.calls.length, 2);
  } finally { d.h.cleanup(); }
});

test('Dashboard hidden poll and focus do no requests; resume and focus coalesce with in-flight deduplication', async () => {
  const d = fixture('components/analytics/dashboard-overview-panel.tsx', 'DashboardOverviewPanel');
  try {
    d.render(); d.jobs(); await d.settle(); d.doc.visibilityState = 'hidden';
    assert.equal(d.intervals.size,0,'the redesigned overview adds no polling');
    for (const fn of d.intervals.values()) fn(); d.win.dispatchEvent(new Event('focus')); d.jobs(); assert.equal(d.calls.length, 1);
    d.doc.visibilityState = 'visible'; d.doc.dispatchEvent(new Event('visibilitychange')); d.win.dispatchEvent(new Event('focus')); d.jobs();
    assert.equal(d.calls.length, 2); for (const fn of d.intervals.values()) fn(); assert.equal(d.calls.length, 2);
  } finally { d.h.cleanup(); }
});

test('every dated Analytics panel cancels transport on unmount', async () => {
  for (const [file, name] of [['agent-performance-panel', 'AgentPerformancePanel'], ['customer-insights-panel', 'CustomerInsightsPanel'], ['conversation-reports-panel', 'ConversationReportsPanel'], ['sla-analytics-panel', 'SlaAnalyticsPanel'], ['channel-performance-panel', 'ChannelPerformancePanel'], ['dashboard-overview-panel', 'DashboardOverviewPanel']]) {
    const d = fixture(`components/analytics/${file}.tsx`, name); d.render(); d.jobs(); assert.ok(d.calls.length > 0, name);
    d.h.cleanup(); for (const call of d.calls) assert.equal(call.init.signal?.aborted, true, name);
    for (const call of d.calls) call.resolve(Response.json({ success: true, analytics: { summary: {} }, channels: [] })); await tick();
  }
});
