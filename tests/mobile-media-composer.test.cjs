const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { loader } = require('./tenh-seven/harness.cjs');
const equal=(a,b)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),b);
const plan = loader()('mobile/lib/attachment-send-plan.ts');
const src = fs.readFileSync('mobile/app/conversation/[id].tsx','utf8');
const ast = ts.createSourceFile('thread.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const methods = {};
function visit(node) { if(ts.isFunctionDeclaration(node)&&node.name) methods[node.name.text]=node.getText(ast); ts.forEachChild(node,visit); } visit(ast);
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const media = (key,kind='image',bytes=500_000) => ({key,kind,uri:`mock://${key}`,name:`${key}.${kind==='video'?'mp4':'jpg'}`,mimeType:kind==='video'?'video/mp4':'image/jpeg',bytes});
function fixture(options={}) {
  const state = {pending:options.pending??[],draft:options.draft??'mock caption',quoted:{id:'mock-quote'},error:'',messages:[],draftSendUnknown:false};
  const calls=[];
  const c={...plan,Error,Date,Map,Set,URLSearchParams,
    id:'mock-thread',scopeId:'mock-workspace',platform:'telegram',recipientId:'mock-recipient',typists:[],confirmedOverlapRef:{current:false},
    sending:false,sendFlight:{current:false},mediaPickerFlight:{current:false},screenAlive:{current:true},ownerRef:{current:'mock-workspace:mock-thread'},replyingToComment:null,
    storageOwner:'mock-storage-owner',beginStorageDraftSend(){},finishStorageDraftSend(){},pendingQueue:{get current(){return state.pending;}},
    pending:state.pending,draft:state.draft,quoted:state.quoted,draftSendUnknown:false,
    ApiError:Error,randomUUID:()=>`mock-${calls.length}`, fileSize:uri=>(state.pending.find(f=>f.uri===uri)?.bytes??0),
    sendable:async file=>file,
    uploadOne:async (...args)=>{calls.push({kind:'one',files:[args[0]],caption:args[1]});},
    uploadAlbum:async (...args)=>{calls.push({kind:'album',files:args[0],caption:args[1]});},
    api:async (...args)=>{calls.push({kind:'text',args});},load:async()=>{},updateConversation(){},
    optimisticText:(text,id)=>({id,message_text:text}),optimisticMessage:(file,i,sentAt)=>({id:`optimistic:inbox:${sentAt}:${i}`}),mergeMessages:(a,b)=>[...a,...b],
    ImagePicker:{requestMediaLibraryPermissionsAsync:async()=>({granted:true}),launchImageLibraryAsync:async()=>({canceled:true})},
    DocumentPicker:{getDocumentAsync:async()=>({canceled:true})},kindOf:(mime,name)=>mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'file',
    ...options,
  };
  for(const name of ['pending','draft','quoted','error','messages','draftSendUnknown','sending','fromQuickReply','replyingToComment']) {
    c['set'+name[0].toUpperCase()+name.slice(1)]=value=>{state[name]=typeof value==='function'?value(state[name]):value;};
  }
  vm.createContext(c); vm.runInContext(ts.transpileModule([methods.send,methods.pickFromLibrary,methods.pickFile].join('\n')+'\nglobalThis.send=send;globalThis.pick=pickFromLibrary;globalThis.pickDocument=pickFile;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
  }).outputText,c);
  const rerender=()=>Object.assign(c,{pending:state.pending,draft:state.draft,quoted:state.quoted,sending:state.sending,draftSendUnknown:state.draftSendUnknown});
  return {c,state,calls,send:()=>c.send(),pick:()=>c.pick(),rerender};
}

