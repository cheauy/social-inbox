const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {loader,uuid,base,setup,hooks,tick}=require('./inbox-recovery-harness.cjs');
const pure=loader()('lib/inbox/live-sync.ts');
test('sync cursor accepts ISO/UUID and rejects arbitrary PostgREST expressions',()=>{
 assert.equal(pure.validSyncCursor({updatedAt:'2026-09-29T05:00:00.000Z',id:uuid(1)}),true);
 for(const x of [null,{}, {updatedAt:'invalid'}, {updatedAt:'2026-09-29T00:00:00Z,unread_count.gt.0'}, {updatedAt:'2026-09-29T00:00:00Z',id:'x),id.neq.x'}])assert.equal(pure.validSyncCursor(x),false);
});
for(const count of [0,1,200,201,499,500,501,1055])test(`rotating known-row sync covers all ${count} rows without the old 500-row ceiling`,()=>{
 const rows=Array.from({length:count},(_,i)=>i),visited=[];let offset=0;
 do {const b=pure.takeSyncBatch(rows,offset);assert.ok(b.rows.length<=200);visited.push(...b.rows);offset=b.nextOffset;}while(offset);
 assert.deepEqual([...visited],rows);
});
test('late state cannot regress a newer preview or acknowledged read',()=>{
 const local={last_message_at:'2026-09-29T05:00:01Z',updated_at:'2026-09-29T05:00:02Z'};
 assert.equal(pure.isOlderConversationState(local,{last_message_at:'2026-09-29T05:00:00Z',updated_at:'2026-09-29T05:00:03Z'}),true);
 assert.equal(pure.isOlderConversationState(local,{last_message_at:local.last_message_at,updated_at:'2026-09-29T05:00:01Z'}),true);
 assert.equal(pure.isOlderConversationState(local,{...local}),false);
});
test('empty Inbox recovers a brand-new conversation without knowing its ID',async()=>{
 const h=setup(),route=h.load('app/api/inbox/live-state/route.ts');const response=await route.POST(h.request({conversationIds:[]}));const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.hydratedConversations[0].id,uuid(1));assert.equal(data.conversations[0].unread_count,2);assert.equal(h.hydrateCalls.length,1);assert.match(response.headers.get('cache-control'),/no-store/);
});
test('newly discovered teammate outgoing message is returned even though unread count did not increase',async()=>{
 const seed=base();seed.conversations[0].unread_count=0;seed.conversations[0].last_message_text='A teammate replied';
 const h=setup({seed});const data=await(await h.load('app/api/inbox/live-state/route.ts').POST(h.request({conversationIds:[]}))).json();
 assert.equal(data.conversations[0].last_message_text,'A teammate replied');assert.equal(data.conversations[0].unread_count,0);
});
test('discovery paginates equal-timestamp rows by UUID with no loss',async()=>{
 const seed=base(),stamp=new Date().toISOString();seed.conversations=Array.from({length:237},(_,i)=>({...seed.conversations[0],id:uuid(i+1),updated_at:stamp}));
 const h=setup({seed}),route=h.load('app/api/inbox/live-state/route.ts');let cursor={updatedAt:stamp},ids=[],pages=0;
 do{const data=await(await route.POST(h.request({conversationIds:[],cursor}))).json();ids.push(...data.hydratedConversations.map(r=>r.id));cursor=data.cursor;pages++;if(!data.hasMore)break;assert.ok(pages<5);}while(true);
 assert.equal(pages,3);assert.equal(ids.length,237);assert.equal(new Set(ids).size,237);assert.deepEqual(ids,seed.conversations.map(r=>r.id));
});
test('known old conversation outside discovery window still reconciles a read or preview',async()=>{
 const seed=base();seed.conversations[0].updated_at='2026-01-01T00:00:00Z';seed.conversations[0].unread_count=0;
 const h=setup({seed}),data=await(await h.load('app/api/inbox/live-state/route.ts').POST(h.request({conversationIds:[uuid(1)]}))).json();
 assert.equal(data.hydratedConversations.length,0);assert.equal(data.conversations[0].unread_count,0);
});
test('sync is scoped to active accessible workspaces and channels',async()=>{
 const seed=base();seed.conversations.push({...seed.conversations[0],id:uuid(2),business_id:'b2',social_account_id:'s2'}, {...seed.conversations[0],id:uuid(3),social_account_id:'s3'});
 seed.social_accounts.push({...seed.social_accounts[0],id:'s2',business_id:'b2'}, {...seed.social_accounts[0],id:'s3',is_active:false});
 const h=setup({seed}),data=await(await h.load('app/api/inbox/live-state/route.ts').POST(h.request({conversationIds:[uuid(1),uuid(2),uuid(3)]}))).json();
 assert.deepEqual(data.conversations.map(r=>r.id),[uuid(1)]);assert.deepEqual(data.activeChannelIds,['s1']);
});
test('channel and workspace URL filters constrain discovered rows',async()=>{
 const h=setup(),data=await(await h.load('app/api/inbox/live-state/route.ts').POST(h.request({conversationIds:[],channelId:'different',workspaceId:'b1'}))).json();
 assert.equal(data.hydratedConversations.length,0);assert.equal(h.hydrateCalls[0].filter.channelId,'different');assert.equal(h.hydrateCalls[0].filter.workspaceId,'b1');
});
for(const options of [{signedOut:true},{businesses:[]}])test('lost authorization returns no conversation content '+JSON.stringify(options),async()=>{
 const h=setup(options),r=await h.load('app/api/inbox/live-state/route.ts').POST(h.request({conversationIds:[uuid(1)]})),d=await r.json();
 if(options.signedOut)assert.equal(r.status,401);else assert.deepEqual(d.conversations,[]);assert.equal(h.hydrateCalls.length,0);
});
test('temporary discovery failure returns retryable JSON and later request succeeds',async()=>{
 const h=setup(),route=h.load('app/api/inbox/live-state/route.ts');h.db.faults.push({table:'conversations',once:true});
 assert.equal((await route.POST(h.request({conversationIds:[]}))).status,503);assert.equal((await route.POST(h.request({conversationIds:[]}))).status,200);
});
test('invalid cursor is rejected before data access',async()=>{
 const h=setup(),r=await h.load('app/api/inbox/live-state/route.ts').POST(h.request({cursor:{updatedAt:'x'}}));assert.equal(r.status,400);assert.equal(h.db.history.length,0);
});
function stream(initialSession={access_token:'t1',user:{id:'u1'}}){
 const rt=hooks(), channels=[],removed=[],health=[],events=[],resyncs=[],scope=[];let session=initialSession,authCallback;
 const timers=new Map();let timerId=0;
 const window=new EventTarget();
 const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{authCallback=fn;return {data:{subscription:{unsubscribe(){authCallback=null;}}}};}},realtime:{setAuth:async()=>{}},removeChannel:async ch=>removed.push(ch),channel(name){const ch={name,handlers:[],on(event,filter,fn){ch.handlers.push({event,filter,fn});return ch},subscribe(fn){ch.status=fn;channels.push(ch);return ch}};return ch}};
 const load=loader({react:rt.React,'@/lib/supabase/client':{createClient:()=>client}},{window,setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id)});
 const {useInboxRealtime}=load('lib/inbox/use-inbox-realtime.ts');
 const props={businessIds:['b2','b1','b1'],onRealtimeEvent:e=>events.push(e),onFallbackRefresh:()=>resyncs.push(true),onScopeChanged:()=>scope.push(true),onConnectionState:h=>health.push(h)};
 const render=changes=>rt.render(useInboxRealtime,{...props,...changes});render();
 return {rt,channels,removed,health,events,resyncs,scope,render,window,flush(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());},auth(event,value){session=value;authCallback?.(event,value);}};
}
test('core channels exclude optional tables and initial subscription requests catch-up',async()=>{
 const h=stream();await tick();const cores=h.channels.filter(ch=>ch.name.startsWith('tenh-inbox-v3'));
 assert.equal(cores.length,2);assert.deepEqual(cores[0].handlers.map(h=>h.filter.table),['messages','conversations']);
 cores[0].status('SUBSCRIBED');assert.equal(h.health.at(-1),false);cores[1].status('SUBSCRIBED');assert.equal(h.health.at(-1),true);
 h.flush();assert.equal(h.resyncs.length,1);h.rt.cleanup();
});
test('disconnect and reconnect request reconciliation and optional events do not change core health',async()=>{
 const h=stream();await tick();const cores=h.channels.filter(ch=>ch.status);cores.forEach(ch=>ch.status('SUBSCRIBED'));h.flush();
 cores[0].status('CHANNEL_ERROR');assert.equal(h.health.at(-1),false);h.flush();cores[0].status('SUBSCRIBED');assert.equal(h.health.at(-1),true);h.flush();assert.equal(h.resyncs.length,3);
 const aux=h.channels.find(ch=>ch.name.startsWith('tenh-inbox-context'));aux.handlers.find(x=>x.filter.table==='team_members').fn({});assert.equal(h.scope.length,1);assert.equal(h.health.at(-1),true);h.rt.cleanup();
});
test('session not ready at mount starts stream after sign-in',async()=>{
 const h=stream(null);await tick();assert.equal(h.channels.length,0);h.auth('SIGNED_IN',{access_token:'ready',user:{id:'u1'}});await tick();assert.equal(h.channels.length,4);h.rt.cleanup();
});
test('stream uses latest callback without making duplicate channels',async()=>{
 const h=stream();await tick();let newer=0;h.render({onRealtimeEvent:()=>newer++});await tick();
 h.channels[0].handlers[0].fn({eventType:'INSERT',new:{id:uuid(1)},old:{}});assert.equal(newer,1);assert.equal(h.events.length,0);assert.equal(h.channels.length,4);h.rt.cleanup();
});
test('sign-out retires channels; stale emissions cannot cross into a new account',async()=>{
 const h=stream();await tick();const old=h.channels[0];h.auth('SIGNED_OUT',null);await tick();assert.equal(h.removed.length,4);old.handlers[0].fn({eventType:'INSERT',new:{id:uuid(1)},old:{}});assert.equal(h.events.length,0);
 h.auth('SIGNED_IN',{access_token:'other',user:{id:'u2'}});await tick();assert.equal(h.channels.length,8);h.rt.cleanup();
});
test('teardown prevents pending recovery and removes every subscription',async()=>{
 const h=stream();await tick();h.channels[0].status('CLOSED');h.rt.cleanup();h.flush();assert.equal(h.resyncs.length,0);assert.equal(h.removed.length,4);
});
test('message polling no longer invokes Graph or writes post metadata',()=>{
 const source=fs.readFileSync('app/api/conversations/[conversationId]/messages/route.ts','utf8');assert.doesNotMatch(source,/getFacebookPostPreview|getFacebookPostIdForComment|raw_payload:.*post_preview/);
});
test('inbox repair keeps stable ordering and uses bounded resumable safety nets, not router refresh per message',()=>{
 const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');assert.match(source,/stableConversationOrder/);assert.match(source,/takeSyncBatch\(liveConversationsRef.current/);assert.match(source,/activeOnly: true/);assert.match(source,/hydratedConversations/);assert.doesNotMatch(source,/collaborationFallbackUnavailableRef/);
});

