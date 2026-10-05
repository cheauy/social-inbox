// Run with: node --conditions=react-server --test tests/inbox-return-read-lifecycle.rsc.cjs
// Real installed React/Flight request caches; bounded data/transport fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const React=require('react'),rsc=require('next/dist/compiled/react-server-dom-webpack/server.node');
const {tick}=require('./inbox-recovery-harness.cjs');
const {AsyncLocalStorage}=require('node:async_hooks'),{loader,uuid}=require('./inbox-recovery-harness.cjs');
const authContext=new AsyncLocalStorage(),business=uuid(900),channel=uuid(700),member=uuid(800),user=uuid(600);
const artifact=process.env.TENH_RETURN_LATENCY_BASELINE_DIR;
async function render(read){let value,error;async function Probe(){value=await read();return 'done'}const stream=await rsc.renderToReadableStream(React.createElement(Probe),{}, {onError:e=>{error=e}});const reader=stream.getReader();for(;;){const chunk=await reader.read();if(chunk.done)break}if(error)throw error;return value;}
function fixture({baseline=false,delay=0,teamDelay=delay,offPage=false,sdkTransport=false,multipleWorkspaces=false}={}){
 const calls=[],controls={scopeDenied:false,channelDisabled:false,failSubscriptions:false,pageError:null,failChannels:false,failTags:false,failMessages:false,pageEmpty:false,authDenied:false,holds:new Map()};let started=performance.now();
 const row=n=>({id:uuid(n),business_id:business,social_account_id:channel,contact:{id:uuid(300+n),business_id:business,full_name:"Fixture"},social_account:{id:channel,platform:'telegram'},status:'open',is_pinned:false,unread_count:0,last_message_at:'2026-10-04T00:00:00Z'});
 const data={contact_tags:[],team_members:[{id:member,business_id:business,user_id:user,is_active:true,full_name:'Fixture'}],business_subscriptions:[{id:uuid(400),business_id:business,status:'active',current_period_end:'2027-01-01T00:00:00Z',created_at:'2026-01-01'}],
  social_accounts:[{id:channel,business_id:business,is_active:true,platform:'telegram',telegram_token_status:'verified'}],inbox_saved_views:[],conversations:[row(1),row(2)],messages:[{id:uuid(100),conversation_id:offPage?uuid(2):uuid(1),business_id:business,platform_created_at:'2026-10-04T00:00:00Z',created_at:'2026-10-04T00:00:00Z'}]};
 if(multipleWorkspaces){data.team_members.push({...data.team_members[0],id:uuid(801),business_id:uuid(901)});data.business_subscriptions.push({...data.business_subscriptions[0],id:uuid(401),business_id:uuid(901)});data.social_accounts.push({...data.social_accounts[0],id:uuid(701),business_id:uuid(901)});}
 async function read(label,fn,wait=delay){const entry={label,start:performance.now()-started};calls.push(entry);if(controls.holds.has(label))await controls.holds.get(label);if(label==='contact_tags')wait=delay*3;if(label==='social_accounts')wait=delay*4;if(label==='page-rpc')wait=delay*10;if(wait)await new Promise(r=>setTimeout(r,wait));const result=fn();entry.end=performance.now()-started;return result}
 class Query{
  constructor(table){this.table=table;this.columns='';this.filters=[];this.max=Infinity}select(c){this.columns=c;return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}in(k,v){this.filters.push(r=>v.includes(r[k]));return this}order(){return this}limit(n){this.max=n;return this}
  then(a,b){const label=this.table==='team_members'?(this.columns==='business_id'?'scope-members':this.columns==='id,business_id'?'page-members':'team'):this.table;
   return read(label,()=>{if(this.table==='contact_tags'&&controls.failTags)return{data:null,error:{message:'tags unavailable'}};if(this.table==='messages'&&controls.failMessages)return{data:null,error:{message:'messages unavailable'}};if(this.table==='social_accounts'&&controls.failChannels)return{data:null,error:{message:'channels unavailable'}};if(this.table==='business_subscriptions'&&controls.failSubscriptions)return{data:null,error:{message:'subscription unavailable'}};let rows=data[this.table].filter(r=>this.filters.every(f=>f(r))).slice(0,this.max);if(this.table==='team_members'&&controls.scopeDenied)rows=[];if(this.table==='social_accounts'&&controls.channelDisabled)rows=[];return{data:rows,error:null}},label==='team'?teamDelay:delay).then(a,b)}
 }
 const currentMember=React.cache(async()=>{const identity=authContext.getStore()??{userId:user,businessId:business,memberId:member};if(controls.authDenied)return{success:false,status:401,error:'Unauthorized.'};return{success:true,user:{id:identity.userId},member:{id:identity.memberId,business_id:identity.businessId}}});
 const pageResult=()=>({ids:controls.pageEmpty?[]:[uuid(1)],matchedKnownIds:[],counts:{views:{all:2},statusCounts:{}},total:2,hasMore:false,cursor:null,readTargets:[]});
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
 if(baseline){const baseLoad=loader(mocks,{console:{log(){},error(){}},URLSearchParams});mocks['./get-search-matches']=baseLoad('lib/inbox/get-search-matches.ts');mocks['@/lib/inbox/get-conversations']=baseLoad(path.join(artifact,'inbox-return-latency-baseline-conversations.ts'));mocks['@/lib/inbox/get-conversation-page']=loader(mocks,{console:{log(){},error(){}},URLSearchParams})(path.join(artifact,'inbox-return-latency-baseline-page-helper.ts'));}
 const load=loader(mocks,{console:{log(){},error(){}},URLSearchParams}),page=load(baseline?path.join(artifact,'inbox-return-latency-baseline-page.tsx'):'app/dashboard/inbox/page.tsx').default,helpers=load(baseline?path.join(artifact,'inbox-return-latency-baseline-conversations.ts'):'lib/inbox/get-conversations.ts');
 async function run(params={conversation:offPage?uuid(2):uuid(1),channel}){started=performance.now();return render(async()=>{const tree=await page({searchParams:Promise.resolve(params)});return tree.props.children.props.children.props})}
 return{run,calls,controls,helpers,load,data,sdkQueries:()=>sdkQueries};
}

