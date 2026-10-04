const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
const NOW='2026-10-04T03:00:00.000Z',at=seconds=>new Date(Date.parse(NOW)+seconds*1000).toISOString();
class Clock extends Date{constructor(...args){super(...(args.length?args:[NOW]))}static now(){return Date.parse(NOW)}}
function setup({business='a',denied=0,previousFailure=false,messageFailure=false,delayMs=0,conversations=5}={}){
 const rows=Array.from({length:conversations},(_,i)=>({id:'c'+i,business_id:business,social_account_id:i===3?'tg':'fb',platform:i===3?'telegram':'facebook',source_type:i===2?'comment':'messenger',status:i===1?'closed':'open',unread_count:i===0?2:0,assigned_to:i===1?'staff':null,contact_id:'p'+i,created_at:at(-1000+i)}));
 const messages=[
  ['c0','incoming',-590,-600],['c0','incoming',-580,null],['c0','outgoing',-460,-450],['c0','outgoing',30,null],
  ['c1','outgoing',-900,null],['c1','incoming',-500,null],['c2','incoming',-80,null],['c2','outgoing',-5,null],
  ['c3','incoming',-200,'invalid'],['c3','outgoing',-100,null],['c4','incoming',-1,null],['c0','system',-20,null],
 ].map(([conversation_id,direction,created,platform])=>({id:Math.random().toString(),business_id:business,conversation_id,direction,created_at:at(created),platform_created_at:typeof platform==='number'?at(platform):platform}));
 messages.push({id:'invalid',business_id:business,conversation_id:'c0',direction:'incoming',created_at:'invalid',platform_created_at:'invalid'});
 const tables={conversations:rows,messages,social_accounts:[{id:'fb',business_id:business,platform:'facebook',account_name:'Page'},{id:'tg',business_id:business,platform:'telegram',account_name:'Bot'}]},calls=[];
 class Query{
  constructor(table){this.table=table;this.filters=[];this.head=false;this.ordering=[];this.signal=null}
  select(_,o){this.head=Boolean(o?.head);return this}eq(k,v){this.filters.push([k,'eq',v]);return this}in(k,v){this.filters.push([k,'in',v]);return this}gte(k,v){this.filters.push([k,'gte',v]);return this}lt(k,v){this.filters.push([k,'lt',v]);return this}or(){return this}order(k){this.ordering.push(k);return this}abortSignal(s){this.signal=s;return this}
  range(a,b){return this.read(a,b)}then(a,b){return this.read().then(a,b)}
  async read(a=0,b=Infinity){calls.push({table:this.table,head:this.head,filters:this.filters,from:a,to:b,signal:this.signal});
   assert.ok(this.filters.some(([k,op,v])=>k==='business_id'&&op==='eq'&&v===business),'every query scoped to current authenticated business');
   if(delayMs&&this.table==='messages')await new Promise(r=>setTimeout(r,delayMs));
   if(this.head&&previousFailure)return{data:null,count:null,error:{message:'previous failed'}};
   if(this.table==='messages'&&messageFailure)return{data:null,error:{message:'message failed'}};
   let data=tables[this.table].filter(row=>this.filters.every(([k,op,v])=>op==='eq'?row[k]===v:op==='in'?v.includes(row[k]):op==='gte'?row[k]>=v:row[k]<v));
   data.sort((a,b)=>{for(const k of this.ordering){if(a[k]!==b[k])return String(a[k]).localeCompare(String(b[k]))}return 0});
   return this.head?{data:null,count:data.length,error:null}:{data:data.slice(a,b+1),error:null};
  }
 }
 const load=loader({'@/lib/auth/get-current-member':{getCurrentMember:async()=>denied?{success:false,status:denied,error:'denied'}:{success:true,user:{id:'user-'+business},member:{id:'member-'+business,business_id:business}}},'@/lib/supabase/admin':{supabaseAdmin:{from:table=>new Query(table)}}},{Date:Clock,AbortController});
 const get=async({signal,route='app/api/analytics/channels/route.ts',query='period=7d'}={})=>{
  const response=await load(route).GET({nextUrl:new URL('https://fixture.invalid/api/analytics/channels?'+query),signal});return{status:response.status,body:await response.json()};
 };
 return{get,calls,load};
}
test('Channel metrics preserve full history, recovered timestamps, comments, unanswered means and SLA',async()=>{
 const f=setup(),result=await f.get();assert.equal(result.status,200);assert.equal(result.body.summary.conversations,4);assert.equal(result.body.summary.incomingMessages,6);assert.equal(result.body.summary.outgoingReplies,5);
 assert.equal(result.body.summary.avgFirstResponseSeconds,125);assert.equal(result.body.summary.answered,2);assert.equal(result.body.summary.unanswered,2);assert.equal(result.body.summary.slaRate,100);
 const comments=result.body.channels.find(c=>c.sourceType==='comment');assert.equal(comments.conversations,1);assert.equal(comments.avgFirstResponseSeconds,75);
 const sla=await setup().get({query:'period=7d&slaMinutes=1'});assert.equal(sla.body.summary.slaRate,0);
 if(process.env.CHANNEL_ANALYTICS_BASELINE_ROUTE){const before=await setup().get({route:process.env.CHANNEL_ANALYTICS_BASELINE_ROUTE});assert.deepEqual(result.body,before.body);}
 assert.ok(f.calls.filter(c=>c.table==='messages').every(c=>c.filters.some(([k,op,v])=>k==='direction'&&op==='in'&&v.join(',')==='incoming,outgoing')));
});
test('unauthorized and removed members perform no analytics reads',async()=>{
 for(const status of [401,403]){const f=setup({denied:status});const result=await f.get();assert.equal(result.status,status);assert.equal(result.body.success,false);assert.equal(f.calls.length,0);}
});
test('previous count failure remains unknown while message failure never returns partial statistics',async()=>{
 const previous=await setup({previousFailure:true}).get();assert.equal(previous.status,200);assert.equal(previous.body.summary.previousConversations,null);assert.equal(previous.body.summary.conversationsChangePercent,null);
 const f=setup({messageFailure:true,conversations:601,delayMs:5});const result=await f.get();assert.equal(result.status,500);assert.equal(result.body.success,false);assert.equal(result.body.summary,undefined);assert.ok(f.calls.filter(c=>c.table==='messages').length<=2,'failed worker retires queued chunks');
});
test('aborted client results retire queued chunks and do not cancel another user/business request',async()=>{
 const a=setup({business:'a',conversations:601,delayMs:15}),b=setup({business:'b',delayMs:15}),controller=new AbortController();
 const pendingA=a.get({signal:controller.signal}),pendingB=b.get();setTimeout(()=>controller.abort(),5);
 const[ra,rb]=await Promise.all([pendingA,pendingB]);assert.equal(ra.body.success,false);assert.equal(ra.body.summary,undefined);assert.equal(rb.body.success,true);assert.equal(rb.body.businessId,'b');assert.ok(a.calls.filter(c=>c.table==='messages').length<=2);
});
test('strict row helper distinguishes exact cap from overflow and preserves legacy callers',async()=>{
 const{fetchAllRows}=loader()('lib/supabase/fetch-all-rows.ts');let calls=0;
 const query=size=>()=>({range:async(a,b)=>{calls++;return{data:Array.from({length:Math.max(0,Math.min(size,b+1)-a)},(_,i)=>({id:a+i})),error:null}}});
 assert.equal((await fetchAllRows(query(2),{maxRows:2,requireComplete:true})).error,null);assert.equal(calls,2);
 assert.match((await fetchAllRows(query(3),{maxRows:2,requireComplete:true})).error.message,/row limit/);
 assert.equal((await fetchAllRows(query(3),{maxRows:2})).error,null);
 const controller=new AbortController();controller.abort();const prior=calls;assert.match((await fetchAllRows(query(3),{maxRows:2,requireComplete:true,signal:controller.signal})).error.message,/cancelled/);assert.equal(calls,prior);
});
test('streaming message reader folds bounded pages and rejects overflow instead of reporting a partial aggregate',async()=>{
 for(const overflow of [false,true]){
  const calls=[];let folded=0,maxFold=0;
  const client={from(){const q={select:()=>q,eq:(k,v)=>{assert.equal(k,'business_id');assert.equal(v,'a');return q},in:()=>q,order:()=>q,abortSignal:()=>q,range:async(a,b)=>{calls.push([a,b]);return{data:a<200000?Array(1000).fill({}):overflow?[{}]:[],error:null}}};return q}};
  const{readChannelMessages}=loader({'@/lib/supabase/admin':{supabaseAdmin:client}},{AbortController})('lib/analytics/read-channel-messages.ts');
  const pending=readChannelMessages('a',['c0'],rows=>{folded+=rows.length;maxFold=Math.max(maxFold,rows.length)});
  if(overflow)await assert.rejects(pending,/row limit/);else await pending;
  assert.equal(folded,200000);assert.equal(maxFold,1000);assert.equal(calls.length,201);assert.deepEqual(calls.at(-1),[200000,200000]);
 }
});
