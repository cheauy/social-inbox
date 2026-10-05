const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { loader } = require('./inbox-recovery-harness.cjs');
const baseline = process.env.TENH_READ_AUDIT_BASELINE === '1', sourceRoot = process.env.TENH_TEST_ROOT || process.cwd();

function callback(file, name, globals) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(sourceRoot,file),'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source); ts.forEachChild(node,visit); } visit(source);
  assert.ok(found,name);
  const context = vm.createContext({ ...globals, cancelled:false, cachedChannelDirectory:{}, cachedChannelDirectoryLoaded:false });
  vm.runInContext(ts.transpileModule(found + '\nglobalThis.run = ' + name, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,context);
  return context.run;
}

test('real selector and list catalogue callbacks share one overlapping authenticated read and both parse it', async () => {
  const requests = [], rows = [], directory = [];
  const fetch = (url,init) => new Promise(resolve => requests.push({url,init,resolve}));
  const reader = loader({}, { fetch })(path.resolve('lib/inbox/read-channels.ts'));
  const common = { fetch, readInboxChannels:reader.readInboxChannels, setLoading(){}, setError(){}, setChannels: x => rows.push(x), setChannelDirectory:x => directory.push(x), setChannelDirectoryLoaded(){} };
  const selector = callback('components/inbox/inbox-channel-selector.tsx','loadChannels',common);
  const list = callback('components/inbox/conversation-list.tsx','loadChannelDirectory',common);
  const a = selector(), b = list();
  assert.equal(requests.length,baseline?2:1);
  for (const request of requests) { assert.equal(request.url,'/api/inbox/channels'); assert.equal(request.init.cache,'no-store'); request.resolve(Response.json({success:true,channels:[{id:'s1',businessId:'b1',name:'Channel',platform:'telegram'}]})); }
  await Promise.all([a,b]); assert.equal(rows[0][0].id,'s1'); assert.equal(directory[0].s1.businessId,'b1');
  console.log(JSON.stringify({ overlappingCatalogueConsumers:2, fetches:requests.length, parsedResponses:rows.length+directory.length }));
});

test('catalogue sharing keeps no completed tenant response; failures retry', async () => {
  if (baseline) return;
  let calls=0, tenant='a', fail=true;
  const helper = loader({}, { fetch:async()=>{ calls++; if(fail)throw Error('offline'); return Response.json({businessId:tenant}); } })(path.resolve('lib/inbox/read-channels.ts'));
  await assert.rejects(helper.readInboxChannels(),/offline/); fail=false;
  const [a,b] = await Promise.all([helper.readInboxChannels(),helper.readInboxChannels()]);
  assert.notEqual(a,b); assert.equal((await a.json()).businessId,'a'); assert.equal((await b.json()).businessId,'a'); assert.equal(calls,2);
  tenant='b'; assert.equal((await (await helper.readInboxChannels()).json()).businessId,'b'); assert.equal(calls,3);
});