test('saved-thread return starts channel metadata while paging is still pending',async()=>{
 const f=fixture();let release;f.controls.holds.set('page-rpc',new Promise(r=>release=r));const pending=f.run();
 try{for(let n=0;n<30&&!f.calls.some(c=>c.label==='page-rpc');n++)await tick();assert.ok(f.calls.some(c=>c.label==='page-rpc'));assert.equal(f.calls.filter(c=>c.label==='social_accounts').length,1,'channel metadata must start before the page RPC completes');}
 finally{release();await pending}
 assert.equal(f.calls.filter(c=>c.label==='social_accounts').length,1,'hydration consumes the same request-local read');
});

test('invalid or absent selection keeps the existing demand-driven metadata path',async()=>{
 for(const params of [{},{conversation:'invalid'}]){const f=fixture();let release;f.controls.holds.set('page-rpc',new Promise(r=>release=r));const pending=f.run(params);
 try{for(let n=0;n<30&&!f.calls.some(c=>c.label==='page-rpc');n++)await tick();assert.equal(f.calls.filter(c=>c.label==='social_accounts').length,0);}
 finally{release();await pending}
 }
});

test('freshly authorized selected messages overlap contact tags and are loaded only once',async()=>{
 for(const offPage of [false,true]){const f=fixture({offPage});let release;f.controls.holds.set('contact_tags',new Promise(r=>release=r));const pending=f.run();
 try{for(let n=0;n<30&&!f.calls.some(c=>c.label==='contact_tags');n++)await tick();assert.ok(f.calls.some(c=>c.label==='contact_tags'));if(!offPage)assert.equal(f.calls.filter(c=>c.label==='messages').length,1,'selected message page must not wait for tags');}
 finally{release();const props=await pending;assert.equal(props.messages.length,1)}
 assert.equal(f.calls.filter(c=>c.label==='messages').length,1);
 }
 const unrelated=fixture();await unrelated.run({conversation:uuid(999)});assert.equal(unrelated.calls.filter(c=>c.label==='messages').length,0);
});

test('tag failure retains the existing empty-tag fallback; message failures return no partial Inbox',async()=>{
 const tags=fixture();tags.controls.failTags=true;const props=await tags.run();assert.equal(props.messages.length,1);assert.equal(props.conversations[0].contact.tags.length,0);await tick();
 const messages=fixture();messages.controls.failMessages=true;await assert.rejects(messages.run(),/messages/);await tick();assert.equal(messages.calls.filter(c=>c.label==='messages').length,1);
 const both=fixture();both.controls.failTags=both.controls.failMessages=true;await assert.rejects(both.run(),/messages/);await tick();
});

test('return keeps channel/subscription/auth failures closed and metadata rejection observed',async()=>{
 const denied=fixture();denied.controls.authDenied=true;await assert.rejects(denied.run(),/Unauthorized/);assert.equal(denied.calls.length,0);
 const subscriptions=fixture();subscriptions.controls.failSubscriptions=true;await assert.rejects(subscriptions.run(),/subscription access/);assert.equal(subscriptions.calls.filter(c=>c.label==='social_accounts').length,0);
 const disabled=fixture();disabled.controls.channelDisabled=true;const props=await disabled.run();assert.equal(props.activeConversationId,null);assert.equal(props.messages.length,0);
 const failure=fixture();failure.controls.failChannels=true;await assert.rejects(failure.run(),/active TENH channels/);assert.equal(failure.calls.filter(c=>c.label==='messages').length,0);
 const pageFailure=fixture();pageFailure.controls.failChannels=true;pageFailure.controls.pageError={code:'42501',message:'denied'};await assert.rejects(pageFailure.run(),/Unable to query/);await tick();assert.equal(pageFailure.calls.filter(c=>c.label==='messages').length,0);
});

