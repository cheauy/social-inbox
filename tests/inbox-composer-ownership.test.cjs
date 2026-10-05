const test=require('node:test'), assert=require('node:assert/strict'), fs=require('fs'), vm=require('vm'), ts=require('typescript');
const {loader}=require('./tenh-seven/harness.cjs');
const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');
const ast=ts.createSourceFile('inbox.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=new Set(['captureComposerSubmissionOwner','isComposerSubmissionCurrent','handleComposerReplyChange','handleSendMessage','handleSendAttachments','handleSendSticker']);
const functions=[];function visit(n){if(ts.isFunctionDeclaration(n)&&names.has(n.name?.text))functions.push(n.getText(ast));ts.forEachChild(n,visit)}visit(ast);
function fixture({active='A',owner='b1:A',platform='facebook',editing=null}={}) {
 const conversation={id:active,business_id:'b1',contact:{platform_user_id:'customer'},social_account:{platform}}, calls=[], state={reply:'A draft',messages:[],error:null,resolutions:0};
 const c={...loader()('lib/inbox/message-actions.ts'),console,Response,URL:{createObjectURL:()=> 'blob:fixture'},crypto:{randomUUID:()=> 'fixture'},
  activeConversation:conversation,activeConversationRef:{current:conversation},desiredConversationIdRef:{current:active},accessibleBusinessIdsRef:{current:['b1','b2']},
  composerState:{reply:state.reply,conversationKey:owner},composerConversationKeyRef:{current:owner},composerSelectionEpochRef:{current:0},composerRenderEpoch:0,
  reply:state.reply,composerDraftRef:{current:{reply:state.reply,quote:null,revision:0}},replyingToCommentId:null,replyingToTelegramMessageId:null,replyingToFacebookMessageId:null,editingTelegramMessageId:editing,
  liveMessagesRef:{current:[]},liveMessages:[],textSubmissionsRef:{current:new Set()},latestTextSubmissionRef:{current:0},pendingSendsRef:{current:{}},pendingAttachmentSendsRef:{current:{}},
  resolveConversationPlatform:async()=>{state.resolutions++;return platform},parseTenhLocationMessage:()=>null,isCommentReplyBlocked:()=>false,isMetaSticker:s=>s.kind==='meta',
  setSendError:v=>state.error=v,setSending(){},setEditingTelegramMessageId(){},setReplyingToCommentId(){},setReplyingToTelegramMessageId(){},setReplyingToFacebookMessageId(){},
  setReply:v=>{state.reply=typeof v==='function'?v(state.reply):v;c.composerDraftRef.current.reply=state.reply},setLiveMessages:v=>state.messages=v(state.messages),updateConversationPreviewOptimistically(){},
  createOptimisticMessage:({tempId,conversationId,message})=>({id:tempId,conversation_id:conversationId,message_text:message,created_at:'fixture'}),
  createOptimisticAttachmentMessage:({tempId,conversationId})=>({id:tempId,conversation_id:conversationId,created_at:'fixture'}),getAttachmentMessageText:()=> 'Sent image',
  performOptimisticSend:async p=>{calls.push({endpoint:p.endpoint,body:p.requestBody});return true},performOptimisticAttachmentSend:async p=>{calls.push({endpoint:p.endpoint,body:{conversationId:p.conversationId}});return true},
  fetch:async(url,init)=>{calls.push({endpoint:url,body:JSON.parse(init.body)});return Response.json({success:false,error:'fixture rejection'},{status:400})},
 };
 vm.createContext(c);vm.runInContext(ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 return {c,state,calls,send:captured=>c.handleSendMessage({preventDefault(){}},captured),media:()=>c.handleSendAttachments([{id:'photo',kind:'image',file:{name:'photo.jpg',type:'image/jpeg',size:10}}])};
}
test('actual Send blocks new B handler with A state owner, including Telegram Edit and public comment text',async()=>{
 for(const mode of ['facebook','telegram','edit','comment']){
  const f=fixture({active:'B',platform:mode==='edit'?'telegram':mode,editing:mode==='edit'?'edited-message':null});
  if(mode==='comment')f.c.replyingToCommentId='comment-A';
  await f.send();assert.equal(f.calls.length,0,mode);assert.equal(f.state.resolutions,0,mode);assert.equal(f.state.reply,'A draft');
 }
});
test('restoring destination owner during channel await cannot authorize text captured from a different owner',async()=>{
 const f=fixture({active:'B'});f.c.resolveConversationPlatform=async()=>{f.c.composerConversationKeyRef.current='b1:B';f.c.setReply('B draft');return 'facebook'};
 await f.send();assert.equal(f.calls.length,0);assert.equal(f.state.resolutions,0);
});
test('actual Send rejects late platform result after A -> B -> A, even when ID and owner match again',async()=>{
 const f=fixture();f.c.resolveConversationPlatform=async()=>{f.c.composerSelectionEpochRef.current+=2;return 'facebook'};
 await f.send();assert.equal(f.calls.length,0);assert.equal(f.state.reply,'A draft');
});
test('same conversation ID in another business cannot dispatch the previous business draft',async()=>{
 const f=fixture();f.c.activeConversation.business_id='b2';await f.send();assert.equal(f.calls.length,0);
 const g=fixture();g.c.resolveConversationPlatform=async()=>{g.c.activeConversationRef.current={...g.c.activeConversation,business_id:'b2'};return 'facebook'};
 await g.send();assert.equal(g.calls.length,0);
});
test('captured attachment follow-up text remains allowed in its owner and is rejected after ABA retirement',async()=>{
 const f=fixture();f.c.reply='';f.c.setReply('');await f.send('Captured caption overflow');assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.message,'Captured caption overflow');
 const g=fixture();g.c.composerSelectionEpochRef.current=2;await g.send('old caption');assert.equal(g.calls.length,0);
});
test('revoked business access blocks entry and a pending channel result',async()=>{
 const f=fixture();f.c.accessibleBusinessIdsRef.current=[];await f.send();assert.equal(f.calls.length,0);assert.equal(f.state.resolutions,0);
 const g=fixture();g.c.resolveConversationPlatform=async()=>{g.c.accessibleBusinessIdsRef.current=[];return 'facebook'};await g.send();assert.equal(g.calls.length,0);
});
test('actual media handler rejects owner mismatch before platform work and late selection before dispatch',async()=>{
 const f=fixture({active:'B'});assert.equal(await f.media(),false);assert.equal(f.calls.length,0);assert.equal(f.state.resolutions,0);
 const g=fixture();g.c.resolveConversationPlatform=async()=>{g.c.composerSelectionEpochRef.current+=2;return 'facebook'};
 assert.equal(await g.media(),false);assert.equal(g.calls.length,0);
});
test('actual quick-reply text callback rejects retired render and preserves current conversation work',()=>{
 const f=fixture();assert.equal(typeof f.c.handleComposerReplyChange,'function');f.c.composerSelectionEpochRef.current=2;f.c.setReply('new A work');f.c.handleComposerReplyChange('retired quick reply');assert.equal(f.state.reply,'new A work');
 const g=fixture();g.c.handleComposerReplyChange('current quick reply');assert.equal(g.state.reply,'current quick reply');
});
test('current owner retains ordinary text and media sends',async()=>{
 const f=fixture();await f.send();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.conversationId,'A');assert.equal(f.calls[0].body.message,'A draft');
 const g=fixture();assert.equal(await g.media(),true);assert.equal(g.calls.length,1);assert.equal(g.calls[0].body.conversationId,'A');
});
test('current Telegram text/Edit and public comment route bodies are preserved',async()=>{
 const f=fixture({platform:'telegram'});await f.send();assert.equal(f.calls.length,1);assert.equal(f.calls[0].endpoint,'/api/telegram/send');assert.equal(f.calls[0].body.message,'A draft');
 const g=fixture({platform:'telegram',editing:'sent-message'});await g.send();assert.equal(g.calls.length,1);assert.equal(g.calls[0].endpoint,'/api/telegram/messages/sent-message');assert.equal(g.calls[0].body.text,'A draft');
 const h=fixture();h.c.replyingToCommentId='comment-A';await h.send();assert.equal(h.calls.length,1);assert.equal(h.calls[0].endpoint,'/api/facebook/comments/reply');assert.equal(h.calls[0].body.commentId,'comment-A');
});
test('late rejected platform lookup cannot replace the current owner error state',async()=>{
 for(const kind of ['text','media']){
  const f=fixture();f.c.resolveConversationPlatform=async()=>{f.c.composerSelectionEpochRef.current++;throw Error('retired lookup')};
  if(kind==='text')await f.send();else await f.media();assert.equal(f.calls.length,0);assert.equal(f.state.error,null,kind);
 }
});
test('sticker handlers respect current owner and reject retired callbacks',async()=>{
 const f=fixture({active:'B',platform:'telegram'});assert.equal(await f.c.handleSendSticker({kind:'telegram'}),false);assert.equal(f.calls.length,0);
 const g=fixture({platform:'telegram'});g.c.composerSelectionEpochRef.current+=2;assert.equal(await g.c.handleSendSticker({kind:'telegram'}),false);assert.equal(g.calls.length,0);
 const h=fixture({platform:'telegram'});assert.equal(await h.c.handleSendSticker({kind:'telegram',stickerId:'sticker',setName:'pack'}),true);assert.equal(h.calls.length,1);assert.equal(h.calls[0].endpoint,'/api/telegram/send-sticker');
});
