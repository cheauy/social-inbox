const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader,hooks,tick,uuid}=require('./inbox-recovery-harness.cjs');
const ts=require('typescript'),vm=require('node:vm');
const contract=loader()('lib/inbox/conversation-page-contract.ts');
const request=()=>contract.parseConversationPageRequest({workspaceContextId:uuid(900)});
const row=(n,extra={})=>({id:uuid(n),business_id:uuid(900),status:'open',is_pinned:false,last_message_at:new Date(Date.UTC(2026,8,30,0,0,1000-n)).toISOString(),updated_at:'2026-09-30T20:00:00Z',unread_count:1,...extra});
const counts={views:{all:1000,unread:1000,my:0,unassigned:1000,comment:0,open:1000,pinned:0},statusCounts:{all:1000,open:1000,pending:0,resolved:0,closed:0,spam:0},totalUnreadCount:1000,unreadConversationCount:1000};
const page=rows=>({conversations:rows,updates:[],matchedKnownIds:[],total:1000,hasMore:true,cursor:rows.length?{id:rows.at(-1).id,pinned:false,lastMessageAt:rows.at(-1).last_message_at}:null,counts,readTargets:[]});
function harness(initialRows=Array.from({length:30},(_,i)=>row(i+1))){
 const clock={now:Date.now()};const h=hooks(),events=new Map(),jobs=new Map(),calls=[];let timer=0,answer=body=>page(Array.from({length:30},(_,i)=>row(i+(body.cursor?31:1))));
 const doc={visibilityState:'visible',addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n)};
 const win={addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n),dispatchEvent:e=>events.get(e.type)?.(e)};
 const load=loader({react:h.React},{document:doc,window:win,AbortController,CustomEvent,Date:class extends Date {static now(){return clock.now;}},
  setTimeout:fn=>{jobs.set(++timer,fn);return timer},clearTimeout:id=>jobs.delete(id),
  fetch:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);const result=await answer(body,init.signal);return result instanceof Response ? result : Response.json({success:true,page:result});}});
 const hook=load('lib/inbox/use-conversation-pages.ts').useConversationPages;
 const props={initial:{request:request(),page:{...page(initialRows),ids:initialRows.map(r=>r.id)}},request:request(),live:initialRows,onRows:()=>{}};
 const render=()=>h.render(()=>hook(props.initial,props.request,props.live,props.onRows),{});
 const flush=async()=>{const pending=[...jobs.values()];jobs.clear();for(const fn of pending)fn();await tick();return render()};
 return {h,props,render,flush,events,jobs,calls,doc,advance:ms=>clock.now+=ms,answer:fn=>answer=fn};
}
test('request validation rejects arbitrary views, injected scope IDs, overlong search and unbounded known IDs',()=>{
 assert.equal(contract.CONVERSATION_PAGE_SIZE,30);
 for(const body of [{view:'admin'},{workspaceId:'bad'},{search:'a'.repeat(501)},{knownIds:Array(201).fill(uuid(1))},{cursor:{id:uuid(1),pinned:false,lastMessageAt:'bad'}}])assert.throws(()=>contract.parseConversationPageRequest(body));
 assert.equal(contract.parseConversationPageRequest({knownIds:[uuid(1),uuid(1)]}).knownIds.length,1);
});
test('stable ordering, duplicates and older page responses preserve a newer read/realtime version',()=>{
 const newer=row(1,{last_message_text:'new',updated_at:'2026-09-30T21:00:00Z',unread_count:0});
 const result=contract.mergeConversationPage([newer,row(2)], [row(1,{last_message_text:'old'}),row(3,{is_pinned:true}),row(2)]);
 assert.equal(result.length,3);assert.equal(result[0].id,uuid(3));assert.equal(result.find(r=>r.id===uuid(1)).unread_count,0);
 assert.equal(contract.sortConversationPage([row(1,{last_message_at:null}),row(2,{last_message_at:null})])[0].id,uuid(2));
});
test('initial page does not refetch; bounded next page retains prior rows and deduplicates',async()=>{
 const d=harness();try{let s=d.render();await tick();assert.equal(d.calls.length,0);d.answer(()=>page([row(30),...Array.from({length:29},(_,i)=>row(i+31))]));s.more();await tick();s=d.render();assert.equal(d.calls.length,1);assert.equal(d.calls[0].cursor.id,uuid(30));assert.equal(s.rows.length,59);assert.equal(s.page.counts.views.all,1000);}finally{d.h.cleanup()}
});
test('server search and view switches replace pages; history-only results are retained',async()=>{
 const d=harness();try{d.render();d.answer(body=>page([row(body.view==='comment'?700:800,{last_message_text:'preview without keyword',source_type:'comment'})]));d.props.request={...request(),view:'comment',search:'old history phrase'};d.render();await tick();const s=d.render();assert.equal(d.calls[0].view,'comment');assert.equal(d.calls[0].search,'old history phrase');assert.equal(s.rows.length,1);assert.equal(s.rows[0].id,uuid(700));}finally{d.h.cleanup()}
});
test('targeted teammate events coalesce, remove no-longer-matching rows and keep visited cursor',async()=>{
 const d=harness();try{d.render();d.answer(body=>({...page(Array.from({length:29},(_,i)=>row(i+2))),matchedKnownIds:[],updates:[]}));
 const fn=d.events.get(contract.INBOX_PAGE_CHANGED_EVENT);fn(new CustomEvent('live',{detail:{conversationId:uuid(1)}}));fn(new CustomEvent('live',{detail:{conversationId:uuid(1)}}));assert.equal(d.jobs.size,1);
 const s=await d.flush();assert.deepEqual(d.calls[0].knownIds,[uuid(1)]);assert.equal(s.rows.some(r=>r.id===uuid(1)),false);assert.equal(s.page.cursor.id,uuid(30));}finally{d.h.cleanup()}
});
test('hidden events do not fetch or mark read; visible resume checks visited rows and complete bulk snapshot is explicit',async()=>{
 const d=harness();try{d.render();d.doc.visibilityState='hidden';d.events.get(contract.INBOX_PAGE_CHANGED_EVENT)(new Event('live'));await tick();assert.equal(d.calls.length,0);
 d.answer(body=>({...page(Array.from({length:30},(_,i)=>row(i+1))),matchedKnownIds:body.knownIds??[],readTargets:body.snapshot?Array.from({length:250},(_,i)=>({id:uuid(i+1),lastMessageAt:null,updatedAt:null,unreadCount:1})):[]}));
 d.doc.visibilityState='visible';d.events.get('visibilitychange')();d.events.get('focus')();let s=await d.flush();assert.equal(d.calls.length,1);assert.equal(d.calls[0].knownIds.length,30);assert.equal(d.calls[0].snapshot,false);
 const snapshot=await s.snapshot();assert.equal(snapshot.length,250);assert.equal(d.calls[1].snapshot,true);assert.equal(d.calls[1].cursor,null);}finally{d.h.cleanup()}
});
test('catch-up request batches never exceed 200 visited IDs',async()=>{
 const d=harness(Array.from({length:450},(_,i)=>row(i+1)));try{d.render();d.answer(body=>({...page([]),matchedKnownIds:body.knownIds,updates:[]}));d.events.get('online')();const s=await d.flush();assert.deepEqual(d.calls.map(c=>c.knownIds.length),[200,200,50]);assert.equal(s.rows.length,450);}finally{d.h.cleanup()}
});
test('failed page does not advance cursor or remove loaded history; retry keeps completeness',async()=>{
 const d=harness();try{let s=d.render();d.answer(()=>{throw Error('offline')});s.more();await tick();s=d.render();assert.equal(s.rows.length,30);assert.equal(s.page.cursor.id,uuid(30));assert.match(s.error,/retry/i);d.answer(body=>({...page([]),matchedKnownIds:body.knownIds,updates:[]}));s.retry();await tick();s=d.render();assert.equal(s.error,null);assert.equal(s.rows.length,30);}finally{d.h.cleanup()}
});
test('legacy migration-absent mode performs no page fetches',async()=>{
 const d=harness();try{d.props.initial=undefined;const s=d.render();s.more();await tick();assert.equal(s.enabled,false);assert.equal(d.calls.length,0);}finally{d.h.cleanup()}
});
test('prepared SQL contract bounds hydration after complete filtering and keeps snapshots read-only',()=>{
 const sql=fs.readFileSync('db/migrations/20261003_inbox_server_paging.sql','utf8');
 assert.match(sql,/length\(s.needle\) >= 3 AND EXISTS/);assert.doesNotMatch(sql,/LIMIT 200/i);
 assert.match(sql,/ORDER BY COALESCE\(is_pinned,false\) DESC,last_message_at DESC NULLS LAST,id DESC/);
 assert.match(sql,/'readTargets',CASE WHEN p_snapshot/);assert.match(sql,/REVOKE ALL.*FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/LEAST\(30,GREATEST\(1,COALESCE\(\(p_request->>'size'\)::integer,30\)\)\)/);
 assert.doesNotMatch(sql,/\b(DELETE FROM|UPDATE public\.|INSERT INTO|DROP TABLE)\b/i);
 // Static review only: this does not execute PostgreSQL, RLS or a query plan.
});