test('next render rechecks revoked channel state; overlapping users do not share warm reads',async()=>{
 const f=fixture();assert.equal((await f.run()).activeConversationId,uuid(1));f.controls.channelDisabled=true;assert.equal((await f.run()).activeConversationId,null);assert.equal(f.calls.filter(c=>c.label==='social_accounts').length,2);
 const other=fixture();const [a,b]=await Promise.all([other.run(),authContext.run({userId:uuid(999),businessId:uuid(998),memberId:uuid(997)},()=>other.run())]);assert.equal(a.activeConversationId,uuid(1));assert.equal(b.activeConversationId,null);assert.equal(b.messages.length,0);
});

test('exact production and candidate return payloads match, including paging fallback',{skip:!artifact},async()=>{
 for(const offPage of [false,true])for(const pageEmpty of [false,true]){const before=fixture({baseline:true,offPage}),after=fixture({offPage});before.controls.pageEmpty=after.controls.pageEmpty=pageEmpty;assert.deepEqual(JSON.parse(JSON.stringify(await after.run())),JSON.parse(JSON.stringify(await before.run())))}
 for(const baseline of [true,false]){const f=fixture({baseline,offPage:true});f.controls.pageError={code:'PGRST202',message:'migration absent'};const props=await f.run();assert.equal(props.pagination,undefined);assert.equal(props.activeConversationId,uuid(2));assert.equal(props.messages.length,1);}
});

test('installed SDK/Next transport records same normal request budget and overlapping wait',{skip:!artifact},async()=>{
 const results=[];for(const offPage of [false,true])for(const baseline of [true,false]){const f=fixture({baseline,offPage,sdkTransport:true,delay:15}),start=performance.now();await f.run();results.push({baseline,offPage,sdkQueries:f.sdkQueries(),transportRequests:f.calls.length,elapsedMs:performance.now()-start,phases:f.calls,productionLatency:false})}
 console.log(JSON.stringify({returnTransportComparison:results}));for(const offPage of [false,true]){const before=results.find(r=>r.baseline&&r.offPage===offPage),after=results.find(r=>!r.baseline&&r.offPage===offPage);assert.equal(after.sdkQueries,before.sdkQueries);assert.equal(after.transportRequests,before.transportRequests);assert.ok(after.phases.find(p=>p.label==='social_accounts').start<after.phases.find(p=>p.label==='page-rpc').end);assert.ok(after.phases.find(p=>p.label==='messages').start<after.phases.findLast(p=>p.label==='contact_tags').end);}
});

test('multiple authorized workspaces and an empty filtered page add no channel request for off-page selection',{skip:!artifact},async()=>{
 const results=[];for(const baseline of [true,false]){const f=fixture({baseline,offPage:true,sdkTransport:true,multipleWorkspaces:true});f.controls.pageEmpty=true;const props=await f.run({conversation:uuid(2),channel,workspace:business});assert.equal(props.activeConversationId,uuid(2));assert.equal(props.messages.length,1);assert.equal(props.pagination.page.ids.length,0);results.push({baseline,sdkQueries:f.sdkQueries(),transportRequests:f.calls.length,channelRequests:f.calls.filter(c=>c.label==='social_accounts').length,props});}
 console.log(JSON.stringify({emptyFilteredReturnBudget:results.map(({props,...counts})=>counts)}));assert.deepEqual(JSON.parse(JSON.stringify(results[1].props)),JSON.parse(JSON.stringify(results[0].props)));assert.equal(results[0].transportRequests,11);assert.equal(results[1].transportRequests,results[0].transportRequests);assert.equal(results[1].channelRequests,1,'do not prefetch all-workspace metadata before a one-workspace lookup');
});

test('explicit workspace narrowing keeps channel hydration demand-driven without relaxing scope keys',async()=>{
 for(const pageEmpty of [false,true]){const f=fixture({multipleWorkspaces:true,offPage:true});f.controls.pageEmpty=pageEmpty;let release;f.controls.holds.set('page-rpc',new Promise(r=>release=r));const pending=f.run({conversation:uuid(2),channel,workspace:business});
 try{for(let n=0;n<30&&!f.calls.some(c=>c.label==='page-rpc');n++)await tick();assert.equal(f.calls.filter(c=>c.label==='social_accounts').length,0,'cannot predict broad page hydration versus narrowed off-page scope before paging');}
 finally{release();const props=await pending;assert.equal(props.activeConversationId,uuid(2));assert.equal(props.accessibleBusinessIds.length,2)}
 }
 const foreign=fixture({multipleWorkspaces:true});foreign.controls.pageEmpty=true;foreign.data.conversations.push({...foreign.data.conversations[1],id:uuid(3),business_id:uuid(902),social_account_id:uuid(702)});foreign.data.social_accounts.push({...foreign.data.social_accounts[0],id:uuid(702),business_id:uuid(902)});const props=await foreign.run({conversation:uuid(3),channel:uuid(702),workspace:business});assert.equal(props.activeConversationId,null);assert.equal(props.messages.length,0);
});

