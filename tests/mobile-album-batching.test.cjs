const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ROOT, loader } = require('./tenh-seven/harness.cjs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(ROOT, 'mobile/app/conversation/[id].tsx'), 'utf8');
const ast = ts.createSourceFile('thread.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dispatch;
function visit(node) {
  if (ts.isBlock(node)) {
    const index = node.statements.findIndex(statement => ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'batches' && ts.isCallExpression(declaration.initializer) &&
        declaration.initializer.expression.getText(ast) === 'attachmentBatches'));
    if (index >= 0 && ts.isForOfStatement(node.statements[index + 1])) {
      dispatch = node.statements.slice(index, index + 2).map(statement => statement.getText(ast)).join('\n');
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(dispatch, 'extract the actual batching plan and transport loop');
const { attachmentBatches, REQUEST_BUDGET, MULTIPART_BASE, MULTIPART_ITEM } = loader()('mobile/lib/attachment-send-plan.ts');
const run = new Function('context', `return (async () => {
  const {prepared,platform,quotedSnapshot,telegramCaption,uploadAlbum,uploadOne,sentFileKeys,attachmentBatches}=context;
  const ownsSend = () => true;
  let activeBatch = [], textConfirmed = false, captionInFlight = false, error;
  try { ${ts.transpileModule(dispatch, { compilerOptions: {target: ts.ScriptTarget.ES2022} }).outputText} }
  catch (cause) { error = cause; }
  return { activeBatch, textConfirmed, captionInFlight, error };
})()`);
async function send(platform, count, failAt, bytes = 100_000) {
  const files = Array.from({length:count}, (_, i) => ({key:String(i),kind:'image',bytes}));
  const calls = [], sentFileKeys = new Set();
  const upload = async (items, caption) => { calls.push({items,caption}); if(calls.length === failAt) throw new Error('Upload rejected'); };
  const result = await run({ platform,prepared:files,quotedSnapshot:null,telegramCaption:platform === 'telegram' ? 'Caption' : '',sentFileKeys,attachmentBatches,uploadAlbum:upload,uploadOne:(file,caption)=>upload([file],caption) });
  return {calls,sentFileKeys,...result};
}
test('Telegram 21 attachments become 10 + 10 + 1 with one caption', async () => {
  const h = await send('telegram',21);
  assert.deepEqual(h.calls.map(x=>x.items.length),[10,10,1]);
  assert.deepEqual(h.calls.map(x=>x.caption),['Caption','','']); assert.equal(h.sentFileKeys.size,21);
  assert.equal(h.textConfirmed,true); assert.equal(h.captionInFlight,false);
});
test('failed second batch preserves completed files and stops later sends', async () => {
  const h = await send('telegram',25,2);
  assert.ok(h.error); assert.equal(h.calls.length,2); assert.equal(h.sentFileKeys.size,10);
  assert.deepEqual([...h.sentFileKeys],Array.from({length:10},(_,i)=>String(i)));
  assert.equal(h.textConfirmed,true); assert.equal(h.activeBatch.length,10);
});
test('Facebook 30 photos remain one album', async () => {
  const h = await send('facebook',30);
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].items.length,30);
});

test('actual dispatch loop splits albums by aggregate multipart budget before channel count limits', async () => {
  const h = await send('telegram',10,undefined,450_000);
  assert.deepEqual(h.calls.map(x=>x.items.length),[8,2]);
  assert.deepEqual(h.calls.map(x=>x.caption),['Caption','']);
  for (const call of h.calls) {
    assert.ok(MULTIPART_BASE + call.items.reduce((sum,file)=>sum + file.bytes + MULTIPART_ITEM,0) <= REQUEST_BUDGET);
  }
  assert.equal(h.sentFileKeys.size,10);
});
