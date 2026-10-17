/* Repeatable Node/hook measurements, not browser or production latency. */
const fs = require('node:fs'), vm = require('node:vm'), cp = require('node:child_process'), ts = require('typescript');
const { loader, hooks, tick } = require('./inbox-recovery-harness.cjs');
const baseline = process.env.TENH_PERF_BASE_REF || '35b5fdd8a4b0cef942fda658506a0daa10b44e98';
const source = (file, before) => before ? cp.execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8');
const contract = loader()('lib/inbox/conversation-page-contract.ts');
const sync = loader()('lib/inbox/live-sync.ts');
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

function pagerMeasure(before) {
  const h = hooks(), events = new EventTarget(); let serializations = 0;
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `c${i}`, business_id: 'b1', status: 'open', unread_count: 1,
    last_message_at: '2026-10-17T00:00:00Z', social_account: { id: 'channel' },
    contact: { toJSON() { serializations++; return { name: 'Synthetic', tags: Array(15).fill('fixture-tag') }; } },
  }));
  const request = { status: 'all', view: 'all', search: '', channelId: null, workspaceId: null, workspaceContextId: 'b1', cursor: null };
  const counts = { views: { all: 1000, unread: 1000 }, totalUnreadCount: 1000, unreadConversationCount: 1000 };
  const initial = { request, page: { ids: rows.slice(0, 30).map(row => row.id), total: 1000, counts, hasMore: true, cursor: null } };
  const scriptModule = { exports: {} };
  const dependencies = { react: h.React, '@/lib/display/foreground-loading': { beginForegroundLoading: () => () => {} },
    '@/lib/inbox/live-sync': sync, './conversation-page-contract': contract };
  vm.runInNewContext(ts.transpileModule(source('lib/inbox/use-conversation-pages.ts', before), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: scriptModule, exports: scriptModule.exports, require: name => dependencies[name], document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: events, Date, CustomEvent, AbortController, AbortSignal, setTimeout, clearTimeout, fetch: () => { throw Error('Unexpected paging read'); } });
  const render = () => h.render(() => scriptModule.exports.useConversationPages(initial, request, rows), {});
  render(); for (let i = 0; i < 20; i++) render();
  serializations = 0;
  const start = performance.now(); for (let i = 0; i < 200; i++) render();
  const elapsedMs = performance.now() - start;
  h.cleanup(); return { elapsedMs, serializations };
}

function pollCode(before) {
  const full = source('components/inbox/inbox-view.tsx', before);
  const start = full.indexOf('useEffect(() => {', full.indexOf(' * Active-thread live safety net.'));
  return ts.transpileModule(full.slice(start, full.indexOf('\n]);', start) + 4), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
async function pollMeasure(before, shareInitial) {
  const pending = { messages: [{ id: 'old', conversation_id: 'c1', direction: 'incoming', message_text: 'old', attachment_url: null, created_at: '2026-10-17T00:00:00Z' }] };
  let cleanup, reads = 0, messageUpdates = 0, previewUpdates = 0, messages = pending.messages, conversations = [{ id: 'c1', last_message_text: 'old', last_message_at: pending.messages[0].created_at }];
  const timers = new Map(), win = new EventTarget(); let timer = 0;
  win.setTimeout = (fn, delay) => { timers.set(++timer, { fn, delay }); return timer; }; win.clearTimeout = id => timers.delete(id);
  const doc = new EventTarget(); doc.visibilityState = 'visible';
  const messageRef = { current: messages }, conversationRef = { current: conversations };
  const load = loader();
  vm.runInNewContext(pollCode(before), {
    useEffect: fn => { cleanup = fn(); }, resolvedActiveConversationId: 'c1', window: win, document: doc, navigator: { onLine: true }, URLSearchParams, AbortController,
    MESSAGE_PAGE_SIZE: 25, SYNC_TIMEOUT_MS: 15000, INBOX_SYNC_EVENT: sync.INBOX_SYNC_EVENT,
    readMessagePageResponse: load('lib/inbox/read-message-page-response.ts').readMessagePageResponse,
    matchesOptimisticMessage: load('lib/inbox/optimistic-message-match.ts').matchesOptimisticMessage,
    fetch: async () => { reads++; return Response.json({ success: true, ...pending }); },
    realtimeHealthyRef: { current: true }, liveMessagesRef: messageRef, liveConversationsRef: conversationRef,
    handledIncomingMessageIdsRef: { current: new Set() }, recentIncomingConversationAtRef: { current: new Map() },
    lastSoundedIncomingMessageTimeRef: { current: new Map() }, conversationMessageRequestRef: { current: shareInitial ? { c1: Promise.resolve(pending) } : {} },
    pendingSendsRef: { current: {} }, pendingAttachmentSendsRef: { current: {} }, notifyIncomingMessage() {},
    setLiveMessages: update => { const next = update(messages); if (next !== messages) messageUpdates++; messageRef.current = messages = next; },
    setLiveConversations: update => { const next = update(conversations); if (next.some((row, i) => row !== conversations[i])) previewUpdates++; conversationRef.current = conversations = next; },
    messageOrderMs: message => Date.parse(message.created_at), sortLiveConversations: rows => rows, getRealtimeMessagePreview: message => message.message_text,
    isAbortError: error => error?.name === 'AbortError', console,
  });
  await tick();
  if (!shareInitial) for (let i = 0; i < 3; i++) { const job = [...timers].find(([, value]) => value.delay === 60000); timers.delete(job[0]); await job[1].fn(); }
  cleanup(); return { readsIncludingExistingSelection: reads + Number(shareInitial), messageStateChanges: messageUpdates, previewObjectChanges: previewUpdates };
}

(async () => {
  const samples = { before: [], after: [] };
  for (let n = 0; n < 5; n++) for (const before of [true, false]) samples[before ? 'before' : 'after'].push(pagerMeasure(before));
  const report = { kind: 'synthetic Node VM + hook doubles; no browser paints, database or production timings', baseline,
    stablePagerRenders: { rows: 1000, renders: 200, samples: 5,
      before: { medianMs: median(samples.before.map(x => x.elapsedMs)), contactSerializations: samples.before[0].serializations },
      after: { medianMs: median(samples.after.map(x => x.elapsedMs)), contactSerializations: samples.after[0].serializations } },
    coldSelection: { before: await pollMeasure(true, true), after: await pollMeasure(false, true) },
    fourUnchangedSafetyReads: { before: await pollMeasure(true, false), after: await pollMeasure(false, false) } };
  const destination = 'docs/evidence/inbox-storage-performance-20261017/measurements.json';
  fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
