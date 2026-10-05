const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loader } = require('./tenh-seven/harness.cjs');
const model = loader()('mobile/lib/workspace-storage.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const file = (id, extra={}) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', sizeBytes: 123, kind: 'image', createdAt: `2026-10-${id === 'a' ? '01' : '02'}T00:00:00Z`, categoryId: null, favorite: false, previewUrl: 'https://mock.invalid/expired-preview', ...extra });
const scope = { userId: 'mock-user', workspaceId: 'mock-workspace', memberId: 'mock-member', conversationId: 'mock-thread' };

test('Storage follows web recent/category/favorite order and searches names before paging', () => {
  const snapshot = { files: [file('a'), file('b', { favorite: true, categoryId: 'sale', name: 'Blue SHIRT.png' }), file('c', { kind: 'file', name: 'invoice.pdf' })], organizationAvailable: true };
  assert.deepEqual(plain(model.storageFiles(snapshot, 'recent', 'media', '').map(f=>f.id)), ['b','a']);
  assert.deepEqual(plain(model.storageFiles(snapshot, 'favorites', 'media', ' shirt ').map(f=>f.id)), ['b']);
  assert.deepEqual(plain(model.storageFiles(snapshot, 'category:sale', 'media', 'blue').map(f=>f.id)), ['b']);
  assert.deepEqual(plain(model.storageFiles(snapshot, 'recent', 'files', 'invoice').map(f=>f.id)), ['c']);
  assert.equal(model.storageFiles({...snapshot, organizationAvailable:false}, 'favorites', 'media', '').length, 2);
  assert.equal(model.STORAGE_PAGE_SIZE, 30); assert.equal(model.STORAGE_WINDOW_LIMIT, 150);
});
test('download names cannot traverse outside the operation cache and get a native extension', () => {
  const name = model.storageFileName(file('a', { name:'../../Shirt', mimeType:'image/png' }));
  assert.equal(name.includes('/'), false); assert.equal(name.startsWith('.'), false); assert.match(name, /\.png$/);
  assert.equal(model.storageFileName(file('a', { name:'invoice',kind:'file',mimeType:'application/pdf' })), 'invoice.pdf');
});
function staging(extra={}) {
  const calls = []; let discarded=0;
  const io = { isCurrent:()=>true, getUrl:async f=>{ calls.push(['url',f.id]);return `https://mock.invalid/fresh/${f.id}`; },
    download:async(f,url)=>{calls.push(['download',f.id,url]);return {key:f.id,uri:`file:///synthetic/${f.id}`,name:f.name,mimeType:f.mimeType,kind:f.kind,bytes:f.sizeBytes};},
    discard:()=>discarded++, ...extra };
  return { io, calls, discarded:()=>discarded };
}
test('existing mixed Storage media is staged in selection order using new links and the existing Pending contract', async () => {
  const f=staging(), result=await model.stageStorageFiles([file('b',{kind:'video',mimeType:'video/mp4'}),file('a')],30,f.io);
  assert.deepEqual(plain(result.map(x=>x.key)),['b','a']); assert.equal(result[0].kind,'video');
  assert.equal('bytes' in result[0],false); assert.equal(f.discarded(),0);
  assert.ok(f.calls.filter(c=>c[0]==='download').every(c=>c[2].includes('/fresh/')));
});
test('full/overfull drafts and invalid metadata fail before any downloads',async()=>{
  for (const [files,room] of [[[file('a')],0],[[file('a'),file('b')],1],[[file('a',{sizeBytes:0})],30],[[file('a',{sizeBytes:20971521})],30]]) {
    const f=staging();await assert.rejects(model.stageStorageFiles(files,room,f.io));assert.equal(f.calls.length,0);assert.equal(f.discarded(),1);
  }
});
test('deleted file URL failure and truncated download abandon all staged copies',async()=>{
  for (const extra of [{getUrl:async f=>{if(f.id==='b')throw Error('not found');return 'https://mock.invalid/fresh';}},
    {download:async f=>({key:f.id,bytes:f.sizeBytes-1})}]) {
    const f=staging(extra);await assert.rejects(model.stageStorageFiles([file('a'),file('b')],30,f.io));assert.equal(f.discarded(),1);
  }
});
test('unsafe download URL is rejected before filesystem access',async()=>{
  const f=staging({getUrl:async()=> 'http://mock.invalid/file'});await assert.rejects(model.stageStorageFiles([file('a')],30,f.io),/secure/);assert.equal(f.calls.length,0);assert.equal(f.discarded(),1);
});
test('late file URL and late native download cannot attach after cancellation or ownership change',async()=>{
  for (const phase of ['url','download']) {
    const wait=deferred();let current=true;
    const f=staging({isCurrent:()=>current,...(phase==='url'?{getUrl:()=>wait.promise}:{download:()=>wait.promise})});
    const result=model.stageStorageFiles([file('a'),file('b')],30,f.io);await flush();current=false;
    wait.resolve(phase==='url'?'https://mock.invalid/fresh':{key:'a',bytes:123});
    await assert.rejects(result,/cancelled/);assert.equal(f.discarded(),1);
    if(phase==='url') assert.equal(f.calls.length,0);
  }
});