test('publication repair only adds core tables, refuses disabled RLS and leaves policies intact',()=>{
 const sql=fs.readFileSync('db/migrations/20260929_inbox_realtime_publication.sql','utf8');
 assert.match(sql,/array\['messages', 'conversations'\]/);assert.match(sql,/if not rls_enabled then/i);
 assert.doesNotMatch(sql,/\b(create|drop|alter) policy\b|disable row level security|grant .* to /i);
});

test('same-second provider timestamp cannot hide a message inserted after read acknowledgement',()=>{
 const stamp='2026-09-29T05:00:00.000Z', barrier=Date.parse(stamp), read=barrier+200;
 assert.equal(pure.messageCoveredByRead(stamp,'2026-09-29T05:00:00.100Z',barrier,read),true);
 assert.equal(pure.messageCoveredByRead(stamp,'2026-09-29T05:00:00.300Z',barrier,read),false);
 assert.equal(pure.messageCoveredByRead('2026-09-29T05:00:01.000Z',stamp,barrier,read),false);
});

test('delayed INITIAL_SESSION also starts the stream without waiting for a focus event',async()=>{
 const h=stream(null);await tick();assert.equal(h.channels.length,0);
 h.auth('INITIAL_SESSION',{access_token:'ready',user:{id:'u1'}});await tick();assert.equal(h.channels.length,4);h.rt.cleanup();
});

test('newer server acknowledgement reconciles second-precision time against optimistic milliseconds',()=>{
 const local={last_message_at:'2026-09-29T05:00:00.500Z',updated_at:'2026-09-29T04:59:59.000Z'};
 const remote={last_message_at:'2026-09-29T05:00:00.000Z',updated_at:'2026-09-29T05:00:00.800Z'};
 assert.equal(pure.isOlderConversationState(local,remote),false);
 assert.equal(pure.isOlderConversationState(local,{...remote,updated_at:local.updated_at}),true);
});