test('mixed Telegram albums preserve order and obey byte and count limits',()=>{
  const files=Array.from({length:23},(_,i)=>media(String(i),i%2?'video':'image',100_000));
  const batches=plan.attachmentBatches(files,'telegram'); equal(batches.map(b=>b.length),[10,10,3]);
  equal(batches.flat().map(f=>f.key),files.map(f=>f.key));
  for(const batch of batches) assert.ok(plan.MULTIPART_BASE+batch.reduce((s,f)=>s+f.bytes+plan.MULTIPART_ITEM,0)<=plan.REQUEST_BUDGET);
});
test('aggregate bytes split individually valid files into safe requests',()=>{
  const batches=plan.attachmentBatches([media('a','image',2_600_000),media('b','image',2_600_000)],'telegram');
  equal(batches.map(b=>b.length),[1,1]);
});
test('Messenger groups adjacent photos and sends videos individually without reordering',()=>{
  const files=[media('a'),media('b'),media('c','video'),media('d'),media('e')];
  equal(plan.attachmentBatches(files,'facebook').map(b=>b.map(f=>f.key)),[['a','b'],['c'],['d','e']]);
});
test('file validation rejects unknown sizes, oversize video, and Telegram MOV before dispatch',()=>{
  assert.match(plan.attachmentIssue(media('a','video',4_000_000),'telegram'),/too large/);
  assert.match(plan.attachmentIssue(media('a','video',0),'telegram'),/size/);
  assert.match(plan.attachmentIssue({...media('a','video'),mimeType:'video/quicktime'},'telegram'),/MP4/);
  assert.equal(plan.attachmentIssue(media('a','video'),'telegram'),null);
});
test('mixed multi-select uses installed Expo library picker with remaining queue capacity',async()=>{
  let opts,launches=0; const f=fixture({pending:[media('existing')],ImagePicker:{
    requestMediaLibraryPermissionsAsync:async()=>({granted:true}),
    launchImageLibraryAsync:async value=>{opts=value;launches++;return {canceled:false,assets:[{uri:'mock://a',type:'image',fileName:'a.jpg'},{uri:'mock://b',type:'video',fileName:'b.mp4'}]};},
  }}); let uuid=0;f.c.randomUUID=()=>String(++uuid); await f.pick();
  equal(Array.from(opts.mediaTypes),['images','videos']);assert.equal(opts.allowsMultipleSelection,true);assert.equal(opts.selectionLimit,29);
  assert.equal(opts.allowsEditing,false);assert.equal(opts.orderedSelection,true);assert.equal(launches,1);
  equal(f.state.pending.map(f=>f.kind),['image','image','video']);assert.equal(new Set(f.state.pending.map(f=>f.key)).size,3);
});
test('picker cancellation preserves draft and staged attachments',async()=>{
  const f=fixture({pending:[media('a')]}); await f.pick();assert.equal(f.state.pending.length,1);assert.equal(f.state.draft,'mock caption');
});
test('denied or rejected picker permission releases duplicate-tap lock without sending',async()=>{
  for(const result of [()=>Promise.resolve({granted:false}),()=>Promise.reject(Error('Mock unavailable'))]) {
    const f=fixture({ImagePicker:{requestMediaLibraryPermissionsAsync:result,launchImageLibraryAsync:()=>{throw Error('must not open');}}});
    await f.pick();assert.equal(f.c.mediaPickerFlight.current,false);assert.equal(f.calls.length,0);assert.ok(f.state.error);
  }
});
test('limited photo access can select only the assets the OS returns',async()=>{
  let opened=0;const f=fixture({ImagePicker:{requestMediaLibraryPermissionsAsync:async()=>({granted:false,accessPrivileges:'limited'}),launchImageLibraryAsync:async()=>{opened++;return {canceled:true};}}});
  await f.pick();assert.equal(opened,1);
});
test('same-frame repeated picker taps open only one photo library',async()=>{
  const d=deferred();let opened=0;const f=fixture({ImagePicker:{requestMediaLibraryPermissionsAsync:()=>d.promise,launchImageLibraryAsync:async()=>{opened++;return {canceled:true};}}});
  const first=f.pick();await f.pick();d.resolve({granted:true});await first;assert.equal(opened,1);
});
test('late picker results cannot attach files to a different workspace',async()=>{
  const d=deferred();const f=fixture({ImagePicker:{requestMediaLibraryPermissionsAsync:async()=>({granted:true}),launchImageLibraryAsync:()=>d.promise}});
  const first=f.pick();await new Promise(r=>setImmediate(r));f.c.ownerRef.current='other:thread';d.resolve({canceled:false,assets:[{uri:'mock://a',type:'image'}]});
  await first;assert.equal(f.state.pending.length,0);
});
test('30-item queue does not open another picker',async()=>{
  const f=fixture({pending:Array.from({length:30},(_,i)=>media(String(i)))});await f.pick();assert.match(f.state.error,/30/);
});