function apiFixture(options={}) {
  let uuid=0;const calls=[], directories=[];let downloadOptions;
  class MockDirectory { constructor(base,name){this.uri=`${base?.uri??'file:///synthetic'}/${name}`;this.exists=false;directories.push(this);}create(){this.exists=true;}delete(){this.exists=false;} }
  class MockFile { constructor(dir,name){this.uri=typeof dir==='string'?dir:`${dir.uri}/${name}`;this.size=123;this.exists=true;}delete(){this.exists=false;}static async downloadFileAsync(url,target,opts){downloadOptions=opts;return options.download ? options.download(url,target,opts) : target;} }
  class MockApiError extends Error { constructor(message,status){super(message);this.status=status;} }
  const api=async(path,workspaceId,init={})=>{
    calls.push({path,workspaceId,init});
    if(path.startsWith('/api/mobile/bootstrap')) {
      if(options.bootstrapError) throw new MockApiError('Mock workspace unavailable',403);
      return {member:{id:options.memberId??scope.memberId,role:options.role??'agent'}, permissions:{conversations:options.permission??'manage'},conversations:options.conversations??[{id:scope.conversationId,business_id:scope.workspaceId}]};
    }
    if(init.body?.action==='get-file-url') return {success:true,signedUrl:'https://mock.invalid/fresh'};
    return options.response??{success:true,businessId:scope.workspaceId,memberId:scope.memberId,hasMore:false,nextCursor:null,files:[file('a')],categories:[],organizationAvailable:true,canManage:false};
  };
  const load=loader({'expo-crypto':{randomUUID:()=>`mock-${++uuid}`},'expo-file-system':{Directory:MockDirectory,File:MockFile,Paths:{cache:'mock-cache'}},
    './api/client':{api,ApiError:MockApiError},'./supabase/client':{supabase:{auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:options.userId??scope.userId}}}})}}}}, {AbortController,URLSearchParams});
  return {api:load('mobile/lib/workspace-storage-api.ts'),calls,directories,downloadOptions:()=>downloadOptions};
}
test('fresh bootstrap pins every Storage request to thread workspace and membership',async()=>{
  const f=apiFixture();const signal=new AbortController().signal;
  const result=await f.api.loadStorage(scope,signal);
  assert.equal(result.canDraft,true);assert.equal(result.snapshot.canManage,false);
  assert.ok(f.calls[0].path.includes('workspaceIds=mock-workspace'));assert.ok(f.calls[0].path.includes('conversationIds=mock-thread'));
  assert.ok(f.calls.every(c=>c.workspaceId===scope.workspaceId&&c.init.signal===signal));
  await f.api.favoriteStorageFile(scope,file('a'),signal);
  assert.equal(f.calls[2].path.startsWith('/api/mobile/bootstrap'),true);
  assert.deepEqual(plain(f.calls[3].init.body),{action:'toggle-favorite',fileId:'a',favorite:true});
});
for (const [name,options] of [['signed-out/account switch',{userId:'other-user'}],['different membership',{memberId:'other-member'}],['wrong thread workspace',{conversations:[{id:scope.conversationId,business_id:'other'}]}],['deleted thread',{conversations:[]}],['expired workspace',{bootstrapError:true}]]) {
  test(`${name} stops before Storage reads, URL requests or native downloads`,async()=>{
    const f=apiFixture(options);await assert.rejects(f.api.loadStorage(scope,new AbortController().signal));
    assert.equal(f.calls.some(c=>c.path==='/api/workspace-storage/files'),false);assert.equal(f.directories.length,0);
  });
}
test('browse-only roles can browse/favorite but cannot stage customer media',async()=>{
  const f=apiFixture({permission:'view'}),signal=new AbortController().signal;
  assert.equal((await f.api.loadStorage(scope,signal)).canDraft,false);
  await f.api.favoriteStorageFile(scope,file('a'),signal);
  await assert.rejects(f.api.prepareStorageDraft(scope,[file('a')],30,signal,()=>true),/permission/);
  assert.equal(f.directories.length,0);
});
test('owner can stage and native download receives cancellation signal; failed copies are private to operation',async()=>{
  const f=apiFixture({role:'owner',permission:'none'}),signal=new AbortController().signal;
  const staged=await f.api.prepareStorageDraft(scope,[file('a')],30,signal,()=>true);
  assert.equal(f.downloadOptions().signal,signal);assert.equal(staged.pending[0].kind,'image');
  assert.ok(staged.pending[0].uri.includes('/tenh-storage-drafts/'));staged.discard();assert.equal(f.directories[1].exists,false);
  const failed=apiFixture({download:async()=>{throw Error('Mock network');}});
  await assert.rejects(failed.api.prepareStorageDraft(scope,[file('a')],30,signal,()=>true));assert.equal(failed.directories[1].exists,false);
});
test('native abort and ownership loss discard operation directory even if native completion arrives late',async()=>{
  const wait=deferred(),abort=new AbortController();let current=true;
  const f=apiFixture({download:(_url,target)=>wait.promise.then(()=>target)});
  const result=f.api.prepareStorageDraft(scope,[file('a')],30,abort.signal,()=>current);
  await flush();current=false;abort.abort();wait.resolve();await assert.rejects(result,/cancelled/);
  assert.equal(f.directories[1].exists,false);
});
test('undeployed pagination fails closed and legacy organization still supports paged Recent files',async()=>{
  await assert.rejects(apiFixture({response:{}}).api.loadStorage(scope,new AbortController().signal),/deployment/);
  await assert.rejects(apiFixture({response:{success:true,files:Array.from({length:250},(_,i)=>file(String(i)))}}).api.loadStorage(scope,new AbortController().signal),/pagination/);
  const f=apiFixture({response:{success:true,businessId:scope.workspaceId,memberId:scope.memberId,hasMore:false,nextCursor:null,files:Array.from({length:30},(_,i)=>file(String(i)))}});
  const result=await f.api.loadStorage(scope,new AbortController().signal);
  assert.equal(result.snapshot.files.length,30);assert.equal(result.snapshot.organizationAvailable,false);assert.equal(result.snapshot.canManage,false);
});

