const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
const load=loader({react:{}}),{stableConversationOrder}=load('lib/inbox/stable-conversation-order.ts');
const {retainKnownConversationRows}=load('lib/inbox/retain-known-conversation-rows.ts');
const {captureConversationListAnchor,restoreConversationListAnchor}=load('lib/inbox/use-conversation-list-anchor.ts');
const row=(id,at,extra={})=>({id,business_id:'b1',last_message_at:at,status:'open',unread_count:1,is_pinned:false,social_account:{id:'page1'},...extra});
test('incoming and teammate latest activity move first, pins stay above, duplicates and equal times stay stable',()=>{
 const old=[row('pinned','2026-09-01',{is_pinned:true}),row('first','2026-10-01T10:00:00Z'),row('incoming','2026-10-01T09:00:00Z')];
 const latest=stableConversationOrder(old,[old[0],old[1],{...old[2],last_message_at:'2026-10-01T11:00:00Z'}]);assert.deepEqual(Array.from(latest,r=>r.id),['pinned','incoming','first']);assert.deepEqual(Array.from(stableConversationOrder(latest,[...latest,latest[1]]),r=>r.id),['pinned','incoming','first']);
 const next=stableConversationOrder(latest,[...latest,row('new','2026-10-01T12:00:00Z')]);assert.deepEqual(Array.from(next,r=>r.id),['pinned','new','incoming','first']);
});
test('legacy new customer remains in All after Unread and older filtered server props',()=>{
 const previous=row('old','2026-10-01T10:00:00Z',{unread_count:0}),customer=row('new','2026-10-01T11:00:00Z');
 const unread=retainKnownConversationRows([previous,customer],[customer],['b1'],'','');
 const all=stableConversationOrder(unread,retainKnownConversationRows(unread,[previous],['b1'],'',''));
 assert.deepEqual(Array.from(all,r=>r.id),['new','old']);assert.deepEqual(Array.from(all.filter(r=>r.unread_count>0),r=>r.id),['new']);
});
test('retained rows cannot cross revoked workspace or selected Page boundaries',()=>{
 const rows=[row('one','2026-10-01'),row('other','2026-10-01',{business_id:'b2'}),row('page2','2026-10-01',{social_account:{id:'page2'}})];
 assert.deepEqual(Array.from(retainKnownConversationRows(rows,[],['b1'],'page1','b1'),r=>r.id),['one']);assert.equal(retainKnownConversationRows(rows,rows,[],'','').length,0);
});
function viewport(){let order=['a','b','c','d','e'],scroll=150;const container={get scrollTop(){return scroll},set scrollTop(n){scroll=n},getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>order.map(id=>({dataset:{conversationListId:id},getBoundingClientRect:()=>({top:order.indexOf(id)*100-scroll,bottom:(order.indexOf(id)+1)*100-scroll})}))};return {container,reorder:next=>order=next};}
test('list activity reordering keeps visible anchor and its exact offset without scrolling a message pane',()=>{
 const v=viewport(),anchor=captureConversationListAnchor(v.container);assert.equal(anchor.key,'b');assert.equal(anchor.offset,-50);
 const messagePane={scrollTop:987};v.reorder(['e','a','b','c','d']);restoreConversationListAnchor(v.container,anchor);assert.equal(v.container.scrollTop,250);assert.equal(captureConversationListAnchor(v.container).key,'b');assert.equal(messagePane.scrollTop,987);
});
test('at top no scrolling is forced; missing anchor preserves numeric viewport',()=>{const v=viewport();v.container.scrollTop=0;assert.equal(captureConversationListAnchor(v.container),null);restoreConversationListAnchor(v.container,null);assert.equal(v.container.scrollTop,0);v.container.scrollTop=150;const anchor=captureConversationListAnchor(v.container);v.reorder(['a','c','d','e']);restoreConversationListAnchor(v.container,anchor);assert.equal(v.container.scrollTop,150);});

test('actual message-pane effects open at latest, preserve history on arrivals, and ignore duplicate delivery updates',()=>{
 const fs=require('fs'),ts=require('typescript'),vm=require('vm'),source=fs.readFileSync('components/inbox/message-panel.tsx','utf8');
 const ast=ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let opening,arrival;
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'){const body=n.arguments[0]?.getText(ast);if(body?.includes('const followUpTimers'))opening=body;if(body?.includes('First committed message page'))arrival=body;}ts.forEachChild(n,visit);}visit(ast);assert.ok(opening&&arrival);
 const list={scrollTop:345},pane={scrollTop:0},calls=[];
 const context={activeConversation:{id:'c1'},loadingConversationMessages:false,initialScrollDoneRef:{current:false},lastMessageIdRef:{current:null},previousMessageCountRef:{current:0},userNearBottomRef:{current:true},messages:[{id:'m1',direction:'incoming'}],messagesContainerRef:{current:pane},scrollToNewest:mode=>{calls.push(mode);pane.scrollTop=1000;},setNewMessageCount:fn=>context.count=fn(context.count||0),setShowScrollToLatest:value=>context.indicator=value,window:{requestAnimationFrame:fn=>fn(),setTimeout:()=>1,clearTimeout(){}},count:0};
 vm.createContext(context);const run=body=>vm.runInContext(ts.transpileModule(`(${body})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 run(opening);assert.equal(pane.scrollTop,1000);assert.equal(list.scrollTop,345);run(arrival);context.userNearBottomRef.current=false;pane.scrollTop=200;context.messages.push({id:'m2',direction:'incoming'});run(arrival);assert.equal(pane.scrollTop,200);assert.equal(context.count,1);assert.equal(context.indicator,true);const count=calls.length;run(arrival);assert.equal(calls.length,count);assert.equal(context.count,1);
 context.userNearBottomRef.current=true;context.messages.push({id:'m3',direction:'outgoing'});run(arrival);assert.equal(calls.at(-1),'smooth');assert.equal(list.scrollTop,345);
});
