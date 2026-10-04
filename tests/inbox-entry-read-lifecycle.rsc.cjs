// Run with: node --conditions=react-server --test tests/inbox-entry-read-lifecycle.rsc.cjs
// Real installed React/Flight request caches; bounded data/transport fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const React=require('react'),rsc=require('next/dist/compiled/react-server-dom-webpack/server.node');
const {AsyncLocalStorage}=require('node:async_hooks'),{loader,uuid}=require('./inbox-recovery-harness.cjs');
const authContext=new AsyncLocalStorage(),business=uuid(900),channel=uuid(700),member=uuid(800),user=uuid(600);
const artifact=process.env.TENH_ENTRY_BASELINE_DIR;
async function render(read){let value,error;async function Probe(){value=await read();return 'done'}const stream=await rsc.renderToReadableStream(React.createElement(Probe),{}, {onError:e=>{error=e}});const reader=stream.getReader();for(;;){const chunk=await reader.read();if(chunk.done)break}if(error)throw error;return value;}
function fixture({baseline=false,delay=0,teamDelay=delay,offPage=false,sdkTransport=false}={}){
 const calls=[],controls={scopeDenied:false,channelDisabled:false,failSubscriptions:false,pageError:null};let started=performance.now();
 const row=n=>({id:uuid(n),business_id:business,social_account_id:channel,contact:null,social_account:{id:channel,platform:'telegram'},status:'open',is_pinned:false,unread_count:0,last_message_at:'2026-10-04T00:00:00Z'});
 const data={team_members:[{id:member,business_id:business,user_id:user,is_active:true,full_name:'Fixture'}],business_subscriptions:[{id:uuid(400),business_id:business,status:'active',current_period_end:'2027-01-01T00:00:00Z',created_at:'2026-01-01'}],
  social_accounts:[{id:channel,business_id:business,is_active:true,platform:'telegram',telegram_token_status:'verified'}],inbox_saved_views:[],conversations:[row(1),row(2)],messages:[{id:uuid(100),conversation_id:offPage?uuid(2):uuid(1),business_id:business,platform_created_at:'2026-10-04T00:00:00Z',created_at:'2026-10-04T00:00:00Z'}]};
 async function read(label,fn,wait=delay){const entry={label,start:performance.now()-started};calls.push(entry);if(wait)await new Promise(r=>setTimeout(r,wait));const result=fn();entry.end=performance.now()-started;return result}
 class Query{
  constructor(table){this.table=table;this.columns='';this.filters=[];this.max=Infinity}select(c){this.columns=c;return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}in(k,v){this.filters.push(r=>v.includes(r[k]));return this}order(){return this}limit(n){this.max=n;return this}
  then(a,b){const label=this.table==='team_members'?(this.columns==='business_id'?'scope-members':this.columns==='id,business_id'?'page-members':'team'):this.table;
   return read(label,()=>{if(this.table==='business_subscriptions'&&controls.failSubscriptions)return{data:null,error:{message:'subscription unavailable'}};let rows=data[this.table].filter(r=>this.filters.every(f=>f(r))).slice(0,this.max);if(this.table==='team_members'&&controls.scopeDenied)rows=[];if(this.table==='social_accounts'&&controls.channelDisabled)rows=[];return{data:rows,error:null}},label==='team'?teamDelay:delay).then(a,b)}
 }
 const currentMember=React.cache(async()=>{const identity=authContext.getStore()??{userId:user,businessId:business,memberId:member};return{success:true,user:{id:identity.userId},member:{id:identity.memberId,business_id:identity.businessId}}});
 const pageResult=()=>({ids:[uuid(1)],matchedKnownIds:[],counts:{views:{all:2},statusCounts:{}},total:2,hasMore:false,cursor:null,readTargets:[]});
 let db={from:t=>new Query(t),rpc:async()=>read('page-rpc',()=>controls.pageError?{data:null,error:controls.pageError}:{data:pageResult(),error:null})},sdkQueries=0;
 if(sdkTransport){
  const {createDedupeFetch}=require('next/dist/server/lib/dedupe-fetch'),{createClient}=require('@supabase/supabase-js');
  const transport=createDedupeFetch(async(input,init)=>{const url=new URL(input),rpc=url.pathname.includes('/rpc/'),table=url.pathname.split('/').at(-1);return read(rpc?'page-rpc':table,()=>{
   const rows=rpc?pageResult():data[table].filter(row=>[...url.searchParams].every(([key,value])=>{if(!['eq.','in.'].some(prefix=>value.startsWith(prefix)))return true;if(value.startsWith('eq.'))return String(row[key])===value.slice(3);return value.slice(4,-1).split(',').includes(String(row[key]))}));
   return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Type':'application/json'}});
  },table==='team_members'&&url.searchParams.get('select')?.includes('full_name')?teamDelay:delay)});
  const client=createClient('https://fixture.invalid','sb_secret_offline_fixture',{global:{fetch:transport},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  db={from:t=>{sdkQueries++;return client.from(t)},rpc:(...args)=>{sdkQueries++;return client.rpc(...args)}};
 }
 const mocks={'@/lib/auth/get-current-member':{getCurrentMember:currentMember},'@/lib/supabase/admin':{supabaseAdmin:db},'@/components/inbox/inbox-view':{InboxView:'view'},'next/server':{after(){}}};
 if(baseline)mocks['@/lib/inbox/get-conversations']=loader(mocks,{console:{log(){},error(){}},URLSearchParams})(path.join(artifact,'inbox-entry-baseline-conversations.ts'));
 const load=loader(mocks,{console:{log(){},error(){}},URLSearchParams}),page=load(baseline?path.join(artifact,'inbox-entry-baseline-page.tsx'):'app/dashboard/inbox/page.tsx').default,helpers=load(baseline?path.join(artifact,'inbox-entry-baseline-conversations.ts'):'lib/inbox/get-conversations.ts');
 async function run(params={conversation:offPage?uuid(2):uuid(1),channel}){started=performance.now();return render(async()=>{const tree=await page({searchParams:Promise.resolve(params)});return tree.props.children.props.children.props})}
 return{run,calls,controls,helpers,load,data,sdkQueries:()=>sdkQueries};
}

test('authenticated entry starts independent team loading before paging finishes, and selected messages need not wait for team',async()=>{
 const f=fixture({delay:5,teamDelay:100});const props=await f.run();assert.equal(props.activeConversationId,uuid(1));assert.equal(props.messages.length,1);
 const team=f.calls.find(c=>c.label==='team'),rpc=f.calls.find(c=>c.label==='page-rpc'),messages=f.calls.find(c=>c.label==='messages');assert.ok(team.start<rpc.end,'team is independent of page RPC');assert.ok(messages.start<team.end,'authorized selected messages do not depend on assignment list');
});

test('same server render shares fresh scope, subscription and active-channel reads, including off-page selection',async()=>{
 for(const offPage of [false,true]){const f=fixture({offPage});const props=await f.run();assert.equal(props.activeConversationId,offPage?uuid(2):uuid(1));
 for(const label of ['scope-members','business_subscriptions','social_accounts'])assert.equal(f.calls.filter(c=>c.label===label).length,1,label+' must execute once per identical scope');
 assert.equal(props.pagination.page.ids.length,1,'selected off-page row does not expand page cursor');
 }
});

test('controlled entry comparison records actual loaded source counts and fixture timing',{skip:!artifact},async()=>{
 const results=[];
 for(const offPage of [false,true])for(const baseline of [true,false]){const f=fixture({baseline,offPage,delay:12,teamDelay:60}),start=performance.now();await f.run();results.push({baseline,offPage,reads:f.calls.length,elapsedMs:performance.now()-start,phases:f.calls,productionLatency:false});}
 console.log(JSON.stringify({entryReadComparison:results}));
 for(const offPage of [false,true]){const before=results.find(r=>r.baseline&&r.offPage===offPage),after=results.find(r=>!r.baseline&&r.offPage===offPage);assert.ok(after.reads<before.reads);}
});

test('next server render rechecks changed membership/channel state and fails closed on subscription failure',async()=>{
 const f=fixture();await f.run();let count=f.calls.length;f.controls.channelDisabled=true;let props=await f.run();assert.equal(props.activeConversationId,null);assert.equal(props.messages.length,0);assert.ok(f.calls.length>count);
 f.controls.channelDisabled=false;f.controls.scopeDenied=true;props=await f.run({});assert.equal(props.conversations.length,0);assert.equal(props.messages.length,0);
 f.controls.scopeDenied=false;f.controls.failSubscriptions=true;await assert.rejects(f.run(),/subscription access/);f.controls.failSubscriptions=false;assert.equal((await f.run()).activeConversationId,uuid(1));
});

test('overlapping server renders do not share another user or business scope',async()=>{
 const f=fixture({delay:5}),read=identity=>authContext.run(identity,()=>render(()=>f.helpers.getInboxConversationScope()));
 const [a,b]=await Promise.all([read({userId:user,businessId:business,memberId:member}),read({userId:uuid(999),businessId:uuid(998),memberId:uuid(997)})]);
 assert.deepEqual(Array.from(a.accessibleBusinessIds),[business]);assert.equal(b.accessibleBusinessIds.length,0);assert.equal(a.currentBusinessId,business);assert.equal(b.currentBusinessId,uuid(998));assert.equal(f.calls.filter(c=>c.label==='scope-members').length,2);
});

test('wrapped API requests share canonical tenant sets but recheck the next request and retry a rejected read',async()=>{
 const f=fixture(),other=uuid(901),{withRequestScope}=f.load('lib/server/request-scope.ts');
 f.data.team_members.push({id:uuid(801),business_id:other,user_id:user,is_active:true});f.data.business_subscriptions.push({...f.data.business_subscriptions[0],business_id:other,id:uuid(401)});
 const request=withRequestScope(async()=>{const scope=await f.helpers.getInboxConversationScope();await f.helpers.getInboxConversationScope();await f.helpers.getConversations(scope.accessibleBusinessIds,{conversationIds:[uuid(1)]});await f.helpers.getConversations([...scope.accessibleBusinessIds].reverse(),{conversationIds:[uuid(1)]});return scope});
 await request();for(const label of ['scope-members','business_subscriptions','social_accounts'])assert.equal(f.calls.filter(c=>c.label===label).length,1,label+' uses one request-local key');
 await request();assert.equal(f.calls.filter(c=>c.label==='scope-members').length,2);assert.equal(f.calls.filter(c=>c.label==='business_subscriptions').length,2);
 await withRequestScope(async()=>{f.controls.failSubscriptions=true;await assert.rejects(f.helpers.getInboxConversationScope());f.controls.failSubscriptions=false;assert.equal((await f.helpers.getInboxConversationScope()).accessibleBusinessIds.length,2)})();
});

test('installed Supabase plus Next GET dedupe separates helper invocation savings from transport savings',{skip:!artifact},async()=>{
 const results=[];
 for(const offPage of [false,true])for(const baseline of [true,false]){const f=fixture({baseline,offPage,sdkTransport:true,delay:12,teamDelay:60}),start=performance.now(),props=await f.run();assert.equal(props.activeConversationId,offPage?uuid(2):uuid(1));results.push({baseline,offPage,sdkQueries:f.sdkQueries(),transportRequests:f.calls.length,elapsedMs:performance.now()-start,productionLatency:false})}
 console.log(JSON.stringify({installedTransportComparison:results}));
 for(const offPage of [false,true]){const before=results.find(r=>r.baseline&&r.offPage===offPage),after=results.find(r=>!r.baseline&&r.offPage===offPage);assert.ok(after.sdkQueries<before.sdkQueries);assert.equal(after.transportRequests,before.transportRequests,'Next already deduplicates identical GET requests in this configuration');}
});

test('server page payload is unchanged for matching, off-page and canonical Inbox entry',{skip:!artifact},async()=>{
 for(const offPage of [false,true])for(const params of [{},{channel,conversation:offPage?uuid(2):uuid(1)}]){
  const before=await fixture({baseline:true,offPage}).run(params),after=await fixture({offPage}).run(params);assert.deepEqual(JSON.parse(JSON.stringify(after)),JSON.parse(JSON.stringify(before)));
 }
});

test('only missing paging migration permits legacy fallback; query failure reads no selected messages',async()=>{
 const missing=fixture({offPage:true});missing.controls.pageError={code:'PGRST202',message:'absent RPC'};const props=await missing.run();assert.equal(props.activeConversationId,uuid(2));assert.equal(props.pagination,undefined);assert.equal(props.conversations.length,2);
 const failed=fixture();failed.controls.pageError={code:'42501',message:'denied'};await assert.rejects(failed.run(),/Unable to query/);assert.equal(failed.calls.filter(c=>c.label==='messages').length,0);
});
