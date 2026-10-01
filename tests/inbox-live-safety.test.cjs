const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('typescript');const {loader}=require('./tenh-seven/harness.cjs');
const {matchesOptimisticMessage}=loader()('lib/inbox/optimistic-message-match.ts');
const candidate={id:'optimistic:one',conversation_id:'c1',platform_message_id:'optimistic:one',direction:'outgoing',message_text:'Hello'};
test('identical teammate text/time cannot acknowledge a local pending send',()=>{
 const teammate={...candidate,id:'stored',platform_message_id:'mid',sent_by_member_id:'teammate'};assert.equal(matchesOptimisticMessage(candidate,teammate),false);
 assert.equal(matchesOptimisticMessage({...candidate,platform_message_id:'mid'},teammate),true);
 assert.equal(matchesOptimisticMessage(candidate,{...teammate,raw_payload:{tenh_client_request_id:candidate.id}}),true);
 assert.equal(matchesOptimisticMessage(candidate,{...teammate,raw_payload:{message:{metadata:candidate.id}}}),true);
 assert.equal(matchesOptimisticMessage(candidate,{...teammate,conversation_id:'other',raw_payload:{tenh_client_request_id:candidate.id}}),false);
});
test('hidden automatic read returns before touching state or issuing a request',async()=>{
 const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8'),parsed=ts.createSourceFile('inbox.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='markConversationReadRealtime')declaration=node;ts.forEachChild(node,visit);}visit(parsed);assert.ok(declaration,'read handler exists');
 const code=ts.transpileModule(declaration.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const context={document:{visibilityState:'hidden',hasFocus:()=>false}};vm.createContext(context);vm.runInContext(code,context);await context.markConversationReadRealtime('c1');
 context.document.visibilityState='visible';await context.markConversationReadRealtime('c1');
 // No refs/fetch exist in this context: touching either would throw.
});
test('selected hidden thread cannot optimistically clear incoming or authoritative unread counts',()=>{
 const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');
 for(const name of ['isActiveIncoming','isActiveConversation'])assert.match(source,new RegExp(`const ${name} =\\s*document.visibilityState === "visible" &&`));
 assert.match(source,/realtimeHealthyRef.current \? 60_000 : 5_000/);assert.match(source,/realtimeHealthyRef.current \? 60_000 : 3_000/);
});

test('view switches reevaluate live rows while preserving comment, pin and Smart View rules',()=>{
 const source=fs.readFileSync('components/inbox/conversation-list.tsx','utf8'),ast=ts.createSourceFile('list.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=new Set(['normalizeSavedViewFilters','parseSmartViewTagReference','getConversationChannel','isConversationPinned','getSavedViewFromKey','matchesSavedView','matchesView']);
 const extracted=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(ast)).join('\n');assert.equal(ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).length,names.size);
 const context={SMART_VIEW_TAG_SEPARATOR:'::'};vm.createContext(context);vm.runInContext(ts.transpileModule(extracted,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const row={id:'c1',business_id:'b1',source_type:'comment',unread_count:0,is_pinned:true,status:'open',last_message_text:'Old',contact:{tags:[{id:'vip',name:'VIP'}]}};
 const savedViews=[{id:'vip',filters:{channel:'comment',unreadOnly:true,pinnedOnly:true,tagIds:['b1::vip']}}];
 const match=(key,conversation=row)=>context.matchesView({key,conversation,savedViews,memberId:null});
 assert.equal(match('all'),true);assert.equal(match('unread'),false);assert.equal(match('comment'),true);assert.equal(match('pinned'),true);assert.equal(match('saved:vip'),false);
 const incoming={...row,unread_count:1,last_message_text:'Customer message'};
 for(const key of ['all','unread','comment','pinned','saved:vip'])assert.equal(match(key,incoming),true,key);
 const teammate={...incoming,last_message_text:'Teammate sent',unread_count:1};for(const key of ['all','unread','comment','pinned','saved:vip'])assert.equal(match(key,teammate),true,key);
 assert.equal(match('pinned',{...teammate,is_pinned:false}),false);assert.equal(match('saved:vip',{...teammate,is_pinned:false}),false);assert.equal(match('comment',{...teammate,source_type:'messenger'}),false);
});

test('duplicates preserve one stored bubble while newer activity moves its conversation first',()=>{
 const {normalizeMessages}=loader()('lib/inbox/normalize-messages.ts');const {stableConversationOrder}=loader()('lib/inbox/stable-conversation-order.ts');
 const row={id:'stored',conversation_id:'c1',platform_message_id:'mid',message_text:'Newest',direction:'outgoing',created_at:'2026-09-30T12:00:00Z',delivery_status:'seen'};
 const result=normalizeMessages([row,{...row,delivery_status:'sent'},{...row,id:'optimistic:one',__optimistic_status:'sent'}],[row]);assert.equal(result.length,1);assert.equal(result[0].id,'stored');assert.equal(result[0].delivery_status,'seen');
 const before=[{id:'c1',is_pinned:false,last_message_at:'2026-09-30T12:00:00Z'},{id:'c2',is_pinned:false,last_message_at:'2026-09-30T11:00:00Z'}];
 const next=stableConversationOrder(before,[before[0],{...before[1],last_message_at:'2026-09-30T13:00:00Z'}]);assert.deepEqual(Array.from(next,r=>r.id),['c2','c1']);
});
