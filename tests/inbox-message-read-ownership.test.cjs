const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const parsed = ts.createSourceFile('inbox.tsx', fs.readFileSync('components/inbox/inbox-view.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let callback;
function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(parsed) === 'loadConversationMessagePage') callback = n.initializer.arguments[0].getText(parsed); ts.forEachChild(n, visit); } visit(parsed);
test('latest message reads deduplicate, bound stalled transport and never cache an ignored aborted response', async () => {
  const calls = [], deadlines = [], cache = new Map(), context = {
    getCachedConversationPage: () => null, setCachedConversationPage: (id, page) => cache.set(id, page),
    conversationMessageRequestRef: { current: {} }, conversationMessageAbortRef: { current: {} }, AbortController, URLSearchParams,
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => { deadlines.push(ms); return AbortSignal.timeout(ms); } },
    MESSAGE_PAGE_SIZE: 25, SYNC_TIMEOUT_MS: 15000, messageOrderMs: row => Date.parse(row.created_at), readMessagePageResponse: response => response.json(),
    fetch: (url, init) => new Promise(resolve => calls.push({ url, init, resolve })),
  };
  vm.createContext(context); vm.runInContext(ts.transpileModule('globalThis.read = ' + callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const first = context.read('conversation-a'), second = context.read('conversation-a'); assert.equal(calls.length, 1); assert.deepEqual(deadlines, [15000]);
  const a = assert.rejects(first, { name: 'AbortError' }), b = assert.rejects(second, { name: 'AbortError' });
  context.conversationMessageAbortRef.current['conversation-a'].abort(); calls[0].resolve(Response.json({ messages: [{ id: 'old', conversation_id: 'conversation-a', created_at: '2026-10-03T00:00:00Z' }], hasMore: false }));
  await Promise.all([a, b]); assert.equal(cache.size, 0); assert.equal(calls[0].init.signal.aborted, true);
  const retry = context.read('conversation-a'); assert.equal(calls.length, 2); calls[1].resolve(Response.json({ messages: [], hasMore: false })); await retry;
  assert.equal(cache.get('conversation-a').messages.length, 0);
});
