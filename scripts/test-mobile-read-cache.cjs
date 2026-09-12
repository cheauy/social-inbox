const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  let now = 1000;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('mobile/lib/api/read-cache.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Date: { now: () => now } });
  return { ...exports, advance: ms => now += ms };
}
const key = (user, workspace, path) => JSON.stringify([user, workspace, path]);
test('reopens reuse fresh data and stale data displays before refresh finishes', async () => {
  const h = harness(); let calls = 0;
  const load = async () => ({ version: ++calls });
  const k = key('a', 'shop', '/api/tags');
  await h.cachedRead(k, load);
  assert.equal((await h.cachedRead(k, load)).version, 1);
  assert.equal(calls, 1);
  h.advance(16000);
  let resolve, shown;
  const result = h.cachedRead(k, () => new Promise(r => resolve = r), { onCached: data => shown = data.version });
  assert.equal(shown, 1);
  resolve({ version: 2 });
  assert.equal((await result).version, 2);
});
test('in-flight requests coalesce and account/workspace data remain separate', async () => {
  const h = harness(); let calls = 0;
  const load = async () => { calls++; return 'data'; };
  await Promise.all([h.cachedRead('a:shop', load), h.cachedRead('a:shop', load)]);
  assert.equal(calls, 1);
  await h.cachedRead('b:shop', load); await h.cachedRead('a:other', load);
  assert.equal(calls, 3);
});
test('logout and edits prevent late requests from repopulating the cache', async () => {
  const h = harness(); let resolve;
  const old = h.cachedRead('a', () => new Promise(r => resolve = r));
  h.clearReadCache(); resolve('old'); await old;
  assert.equal(await h.cachedRead('a', async () => 'new'), 'new');
});
test('sending invalidates thread data while preserving quick replies and other workspaces', async () => {
  const h = harness();
  const messages = key('a', 'shop', '/api/conversations/1/messages');
  const replies = key('a', 'shop', '/api/saved-replies');
  const other = key('a', 'other', '/api/conversations/1/messages');
  for (const k of [messages, replies, other]) await h.cachedRead(k, async () => 'cached');
  h.invalidateReadCache('a', 'shop', '/api/facebook/send');
  assert.equal(await h.cachedRead(messages, async () => 'updated'), 'updated');
  assert.equal(await h.cachedRead(replies, async () => 'unexpected'), 'cached');
  assert.equal(await h.cachedRead(other, async () => 'unexpected'), 'cached');
});
test('failed requests are retryable and old data expires', async () => {
  const h = harness();
  await assert.rejects(h.cachedRead('x', async () => { throw Error('offline'); }));
  assert.equal(await h.cachedRead('x', async () => 'first'), 'first');
  h.advance(301000);
  let shown = false;
  assert.equal(await h.cachedRead('x', async () => 'new', { onCached: () => shown = true }), 'new');
  assert.equal(shown, false);
});