test('Documents and image launches share a synchronous lock, including rapid same-frame duplicate taps',async()=>{
  const wait=deferred();let documents=0,photos=0;
  const f=fixture({DocumentPicker:{getDocumentAsync:()=>{documents++;return wait.promise;}},ImagePicker:{requestMediaLibraryPermissionsAsync:async()=>{photos++;return {granted:true};},launchImageLibraryAsync:async()=>({canceled:true})}});
  const first=f.c.pickDocument();await f.c.pickDocument();await f.pick();assert.equal(documents,1);assert.equal(photos,0);
  wait.resolve({canceled:true});await first;assert.equal(f.c.mediaPickerFlight.current,false);await f.pick();assert.equal(photos,1);
});
test('photo permission flight also blocks Documents; cancellation, throw and late ownership changes release picker lock',async()=>{
  const wait=deferred();let documents=0;
  const photos=fixture({ImagePicker:{requestMediaLibraryPermissionsAsync:()=>wait.promise,launchImageLibraryAsync:async()=>({canceled:true})},DocumentPicker:{getDocumentAsync:async()=>{documents++;return {canceled:true};}}});
  const first=photos.pick();await photos.c.pickDocument();assert.equal(documents,0);wait.resolve({granted:false});await first;assert.equal(photos.c.mediaPickerFlight.current,false);
  const failed=fixture({DocumentPicker:{getDocumentAsync:async()=>{throw Error('Mock PickingInProgressException');}}});await failed.c.pickDocument();assert.equal(failed.c.mediaPickerFlight.current,false);assert.match(failed.state.error,/PickingInProgressException/);assert.equal(failed.calls.length,0);
  const late=deferred(),other=fixture({DocumentPicker:{getDocumentAsync:()=>late.promise}});const old=other.c.pickDocument();other.c.ownerRef.current='other:thread';late.resolve({canceled:false,assets:[{uri:'file:///synthetic/document',name:'mock.pdf',mimeType:'application/pdf'}]});await old;assert.equal(other.state.pending.length,0);assert.equal(other.c.mediaPickerFlight.current,false);
});
test('document picks use unique identities, respect queue capacity, and preserve a cancelled draft',async()=>{
  let uuid=0;
  const f=fixture({pending:Array.from({length:29},(_,i)=>media(String(i))),randomUUID:()=>String(++uuid),DocumentPicker:{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'mock://same',name:'a.pdf',mimeType:'application/pdf'},{uri:'mock://same',name:'a.pdf',mimeType:'application/pdf'}]})}});
  await f.c.pickDocument();assert.equal(f.state.pending.length,30);assert.match(f.state.error,/first 30/);assert.equal(new Set(f.state.pending.map(file=>file.key)).size,30);
  const cancelled=fixture({pending:[media('existing')],draft:'unsent'});await cancelled.c.pickDocument();assert.equal(cancelled.state.pending.length,1);assert.equal(cancelled.state.draft,'unsent');
});
test('actual send hands confirmed and unknown Storage file keys back to cleanup even after ownership loss',async()=>{
  for(const fail of [false,true]){
    const cleanup=[];const f=fixture({pending:[media('a')],beginStorageDraftSend:(owner,files)=>cleanup.push(['begin',owner,files.map(f=>f.key)]),finishStorageDraftSend:(owner,confirmed,uncertain)=>cleanup.push(['finish',owner,[...confirmed],[...uncertain]])});
    if(fail)f.c.uploadOne=async()=>{f.c.ownerRef.current='other:thread';throw Error('Mock lost response');};
    await f.send();assert.equal(cleanup[0][0],'begin');equal(cleanup[1],['finish','mock-storage-owner',fail?[]:['a'],fail?['a']:[]]);
  }
});
test('StickerPicker and PinnedMessageBar have distinct semantic sibling keys for both native platforms',()=>{
  const keys={};function visitKey(node){if((ts.isJsxSelfClosingElement(node)||ts.isJsxOpeningElement(node))&&['StickerPicker','PinnedMessageBar'].includes(node.tagName.getText(ast))){const key=node.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='key');keys[node.tagName.getText(ast)]=key.initializer.expression.getText(ast);}ts.forEachChild(node,visitKey);}visitKey(ast);
  for(const platform of ['facebook','telegram'])for(const id of ['9f52d0bb-7a31-480c-8145-36cdbe09a325','317cb20b-a3d1-414a-8d23-cbd4124c0c6e']){
    const context={scopeId:'f92ebb56-d907-499e-a84d-c09180b849b6',id,platform};vm.createContext(context);
    for(const [name,value]of Object.entries(keys))vm.runInContext(`globalThis.${name}=${value}`,context);
    assert.notEqual(context.StickerPicker,context.PinnedMessageBar);assert.equal(context.StickerPicker,`stickers:${context.scopeId}:${id}`);
  }
});
test('full mixed-media send delivers one caption and preserves quoted reply',async()=>{
  const f=fixture({pending:[media('a'),media('b','video')]});await f.send();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,'album');assert.equal(f.calls[0].caption,'mock caption');
  assert.equal(f.state.pending.length,0);assert.equal(f.state.draft,'');assert.equal(f.state.sending,false);
});
test('same-frame repeated send taps invoke one transport even during preparation',async()=>{
  const d=deferred();const f=fixture({pending:[media('a')],sendable:()=>d.promise});const first=f.send();await f.send();
  d.resolve(media('a'));await first;assert.equal(f.calls.length,1);assert.equal(f.c.sendFlight.current,false);
});
test('preflight size error preserves all queued inputs and never dispatches',async()=>{
  const f=fixture({pending:[media('a'),media('b','video',5_000_000)]});await f.send();
  assert.equal(f.calls.length,0);assert.equal(f.state.pending.length,2);assert.equal(f.state.draft,'mock caption');assert.match(f.state.pending[1].error,/too large/);
});
test('later batch failure retains unsent files and never restores confirmed first caption',async()=>{
  const files=[media('a','image',2_600_000),media('b','video',2_600_000),media('c','image',2_600_000)];
  const f=fixture({pending:files});let calls=0;f.c.uploadOne=async()=>{if(++calls===2)throw Error('Mock failed response');};
  await f.send();assert.equal(calls,2);equal(f.state.pending.map(f=>f.key),['b','c']);assert.equal(f.state.draft,'');
  assert.equal(f.state.pending[0].deliveryUnknown,true);assert.equal(f.state.pending[1].deliveryUnknown,false);
  f.rerender();await f.send();assert.equal(calls,2);assert.match(f.state.error,/may have reached/);
});
test('failed first caption remains preserved and blocked against blind duplicate text retry',async()=>{
  const f=fixture({pending:[media('a')],uploadOne:async()=>{throw Error('Mock accepted but timed out');}});await f.send();
  assert.equal(f.state.draft,'mock caption');assert.equal(f.state.draftSendUnknown,true);assert.equal(f.state.pending[0].deliveryUnknown,true);
});
test('refresh failure after confirmed media delivery cannot restore draft or attachments',async()=>{
  const f=fixture({pending:[media('a')],load:async()=>{throw Error('Mock refresh unavailable');}});await f.send();
  await new Promise(r=>setImmediate(r));assert.equal(f.state.pending.length,0);assert.equal(f.state.draft,'');assert.equal(f.state.error,'');
});
test('Telegram text-only send is dispatched rather than swallowed as an empty album caption',async()=>{
  const f=fixture({pending:[]});await f.send();assert.equal(f.calls.length,1);assert.equal(f.calls[0].kind,'text');
});
test('file documents retain their individual upload path',async()=>{
  const f=fixture({pending:[{...media('doc'),kind:'file',mimeType:'application/pdf'}]});await f.send();
  assert.equal(f.calls[0].kind,'one');assert.equal(f.calls[0].files[0].kind,'file');assert.equal(f.calls[1].kind,'text');
});
test('account switch during preparation stops dispatch',async()=>{
  const d=deferred();const f=fixture({pending:[media('a')],sendable:()=>d.promise});const first=f.send();
  f.c.ownerRef.current='other:thread';d.resolve(media('a'));await first;assert.equal(f.calls.length,0);
});
test('account switch after first batch stops remaining media dispatches',async()=>{
  const f=fixture({pending:[media('a','image',2_600_000),media('b','video',2_600_000)]});let uploads=0;
  f.c.uploadOne=async()=>{uploads++;f.c.ownerRef.current='other:thread';};await f.send();assert.equal(uploads,1);
});