test('late responses from an earlier search cannot replace a newer view',async()=>{
 const d=harness();try{d.render();let release;d.answer(body=>body.search==='slow'?new Promise(r=>release=r):page([row(900)]));
 d.props.request={...request(),search:'slow'};d.render();await tick();d.props.request={...request(),search:'new'};d.render();await tick();let s=d.render();assert.equal(s.rows[0].id,uuid(900));release(page([row(800)]));await tick();s=d.render();assert.equal(s.rows[0].id,uuid(900));}finally{d.h.cleanup()}
});
test('bounded recovery discoveries are server-qualified even outside the first page',async()=>{
 const d=harness();try{d.render();d.answer(body=>({...page([]),matchedKnownIds:body.knownIds,updates:[row(800,{source_type:'comment'})]}));d.props.live=[...d.props.live,row(800)];d.render();const s=await d.flush();assert.deepEqual(d.calls[0].knownIds,[uuid(800)]);assert.equal(s.rows.some(r=>r.id===uuid(800)),true);}finally{d.h.cleanup()}
});

test('new customer discovered in Unread remains server-qualified when switching to All with an older first page',async()=>{
 const d=harness();try{d.render();const customer=row(801,{last_message_at:'2026-10-01T20:00:00Z',updated_at:'2026-10-01T20:00:00Z'});
 d.props.live=[...d.props.live,customer];d.props.request={...request(),view:'unread'};
 d.answer(body=>({...page(d.props.live.slice(0,30)),matchedKnownIds:body.knownIds??[],updates:body.knownIds?.includes(customer.id)?[customer]:[]}));
 d.render();await tick();let s=d.render();assert.equal(s.rows[0].id,customer.id);
 d.props.request=request();d.render();await tick();s=d.render();assert.equal(s.rows[0].id,customer.id);assert.ok(d.calls.at(-1).knownIds.includes(customer.id));
 }finally{d.h.cleanup()}
});
test('late page response cannot overwrite newer incoming or teammate activity in global rows',async()=>{
 const d=harness();try{d.render();let finish;const published=[];d.props.onRows=rows=>published.push(...rows);d.answer(()=>new Promise(r=>finish=r));
 d.events.get('focus')();d.flush();await tick();const newer=row(10,{last_message_at:'2026-10-01T22:00:00Z',updated_at:'2026-10-01T22:00:00Z',last_message_text:'Teammate latest'});
 d.props.live=d.props.live.map(r=>r.id===newer.id?newer:r);d.render();finish({...page([row(10)]),matchedKnownIds:[newer.id]});await tick();const s=d.render();
 assert.equal(s.rows[0].id,newer.id);assert.equal(published.find(r=>r.id===newer.id).last_message_text,'Teammate latest');assert.ok(d.jobs.size>0);
 }finally{d.h.cleanup()}
});
test('wrong-workspace row cannot replace a same-ID live row',async()=>{
 const d=harness();try{d.render();d.answer(()=>page([row(1,{business_id:uuid(999),last_message_text:'wrong'})]));d.events.get('focus')();const s=await d.flush();assert.equal(s.rows.find(r=>r.id===uuid(1)).business_id,uuid(900));}finally{d.h.cleanup()}
});
function adapter(options={}){
 const fixtures=Array.from({length:1000},(_,i)=>row(i+1,{contact:{full_name:'Customer '+i,phone:'12345',tags:[]},last_message_text:'Customer message '.repeat(30)}));
 const calls=[],hydrates=[];
 const db={from:table=>{const chain={select:()=>chain,eq:()=>chain,in:()=>chain,then:(a,b)=>Promise.resolve({data:table==='team_members'?[{id:uuid(901),business_id:uuid(900)}]:[],error:null}).then(a,b)};return chain},
  rpc:async(name,args)=>{calls.push({name,args});return options.error?{data:null,error:options.error}:{data:{...page([]),ids:options.ids??fixtures.slice(0,30).map(r=>r.id),matchedKnownIds:args.p_request.knownIds??[]},error:null}}};
 const load=loader({'@/lib/supabase/admin':{supabaseAdmin:db},'@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,user:{id:uuid(902)}})},
  '@/lib/inbox/get-conversations':{getInboxConversationScope:async()=>({accessibleBusinessIds:[uuid(900)],currentBusinessId:uuid(900)}),getConversations:async(businesses,filter)=>{hydrates.push(filter);return fixtures.filter(r=>filter.conversationIds.includes(r.id))}}});
 return {helper:load('lib/inbox/get-conversation-page.ts'),calls,hydrates,fixtures};
}
test('server adapter hydrates at most 30 page rows and scope/member identities are server-owned',async()=>{
 const d=adapter();const result=await d.helper.getConversationPage(request());assert.equal(result.conversations.length,30);assert.equal(d.hydrates[0].conversationIds.length,30);
 assert.equal(d.calls[0].args.p_user_id,uuid(902));assert.equal(d.calls[0].args.p_request.memberIds[uuid(900)],uuid(901));
 assert.equal(d.calls[0].args.p_request.size,30);
 const fullBytes=Buffer.byteLength(JSON.stringify(d.fixtures)),pageBytes=Buffer.byteLength(JSON.stringify(result));assert.ok(pageBytes<fullBytes/10);
 console.log(`Paging fixture: full 1000-row JSON ${fullBytes} bytes; 30-row response ${pageBytes} bytes (mocked SQL, not live payload).`);
});
test('server rejects inaccessible workspace before querying RPC and only missing-RPC errors permit legacy fallback',async()=>{
 const d=adapter();await assert.rejects(d.helper.getConversationPage({...request(),workspaceId:uuid(999)}),/outside/);assert.equal(d.calls.length,0);
 const missing=adapter({error:{code:'PGRST202'}});await assert.rejects(missing.helper.getConversationPage(request()),error=>error instanceof missing.helper.ConversationPagingUnavailable);
 const failed=adapter({error:{code:'42501'}});await assert.rejects(failed.helper.getConversationPage(request()),error=>!(error instanceof failed.helper.ConversationPagingUnavailable));
});
test('server refuses invalid or unbounded hydration IDs',async()=>{
 for(const ids of [[...Array.from({length:31},(_,i)=>uuid(i+1))],['bad']]){const d=adapter({ids});await assert.rejects(d.helper.getConversationPage(request()),/Invalid/);assert.equal(d.hydrates.length,0)}
});
test('page API exposes private no-store responses and malformed requests never call server adapter',async()=>{
 let calls=0;const load=loader({'next/server':{NextResponse:Response},'@/lib/server/tenant-read-scope':{withTenantReadScope:fn=>fn},'@/lib/inbox/get-conversation-page':{getConversationPage:async()=>{calls++;return page([row(1)])},ConversationPagingUnavailable:class extends Error{}}});
 const route=load('app/api/inbox/conversation-page/route.ts');const req=body=>new Request('https://app.tenhchat.com/api/inbox/conversation-page',{method:'POST',body:JSON.stringify(body)});
 const bad=await route.POST(req({view:'admin'}));assert.equal(bad.status,400);assert.equal(calls,0);const good=await route.POST(req(request()));assert.equal(good.status,200);assert.equal(good.headers.get('Cache-Control'),'private, no-store');assert.equal((await good.json()).page.conversations.length,1);
});
test('page metadata preserves manual unread, acknowledged reads and optimistic tags/pin/status/assignment',()=>{
 const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');const parsed=ts.createSourceFile('inbox.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)==='handlePageRows')declaration=node;ts.forEachChild(node,visit);}visit(parsed);assert.ok(declaration,'page handler exists');
 let current=[row(1,{contact:{id:'ct',tags:[]}})];const ref=value=>({current:value});
 const context={useCallback:fn=>fn,mergeConversationPage:contract.mergeConversationPage,setLiveConversations:fn=>current=fn(current),rowTime:value=>Date.parse(value)||0,
  liveDiscoveredIdsRef:ref(new Set()),persistedManualUnreadCountsRef:ref(new Map([[uuid(1),3]])),manualUnreadConversationIdsRef:ref(new Set([uuid(1)])),
  readBarrierMessageTimeRef:ref(new Map()),readInFlightRef:ref(new Set()),readRowVersionRef:ref(new Map()),
  pinOverrideRef:ref(new Map([[uuid(1),{isPinned:true,expiresAt:Date.now()+60000}]])),statusOverrideRef:ref(new Map([[uuid(1),{status:'pending',expiresAt:Date.now()+60000}]])),
  assignmentOverrideRef:ref(new Map([[uuid(1),{assignedTo:uuid(901),expiresAt:Date.now()+60000}]])),contactTagsOverrideRef:ref(new Map([['ct',{tags:[{id:'vip',name:'VIP'}],expiresAt:Date.now()+60000}]]))};
 vm.createContext(context);vm.runInContext(ts.transpileModule('const '+declaration.getText(parsed)+';\n globalThis.applyPage = handlePageRows;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 context.applyPage([row(1,{unread_count:0,contact:{id:'ct',tags:[]}})]);assert.equal(current[0].unread_count,3);assert.equal(current[0].is_pinned,true);assert.equal(current[0].status,'pending');assert.equal(current[0].assigned_to,uuid(901));assert.equal(current[0].contact.tags[0].id,'vip');
 context.persistedManualUnreadCountsRef.current.clear();context.manualUnreadConversationIdsRef.current.clear();context.readBarrierMessageTimeRef.current.set(uuid(1),Date.parse(current[0].last_message_at));context.readRowVersionRef.current.set(uuid(1),Date.parse(current[0].updated_at));
 context.applyPage([row(1,{unread_count:2,contact:{id:'ct',tags:[]}})]);assert.equal(current[0].unread_count,0);assert.equal(current[0].contact.tags[0].id,'vip');
});
test('optimistic reads immediately reconcile complete unread aggregates without changing other counts',async()=>{
 const d=harness([row(1,{unread_count:3}),row(2,{unread_count:2}),row(3)]);try{
 d.render();await tick();d.props.live=d.props.live.map(r=>r.id===uuid(1)?{...r,unread_count:0}:r);
 let s=d.render();assert.equal(s.rows.find(r=>r.id===uuid(1)).unread_count,0);
 assert.equal(s.page.counts.views.unread,999);assert.equal(s.page.counts.totalUnreadCount,997);
 assert.equal(s.page.counts.views.all,1000);assert.equal(d.calls.length,0);
 d.props.live=d.props.live.map(r=>r.id===uuid(2)?{...r,unread_count:0}:r);s=d.render();assert.equal(s.page.counts.views.unread,998);
 // Failed server read restores the local row; new incoming activity does likewise.
 d.props.live=d.props.live.map(r=>r.id===uuid(1)?{...r,unread_count:3}:r);s=d.render();assert.equal(s.page.counts.views.unread,999);
 d.props.live=d.props.live.map(r=>r.id===uuid(2)?{...r,unread_count:1}:r);s=d.render();assert.equal(s.page.counts.views.unread,1000);
 }finally{d.h.cleanup()}
});
test('authoritative empty page stays empty during quiet refresh while a different view shows initial loading',async()=>{
 const d=harness([]);let release;try{d.render();await tick();d.answer(()=>new Promise(r=>release=r));
 d.events.get('focus')();void d.flush();await tick();let s=d.render();assert.equal(s.loading,true);assert.equal(s.initialLoading,false);
 release({...page([]),hasMore:false});await tick();s=d.render();assert.equal(s.initialLoading,false);
 d.props.request={...request(),view:'pinned'};d.render();await tick();s=d.render();assert.equal(s.initialLoading,true);
 release({...page([]),hasMore:false});await tick();s=d.render();assert.equal(s.initialLoading,false);
 }finally{d.h.cleanup()}
});
test('new view over 1000 loaded conversations requests only one first page, not five qualification batches',async()=>{
 const d=harness(Array.from({length:1000},(_,i)=>row(i+1)));try{d.render();await tick();d.props.request={...request(),view:'comment'};d.render();await tick();const s=d.render();assert.equal(d.calls.length,1);assert.equal(d.calls[0].knownIds,undefined);assert.equal(s.rows.length,30);assert.equal(s.page.total,1000);}finally{d.h.cleanup()}
});
test('repeat view renders bounded warm rows and its own total immediately, then revalidates once',async()=>{
 const d=harness();let release;try{d.render();await tick();d.answer(()=>({...page([row(3)]),total:1}));d.props.request={...request(),view:'unread'};d.render();await tick();let s=d.render();assert.equal(s.page.total,1);
 d.answer(()=>new Promise(r=>release=r));d.props.request=request();s=d.render();assert.equal(s.rows.length,30);assert.equal(s.page.total,1000);assert.equal(s.initialLoading,false);await tick();assert.equal(d.calls.length,2);assert.equal(d.calls[1].knownIds.length,30);
 release({...page(Array.from({length:30},(_,i)=>row(i+1))),matchedKnownIds:Array.from({length:30},(_,i)=>uuid(i+1))});await tick();s=d.render();assert.equal(s.rows.length,30);assert.equal(d.calls.length,2);
 }finally{d.h.cleanup()}
});
test('cold-view counts do not inherit previous-view totals, and errors permit retry without wrong rows',async()=>{
 const d=harness();try{d.render();await tick();d.answer(()=>{throw Error('offline')});d.props.request={...request(),view:'pinned'};let s=d.render();assert.equal(s.page,undefined);assert.equal(s.rows.length,0);await tick();s=d.render();assert.match(s.error,/retry/i);assert.equal(s.initialLoading,false);assert.equal(s.page,undefined);d.answer(()=>({...page([]),total:0,hasMore:false}));s.retry();await tick();s=d.render();assert.equal(s.page.total,0);assert.equal(s.error,null);}finally{d.h.cleanup()}
});
test('activity invalidates inactive view cache before pin/read/comment re-entry',async()=>{
 const d=harness();try{d.render();await tick();d.answer(()=>({...page([row(2)]),total:1}));d.props.request={...request(),view:'pinned'};d.render();await tick();d.props.live=d.props.live.map(r=>r.id===uuid(1)?{...r,unread_count:0,is_pinned:true}:r);d.render();await tick();d.props.request=request();const s=d.render();assert.equal(s.rows.length,0);assert.equal(s.initialLoading,true);}finally{d.h.cleanup()}
});
test('workspace context is part of cache key and revoked cached rows cannot be reused',async()=>{
 const d=harness();try{d.render();await tick();d.answer(()=>({...page([]),total:0}));d.props.request={...request(),view:'unread'};d.render();await tick();d.props.live=[];d.props.request=request();let s=d.render();assert.equal(s.rows.length,0);d.props.request={...request(),workspaceContextId:uuid(999)};s=d.render();assert.equal(s.page,undefined);assert.equal(s.initialLoading,true);}finally{d.h.cleanup()}
});
test('view cache expires after 30 seconds and evicts beyond six keys',async()=>{
 const d=harness();try{d.render();await tick();d.answer(()=>page([row(2)]));for(let n=1;n<=7;n++){d.props.request={...request(),search:'term '+n};d.render();await tick();d.render();}
 d.props.request=request();let s=d.render();assert.equal(s.initialLoading,true);await tick();d.render();d.props.request={...request(),search:'term 7'};s=d.render();assert.equal(s.initialLoading,false);await tick();d.render();d.advance(30001);d.props.request=request();s=d.render();assert.equal(s.initialLoading,true);
 }finally{d.h.cleanup()}
});
test('authorization denial clears warm cached rows and supplies an error without switching chats',async()=>{
 const d=harness();try{d.render();await tick();d.answer(()=>({...page([row(2)]),total:1}));d.props.request={...request(),view:'unread'};d.render();await tick();d.answer(()=>Response.json({success:false,error:'Forbidden'},{status:403}));d.props.request=request();let s=d.render();assert.equal(s.rows.length,30);await tick();s=d.render();assert.equal(s.rows.length,0);assert.match(s.error,/Forbidden/);}finally{d.h.cleanup()}
});
