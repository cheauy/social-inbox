const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const box=ts.createSourceFile('reply.tsx',fs.readFileSync('components/inbox/reply-box.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let load,submit,cleanup,disabled;function visit(n){
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='loadSavedReplyAttachments')load=n.getText(box);
 if(ts.isFunctionDeclaration(n)&&n.name?.text==='handleSubmit')submit=n.getText(box);
 if(ts.isCallExpression(n)&&n.expression.getText(box)==='useEffect'&&n.arguments[0]?.getText(box).includes('composerMountedRef.current = true'))cleanup=n.parent.getText(box);
 if(ts.isVariableDeclaration(n)&&n.name.getText(box)==='isComposerDisabled')disabled=n.initializer.getText(box);
 ts.forEachChild(n,visit);
}visit(box);assert.ok(load&&submit&&cleanup&&disabled);
test('actual ReplyBox text submit is blocked while the owner is not ready',()=>{
 for(const ready of [false,true]){
  let calls=0,prevented=0;
  const c={composerReady:ready,isComposerBlocked:false,stickerFlight:{current:false},nativeSticker:null,reply:'draft',attachments:[],loadingQuickReplyMedia:false,online:true,sendMode:'now',pendingPostSendStatusRef:{current:null},onSubmit:()=>calls++};
  vm.createContext(c);vm.runInContext(ts.transpileModule(`const isComposerDisabled=${disabled};${submit}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
  c.handleSubmit({preventDefault(){prevented++}});assert.equal(calls,ready?1:0);assert.equal(prevented,ready?0:1);
 }
});
test('real React keyed composer retirement discards late quick-reply media and revokes its generated URL',async()=>{
 const panel=ts.createSourceFile('panel.tsx',fs.readFileSync('components/inbox/message-panel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let key;function find(n){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(panel)==='ReplyBox')key=n.attributes.properties.find(p=>p.name?.getText(panel)==='key')?.initializer?.expression?.getText(panel);ts.forEachChild(n,find)}find(panel);assert.ok(key,'actual ReplyBox key must exist');
 const dom=new JSDOM('<div id="root"></div>'),originals={};for(const [k,v]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){originals[k]=global[k];global[k]=v;}
 const released=[],added=[],alerts=[];let resolveFile,loaderA;
 const c={React,...React,composerReady:true,File,URL:{createObjectURL:()=> 'blob:late-A',revokeObjectURL:u=>released.push(u)},createId:()=> 'attachment',
  fetch:()=>new Promise(r=>resolveFile=r),window:{alert:m=>alerts.push(m)},setLoadingQuickReplyMedia(){},setAttachments:fn=>added.push(fn([])),expose:fn=>{loaderA=fn;}};
 vm.createContext(c);vm.runInContext(ts.transpileModule(`function Media(){const composerMountedRef=useRef(true);const attachmentsRef=useRef([]);${cleanup}${load}useLayoutEffect(()=>expose(loadSavedReplyAttachments));return null;}globalThis.Media=Media;globalThis.keyFor=activeConversation=>${key};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 const root=createRoot(dom.window.document.getElementById('root'));
 try{
  const render=async business=>act(async()=>root.render(React.createElement(c.Media,{key:c.keyFor({id:'same-id',business_id:business})})));
  await render('b1');const oldLoad=loaderA;const pending=oldLoad([{url:'https://fixture.invalid/image',path:'fake',name:'image.jpg',mimeType:'image/jpeg',kind:'image'}]);
  await render('b2');assert.notEqual(c.keyFor({id:'same-id',business_id:'b1'}),c.keyFor({id:'same-id',business_id:'b2'}));
  resolveFile(new Response(new Blob(['fixture bytes'],{type:'image/jpeg'})));await act(async()=>pending);
  assert.deepEqual(added,[]);assert.deepEqual(alerts,[]);assert.deepEqual(released,['blob:late-A']);
  await oldLoad([{url:'https://fixture.invalid/unused'}]);assert.deepEqual(added,[]);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const[k,v]of Object.entries(originals)){if(v===undefined)delete global[k];else global[k]=v;}}
});
