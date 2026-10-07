const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader}=require('./tenh-seven/harness.cjs');
const f=require('./fixtures/analytics-metrics.cjs');
const good=()=>JSON.parse(fs.readFileSync('docs/evidence/analytics-redesign-20261007/fixture-results.json')).overview;
class Clock extends Date{constructor(...args){super(...(args.length?args:[f.snapshot]));}static now(){return Date.parse(f.snapshot);}}
function setup({denied=null,hidden=[],visibilityFailure=false,rpcFailure=false,data=good(),business=f.A}={}){
 const calls=[];
 const load=loader({'next/server':{NextResponse:{json:(data,init={})=>Response.json(data,init)}},'@/lib/auth/get-current-member':{getCurrentMember:async()=>denied?{success:false,status:denied,error:'Denied'}:{success:true,
  user:{id:f.U},member:{id:f.M1,user_id:f.U,business_id:business,role:'owner'}}},
  '@/lib/telegram-personal/visibility':{hiddenPersonalAccountIds:async()=>{if(visibilityFailure)throw Error('synthetic visibility unavailable');return hidden;}},
  '@/lib/supabase/admin':{supabaseAdmin:{rpc:async(name,args)=>{calls.push({name,args});return{data:rpcFailure?null:structuredClone(data),error:rpcFailure?{code:'PGRST202',message:'synthetic missing RPC'}:null};},
   from:()=>({select(){return this},eq(){return this},gte(){return this},lt(){return this},then(resolve){return Promise.resolve({data:null,error:null,count:0}).then(resolve)}})}},
 },{Date:Clock,URLSearchParams,console:{...console,error(){}}});
 const get=async(route='overview',query='period=yesterday&timezone=UTC&businessId='+business)=>{
  const response=await load(`app/api/analytics/${route}/route.ts`).GET({nextUrl:new URL('https://fixture.invalid/api/analytics/'+route+'?'+query)});
  return{status:response.status,body:await response.json(),headers:response.headers};
 };return{get,calls};
}
test('overview binds the server-selected workspace, authenticated member and user, with exact half-open bounds',async()=>{
 const s=setup(),r=await s.get();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(s.calls.length,1);
 const args=s.calls[0].args;assert.equal(args.p_business_id,f.A);assert.equal(args.p_member_id,f.M1);assert.equal(args.p_user_id,f.U);
 assert.equal(args.p_start,'2026-10-05T00:00:00.000Z');assert.equal(args.p_end,'2026-10-06T00:00:00.000Z');
 assert.equal(args.p_snapshot_at,'2026-10-06T12:00:00.000Z');
});
test('unauthorized, removed, mismatched workspace and invalid filters never invoke an aggregate',async()=>{
 for(const status of [401,403]){const s=setup({denied:status});assert.equal((await s.get()).status,status);assert.equal(s.calls.length,0);}
 for(const [query,status]of [['businessId='+f.B,409],['period=bad',400],['timezone=Not/AZone',400],['slaMinutes=0',400]]){
  const s=setup();assert.equal((await s.get('overview',query)).status,status);assert.equal(s.calls.length,0);
 }
});
test('absent proposal, null/partial aggregates and mismatched chart counts return unavailable rather than fabricated zeros',async()=>{
 for(const options of [{rpcFailure:true},{data:null},{data:{}},{data:{...good(),hours:[]}}]){
  const s=setup(options),r=await s.get();assert.equal(r.status,503);assert.equal(r.body.success,false);assert.equal('analytics'in r.body,false);assert.equal(s.calls.length,1);
  assert.doesNotMatch(r.body.error,/synthetic|PGRST202/);
 }
});
test('all legacy RPC reports reject hidden-channel totals BEFORE aggregation, and enforce selected workspace',async()=>{
 for(const route of ['sla','agents','customers','conversations']){
  const hidden=setup({hidden:[f.id(33)]});assert.equal((await hidden.get(route)).status,403);assert.equal(hidden.calls.length,0);
  const unknown=setup({visibilityFailure:true});assert.equal((await unknown.get(route)).status,503);assert.equal(unknown.calls.length,0);
  const mismatch=setup();assert.equal((await mismatch.get(route,'businessId='+f.B)).status,409);assert.equal(mismatch.calls.length,0);
 }
});
test('legacy missing/partial payloads fail rather than fill missing metrics with zero',async()=>{
 for(const route of ['sla','agents','customers','conversations']){
  for(const data of [null,{}, {summary:{slaMet:0,slaMissed:0,slaRate:100}}]){
   const s=setup({data});assert.equal((await s.get(route)).status,500);
  }
 }
});
test('legacy missing rates and chart arrays cannot produce empty charts or fabricated percentages',async()=>{
 const evidence=JSON.parse(fs.readFileSync('docs/evidence/analytics-redesign-20261007/fixture-results.json'));
 for(const route of ['sla','agents','customers','conversations']){
  const data=structuredClone(evidence.legacy[route]);delete data[route==='agents'?'agents':route==='customers'?'dailyGrowth':'daily'];
  assert.equal((await setup({data}).get(route)).status,500);
 }
 for(const route of ['sla','agents']){const data=structuredClone(evidence.legacy[route]);delete data.summary.slaRate;assert.equal((await setup({data}).get(route)).status,500);}
});
test('zero denominators in legacy Team/Agent API payloads are normalized without changing populated report definitions',async()=>{
 const evidence=JSON.parse(fs.readFileSync('docs/evidence/analytics-redesign-20261007/fixture-results.json'));
 for(const route of ['sla','agents']){
  const data=structuredClone(evidence.legacy[route]);data.summary.slaMet=0;data.summary.slaMissed=0;data.summary.slaRate=100;
  if(route==='agents')data.summary.totalOutgoing=0;
  const r=await setup({data}).get(route);assert.equal(r.status,200);assert.equal(r.body.analytics.summary.slaRate,null);
  if(route==='agents')assert.equal(r.body.analytics.summary.attributionRate,null);
 }
});
