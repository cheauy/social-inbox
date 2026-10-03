// Real React 19 commits with source-extracted Inbox state, restoration effect,
// readiness expression and Send handler. External APIs are response stubs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),ts=require('typescript');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');
const ast=ts.createSourceFile('inbox.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const wanted=new Set(['composerState','reply','setReplyState','composerSelectionEpochRef','composerRenderEpoch','retireComposerSubmissionScope','accessibleBusinessIdsRef','replyingToFacebookMessageId','composerDraftRef','setReply','setReplyingToFacebookMessageId','editingTelegramMessageId','conversationTextDraftsRef','composerConversationKeyRef','telegramEditTextDraftRef']);
const declarations=[],seen=new Set(),functions=[];let effect,displayed;
function visit(n){
 if(ts.isVariableDeclaration(n)){
  const bound=ts.isArrayBindingPattern(n.name)?n.name.elements.map(x=>x.name?.getText(ast)): [n.name.getText(ast)];
  if(bound.some(x=>wanted.has(x))){const statement=n.parent.parent;if(!seen.has(statement.pos)){seen.add(statement.pos);declarations.push(statement.getText(ast));}}
 }
 if(ts.isFunctionDeclaration(n)&&['captureComposerSubmissionOwner','isComposerSubmissionCurrent','handleComposerReplyChange','handleSendMessage'].includes(n.name?.text))functions.push(n.getText(ast));
 if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('const drafts = conversationTextDraftsRef.current'))effect=n.parent.getText(ast);
 if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='reply'&&n.initializer?.expression?.getText(ast).includes('composerReady'))displayed=n.initializer.expression.getText(ast);
 ts.forEachChild(n,visit);
}visit(ast);
assert.ok(effect&&displayed);assert.equal(functions.length,4);

async function setup(){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'}),originals={};
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){originals[key]=global[key];global[key]=value;}
 const records=[],calls=[],businesses=['b1','b2'],rows=[{id:'A',business_id:'b1',contact:{platform_user_id:'customer-A'}},{id:'B',business_id:'b1',contact:{platform_user_id:'customer-B'}}];
 let api;
 const scope={React,...React,console,Response,crypto:{randomUUID:()=> 'fixture'},accessibleBusinessIds:businesses,MESSAGE_CACHE_MAX_CONVERSATIONS:25,
  setReplyingToTelegramMessageId(){},setReplyingToCommentId(){},setSendError(){},setSending(){},replyingToCommentId:null,replyingToTelegramMessageId:null,
  liveMessagesRef:{current:[]},pendingSendsRef:{current:{}},textSubmissionsRef:{current:new Set()},latestTextSubmissionRef:{current:0},
  resolveConversationPlatform:async()=> 'facebook',resolvePhotoReplyTarget:()=>null,
  createOptimisticMessage:({tempId,conversationId,message})=>({id:tempId,conversation_id:conversationId,message_text:message,created_at:'fixture'}),
  setLiveMessages(){},updateConversationPreviewOptimistically(){},performOptimisticSend:async p=>{calls.push(p.requestBody);return true},
  probe:a=>{api=a;records.push({key:a.key,owner:a.owner,text:a.text,ready:a.ready,send:a.send,change:a.change});},
 };
 vm.createContext(scope);
 const code=`function Fixture({selected, rows}) {
 const resolvedActiveConversationId=selected;
 const activeConversation=rows.find(r=>r.id===selected)??null;
 const activeConversationRef=useRef(activeConversation);activeConversationRef.current=activeConversation;
 const liveConversationsRef=useRef(rows);liveConversationsRef.current=rows;
 const desiredConversationIdRef=useRef(selected);
 ${declarations.join('\n')}
 accessibleBusinessIdsRef.current=accessibleBusinessIds;
 ${effect}
 ${functions.join('\n')}
 const composerReady=Boolean(captureComposerSubmissionOwner());
 const displayed=${displayed};
 useLayoutEffect(()=>probe({key:activeConversation?activeConversation.business_id+':'+activeConversation.id:null,owner:composerState.conversationKey,text:displayed,ready:composerReady,
  send:()=>handleSendMessage({preventDefault(){}}),change:handleComposerReplyChange,retire:retireComposerSubmissionScope,desired:desiredConversationIdRef,
  raw:setReply,epoch:composerSelectionEpochRef,edit:setEditingTelegramMessageId}));
 return React.createElement('button',{disabled:!composerReady},displayed);
 }globalThis.Fixture=Fixture;`;
 vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const root=createRoot(dom.window.document.getElementById('root'));
 const render=async(selected='A',nextRows=rows)=>{await act(async()=>root.render(React.createElement(scope.Fixture,{selected,rows:nextRows})));};
 await render();
 return {dom,rows,scope,records,calls,get api(){return api},render,
  async select(next,nextRows=rows){await act(async()=>{api.retire();api.desired.current=next;root.render(React.createElement(scope.Fixture,{selected:next,rows:nextRows}));});},
  async cleanup(){await act(async()=>root.unmount());dom.window.close();for(const [k,v]of Object.entries(originals)){if(v===undefined)delete global[k];else global[k]=v;}}
 };
}
test('real React first B commit hides A draft, disables Send, and its retained handler cannot submit after restoration',async()=>{
 const f=await setup();try{
  await act(async()=>f.api.change('A draft'));
  await f.select('B');
  const transition=f.records.find(r=>r.key==='b1:B'&&r.owner==='b1:A');assert.ok(transition,'observe B commit before passive draft restoration');
  assert.equal(transition.ready,false);assert.equal(transition.text,'');
  await act(async()=>transition.send());assert.equal(f.calls.length,0);
  assert.equal(f.api.owner,'b1:B');assert.equal(f.dom.window.document.querySelector('button').disabled,false);
  await act(async()=>f.api.change('B draft'));await act(async()=>f.api.send());assert.equal(f.calls.length,1);assert.equal(f.calls[0].conversationId,'B');assert.equal(f.calls[0].message,'B draft');
  await f.select('A');assert.equal(f.api.text,'A draft');
 }finally{await f.cleanup()}
});
test('real React batched A -> B -> A retires old await/callback and still enables the current composer',async()=>{
 const f=await setup();try{
  await act(async()=>f.api.change('original A draft'));
  const old=f.api;let resolvePlatform;f.scope.resolveConversationPlatform=()=>new Promise(r=>resolvePlatform=r);
  const pending=old.send();await act(async()=>{old.retire();old.desired.current='B';old.retire();old.desired.current='A';});
  await act(async()=>old.change('stale quick reply'));assert.equal(f.api.text,'original A draft');
  resolvePlatform('facebook');await act(async()=>pending);assert.equal(f.calls.length,0);
  assert.equal(f.api.ready,true);assert.equal(f.dom.window.document.querySelector('button').disabled,false);
  f.scope.resolveConversationPlatform=async()=> 'facebook';await act(async()=>f.api.send());assert.equal(f.calls.length,1);
 }finally{await f.cleanup()}
});
test('real React same-ID business transition clears the previous business draft and rejects its old handler',async()=>{
 const f=await setup();try{
  await act(async()=>f.api.change('business one text'));const old=f.api;
  const rows=f.rows.map(r=>r.id==='A'?{...r,business_id:'b2'}:r);await f.render('A',rows);
  assert.equal(f.api.owner,'b2:A');assert.equal(f.api.text,'');await act(async()=>old.send());assert.equal(f.calls.length,0);
 }finally{await f.cleanup()}
});
