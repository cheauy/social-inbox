const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
function setup() {
  const values = new Map();
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(require.resolve('./inbox-cache.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require','module','exports',compiled)(() => ({ sessionStorage: storage }), module, module.exports);
  return { ...module.exports, values, storage };
}
const rows = Array.from({ length: 50 }, (_, i) => ({ id: String(i), business_id: 'shop' }));
test('only 30 rows are persisted', async () => {
  const app = setup(); app.writeInboxCache('user', ['shop'], rows);
  assert.equal((await app.readInboxCache('user', ['shop'])).length, 30);
});
test('different account or workspace cannot read cached customers', async () => {
  const app = setup(); app.writeInboxCache('user', ['shop'], rows);
  assert.equal(await app.readInboxCache('other', ['shop']), null);
  assert.equal(await app.readInboxCache('user', ['other']), null);
});
test('changing the merged workspace selection does not reuse the cache', async () => {
  const app = setup(); app.writeInboxCache('user', ['shop', 'other'], rows);
  assert.equal(await app.readInboxCache('user', ['shop']), null);
  assert.equal((await app.readInboxCache('user', ['other', 'shop'])).length, 30);
});
test('logout removes an in-flight write and prevents old data returning', async () => {
  const app = setup();
  let release;
  app.storage.setItem = async (key,value) => { await new Promise(resolve => { release = resolve; }); app.values.set(key,value); };
  app.writeInboxCache('user', ['shop'], rows);
  await new Promise(resolve => setImmediate(resolve));
  const cleared = app.clearInboxCache(); release(); await cleared;
  assert.equal(await app.readInboxCache('user', ['shop']), null);
  assert.equal(app.values.size, 0);
});
test('expired or corrupted snapshots are ignored', async () => {
  const app = setup(); app.writeInboxCache('user', ['shop'], rows);
  await app.readInboxCache('user', ['shop']);
  const [key, value] = [...app.values][0];
  app.values.set(key, JSON.stringify({ ...JSON.parse(value), at: 1 }));
  assert.equal(await app.readInboxCache('user', ['shop']), null);
  app.values.set(key, 'broken');
  assert.equal(await app.readInboxCache('user', ['shop']), null);
});
test('oversized snapshots are not written', async () => {
  const app = setup(); app.writeInboxCache('user', ['shop'], [{ ...rows[0], last_message_text: 'x'.repeat(130000) }]);
  assert.equal(await app.readInboxCache('user', ['shop']), null);
});