test('actual composer exposes Image/Videos, keeps Documents, and disables an uncertain send visibly',()=>{
  let mediaPicks=0,documents=0;
  const react={useState:initial=>[initial,()=>{}],useRef:initial=>({current:initial})};
  const {Composer}=loader({react,'@expo/vector-icons':{Ionicons:'Icon',MaterialCommunityIcons:'Icon'},
    'expo-audio':{RecordingPresets:{HIGH_QUALITY:{}},useAudioRecorder:()=>({}),useAudioRecorderState:()=>({isRecording:false,durationMillis:0})},
    'react-native':Object.assign(Object.fromEntries(['ActivityIndicator','Image','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n])),{PanResponder:{create:()=>({panHandlers:{}})}}),
    './ui':{Sheet:'Sheet',colors:{},styles:{}},
  })('mobile/components/composer.tsx');
  const tree=Composer({draft:'saved text',pending:[{...media('a'),error:'Mock delivery unknown'}],sending:false,bottomInset:0,
    onPickMedia:()=>mediaPicks++,onPickFile:()=>documents++,fromQuickReply:false,sendBlockedReason:'Mock delivery is unresolved'});
  function find(pred,node=tree){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const result=find(pred,child);if(result)return result;}return null;}if(pred(node))return node;return node.props?.children===undefined?null:find(pred,node.props.children);}
  find(n=>n.props?.label==='Image/Videos').props.onPress();find(n=>n.props?.label==='Documents').props.onPress();
  assert.equal(mediaPicks,1);assert.equal(documents,1);assert.equal(find(n=>n.props?.label==='File'),null);
  assert.equal(find(n=>n.props?.accessibilityLabel==='Send').props.disabled,true);
  assert.ok(find(n=>n.props?.accessibilityRole==='alert'));
});

test('actual upload helpers route prepared mixed media with no second resize and preserve reply/caption fields',async()=>{
  const calls=[]; const c={platform:'telegram',scopeId:'mock-workspace',id:'mock-thread',recipientId:'mock-recipient',
    uploadNativeFile:async(...args)=>calls.push(args),uploadMany:async(...args)=>calls.push(args),
  };
  vm.createContext(c);vm.runInContext(ts.transpileModule(methods.uploadOne+'\n'+methods.uploadAlbum+'\nglobalThis.one=uploadOne;globalThis.album=uploadAlbum;',{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},
  }).outputText,c);
  await c.album([media('a'),media('b','video')],'caption','quote');
  assert.equal(calls[0][0],'/api/telegram/send-photo');equal(calls[0][2].map(f=>f.fieldName),['files','files']);
  assert.equal(calls[0][3].caption,'caption');assert.equal(calls[0][3].replyToMessageId,'quote');
  c.platform='facebook';await c.album([media('a'),media('b')],'','quote');
  assert.equal(calls[1][0],'/api/facebook/send-attachment');equal(calls[1][2].map(f=>f.fieldName),['file','additionalFiles']);
  assert.equal(calls[1][3].kind,'image');await c.one(media('c','video'));
  assert.equal(calls[2][3].kind,'video');
});

test('small HEIC conversion is forced and keeps its JPEG even when the converted size grows',async()=>{
  const calls=[];
  const {shrinkImage}=loader({
    'expo-file-system':{File:class{constructor(uri){this.exists=true;this.size=uri==='mock://original'?500_000:600_000;}}},
    'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},ImageManipulator:{manipulate:()=>({resize:()=>calls.push('resize'),renderAsync:async()=>({saveAsync:async()=>({uri:'mock://jpeg'})})})}},
  })('mobile/lib/shrink.ts');
  assert.equal((await shrinkImage('mock://original',true)).mimeType,'image/jpeg');assert.equal(calls.length,1);
  assert.equal((await shrinkImage('mock://original')).shrank,false);assert.equal(calls.length,1);
});