function pickerFixture(options={}) {
  const slots=[],effects=[],pending=[];let index=0;let props={scope,room:30,onClose(){},onDraft:()=>true,...options.props};
  const hooks={useRef(value){const i=index++;return slots[i]??=( {current:value});},useState(value){const i=index++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
    useMemo:fn=>fn(),useEffect(fn,deps){const i=index++;const old=effects[i];if(!old||JSON.stringify(deps)!==JSON.stringify(old.deps))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  const jsx=(type,props)=>({type,props});
  const mocks={loadStorage:async()=>({snapshot:{files:[file('a')],categories:[],organizationAvailable:true,canManage:false},canDraft:true,hasMore:false,nextCursor:null}),favoriteStorageFile:async()=>{},prepareStorageDraft:async()=>({pending:[{key:'mock',uri:'file:///synthetic'}],discard(){}}),...options.api};
  const load=loader({react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':Object.fromEntries(['ActivityIndicator','FlatList','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n])),
    '@expo/vector-icons':{Ionicons:'Icon'},'./auth-image':{AuthImage:'Image'},'./ui':{Sheet:'Sheet',colors:{}},'../lib/api/client':{ApiError:class extends Error{}},'../lib/workspace-storage-api':mocks},{AbortController,setTimeout(fn){const id={active:true};Promise.resolve().then(()=>{if(id.active)fn();});return id;},clearTimeout(id){if(id)id.active=false;}});
  const Component=load('mobile/components/workspace-storage-picker.tsx').WorkspaceStoragePicker;
  let tree;
  function render(next={}){props={...props,...next};index=0;tree=Component(props);while(pending.length)pending.shift()();return tree;}
  function all(node,result=[]){if(arguments.length===0)node=tree;if(!node||typeof node!=='object')return result;result.push(node);for(const child of [node.props?.children].flat(Infinity))all(child,result);return result;}
  function list(){return all().find(n=>n.type==='FlatList');}
  function button(text){return all().find(n=>n.type==='Pressable'&&all(n).some(c=>c.type==='Text'&&c.props.children===text));}
  return {render,all,list,button,unmount:()=>effects.forEach(e=>e?.cleanup?.()),select:()=>{const item=list().props.data[0];const row=list().props.renderItem({item});all(row).find(n=>n.props?.accessibilityLabel?.startsWith('Select ')).props.onPress();}};
}
test('picker uses server cursors and search can find files beyond the old newest-200 limit',async()=>{
  const calls=[];
  const f=pickerFixture({api:{loadStorage:async(_scope,_signal,page)=>{calls.push(page);return {snapshot:{files:page.query?[file('999',{name:'Product 999.jpg'})]:Array.from({length:30},(_,i)=>file(String(i+(page.cursor?30:0)),{name:`Product ${i}.jpg`})),categories:[],organizationAvailable:true},canDraft:true,hasMore:!page.query,nextCursor:'cursor-1'};}}});
  f.render();await flush();f.render();assert.equal(f.list().props.data.length,30);
  const footer=f.list().props.ListFooterComponent;footer.props.onPress();await flush();f.render();assert.equal(f.list().props.data.length,60);assert.equal(calls[1].cursor,'cursor-1');
  f.all().find(n=>n.type==='TextInput').props.onChangeText('Product 999');f.render();await flush();f.render();assert.equal(f.list().props.data.length,1);assert.equal(f.list().props.data[0].id,'999');assert.equal(calls.at(-1).query,'Product 999');
});
test('picker suppresses late success and errors from prior membership/scope',async()=>{
  for(const fails of [false,true]) {
    const first=deferred();let calls=0;
    const f=pickerFixture({api:{loadStorage:()=>++calls===1?first.promise:Promise.resolve({snapshot:{files:[file('B')],categories:[],organizationAvailable:false},canDraft:true})}});
    f.render();await flush();f.render({scope:{...scope,memberId:'replacement'}});await flush();f.render();
    if(fails)first.reject(Error('Late prior member failure'));else first.resolve({snapshot:{files:[file('A')],categories:[]},canDraft:true});
    await flush();f.render();assert.deepEqual(plain(f.list().props.data.map(x=>x.id)),['B']);assert.equal(f.all().some(n=>n.props?.children==='Late prior member failure'),false);
  }
});
test('picker cancels staging and refuses double-tap actions and late draft writes',async()=>{
  const wait=deferred();let stages=0,applied=0,discarded=0,signal;
  const f=pickerFixture({props:{onDraft:()=>{applied++;return true;}},api:{prepareStorageDraft:(_scope,_files,_room,s)=>{stages++;signal=s;return wait.promise;}}});
  f.render();await flush();f.render();f.select();f.render();
  const stage=f.button('Add to draft').props.onPress;stage();stage();assert.equal(stages,1);
  f.all().find(n=>n.type==='Sheet').props.onClose();assert.equal(signal.aborted,true);
  wait.resolve({pending:[{key:'mock'}],discard(){discarded++;}});await flush();assert.equal(applied,0);assert.equal(discarded,1);
});
test('draft commit preserves existing queued media and refuses lost thread ownership/capacity',()=>{
  const src=fs.readFileSync('mobile/app/conversation/[id].tsx','utf8'),ast=ts.createSourceFile('thread.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
  function visit(node){if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='onDraft'&&node.initializer?.expression)callback=node.initializer.expression.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(callback);
  const c={screenAlive:{current:true},focusedRef:{current:true},ownerRef:{current:'B:thread'},conversation:{business_id:'B'},id:'thread',MAX_PENDING_ATTACHMENTS:30,sendFlight:{current:false},pendingQueue:{current:[{key:'existing'}]},storageDraft:{current:{ready:true,blocked:false,pending:[{key:'existing'}]}},setPending(value){c.value=value;c.pendingQueue.current=value;}};
  vm.createContext(c);vm.runInContext(ts.transpileModule('globalThis.commit='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
  assert.equal(c.commit([{key:'storage'}]),true);assert.deepEqual(plain(c.value.map(x=>x.key)),['existing','storage']);
  c.ownerRef.current='A:thread';assert.equal(c.commit([{key:'late'}]),false);c.ownerRef.current='B:thread';
  c.pendingQueue.current=Array.from({length:30},()=>({}));assert.equal(c.commit([{key:'over'}]),false);
  c.pendingQueue.current=[];c.storageDraft.current.blocked=true;assert.equal(c.commit([{key:'comment/send'}]),false);
  c.storageDraft.current.blocked=false;c.storageDraft.current.ready=false;assert.equal(c.commit([{key:'expired'}]),false);
});

test('same-frame attachment updates share one queue before render and cannot overwrite earlier picks',()=>{
  const src=fs.readFileSync('mobile/app/conversation/[id].tsx','utf8'),ast=ts.createSourceFile('thread.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='setPending'&&ts.isCallExpression(node.initializer))callback=node.initializer.arguments[0].getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(callback);
  const c={pendingQueue:{current:[{key:'initial'}]},setPendingState(value){c.state=value;}};
  vm.createContext(c);vm.runInContext(ts.transpileModule('globalThis.update='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
  c.update(current=>[...current,{key:'device-picker'}]);c.update(current=>[...current,{key:'storage'}]);
  assert.deepEqual(plain(c.state.map(item=>item.key)),['initial','device-picker','storage']);
  c.update([]);c.update(current=>[...current,{key:'next'}]);assert.deepEqual(plain(c.state.map(item=>item.key)),['next']);
});

test('rapid distinct selections before rerender respect remaining draft capacity and repeat taps deselect',async()=>{
 const f=pickerFixture({props:{room:1},api:{loadStorage:async()=>({snapshot:{files:[file('a'),file('b')],categories:[],organizationAvailable:true},canDraft:true,hasMore:false,nextCursor:null})}});
 f.render();await flush();f.render();
 const presses=f.list().props.data.map(item=>f.all(f.list().props.renderItem({item})).find(n=>n.props?.accessibilityLabel?.startsWith('Select ')).props.onPress);
  const text=n=>Array.isArray(n.props?.children)?n.props.children.join(''):n.props?.children;
  presses[0]();presses[1]();f.render();assert.ok(f.all().some(n=>text(n)==='1 selected'));assert.ok(f.all().some(n=>String(text(n)).includes('no room')));
  presses[0]();f.render();assert.ok(f.all().some(n=>text(n)==='0 selected'));
});

test('server continuation goes beyond 200 while native retained rows stay bounded and selected old-page files survive',async()=>{
 let pages=0,staged;
 const f=pickerFixture({api:{loadStorage:async()=>({snapshot:{files:Array.from({length:30},(_,i)=>file(String(30*pages+i))),categories:[],organizationAvailable:true},canDraft:true,hasMore:++pages<9,nextCursor:'cursor-'+pages}),prepareStorageDraft:async(_scope,files)=>{staged=files;return {pending:[{key:'accepted'}],discard(){}};}}});
 f.render();await flush();f.render();f.select();f.render();
 for(let i=1;i<9;i++){f.list().props.ListFooterComponent.props.onPress();await flush();f.render();assert.ok(f.list().props.data.length<=150);}
 assert.equal(pages,9);assert.equal(f.list().props.data.at(-1).id,'269');f.button('Add to draft').props.onPress();await flush();assert.equal(staged[0].id,'0');
});
