const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ROOT } = require('./tenh-seven/harness.cjs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(ROOT, 'mobile/app/conversation/[id].tsx'), 'utf8');
const start = source.indexOf('      const canAlbum =');
const end = source.indexOf('      if (text && !telegramCaption)', start);
assert.ok(start > 0 && end > start);
const run = new Function('context', `return (async () => { const {visualFiles,pendingSnapshot,platform,quotedSnapshot,telegramCaption,uploadAlbum,uploadOne,sentFileKeys}=context; ${ts.transpileModule(source.slice(start, end), { compilerOptions: {target: ts.ScriptTarget.ES2022} }).outputText} })()`);
async function send(platform, count, failAt) {
  const files = Array.from({length:count}, (_, i) => ({key:String(i),kind:'image'}));
  const calls = [], sentFileKeys = new Set();
  const upload = async (items, caption) => { calls.push({items,caption}); if(calls.length === failAt) throw new Error('Upload rejected'); };
  let error;
  try { await run({ platform,visualFiles:files,pendingSnapshot:files,quotedSnapshot:null,telegramCaption:platform === 'telegram' ? 'Caption' : '',sentFileKeys,uploadAlbum:upload,uploadOne:(file,caption)=>upload([file],caption) }); } catch (cause) { error=cause; }
  return {calls,sentFileKeys,error};
}
test('Telegram 21 attachments become 10 + 10 + 1 with one caption', async () => {
  const h = await send('telegram',21);
  assert.deepEqual(h.calls.map(x=>x.items.length),[10,10,1]);
  assert.deepEqual(h.calls.map(x=>x.caption),['Caption','','']); assert.equal(h.sentFileKeys.size,21);
});
test('failed second batch preserves completed files and stops later sends', async () => {
  const h = await send('telegram',25,2);
  assert.ok(h.error); assert.equal(h.calls.length,2); assert.equal(h.sentFileKeys.size,10);
});
test('Facebook 30 photos remain one album', async () => {
  const h = await send('facebook',30);
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].items.length,30);
});
