const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader}=require('./tenh-seven/harness.cjs'),f=require('./fixtures/analytics-metrics.cjs');
const metrics=loader()('lib/analytics/overview-metrics.ts');
class Clock extends Date{constructor(...args){super(...(args.length?args:[f.snapshot]))}static now(){return Date.parse(f.snapshot)}}
test('calendar ranges clamp month ends, handle leap years and keep the defined timezone',()=>{
 const range=(period,now=f.snapshot,zone='UTC')=>metrics.overviewRange(period,new Date(now),zone);
 assert.equal(range('3m').start.toISOString(),'2026-07-06T00:00:00.000Z');
 assert.equal(range('6m').start.toISOString(),'2026-04-06T00:00:00.000Z');
 assert.equal(range('1y').start.toISOString(),'2025-10-06T00:00:00.000Z');
 assert.equal(range('6m','2026-08-31T12:00:00Z').start.toISOString(),'2026-02-28T00:00:00.000Z');
 assert.equal(range('1y','2024-02-29T12:00:00Z').start.toISOString(),'2023-02-28T00:00:00.000Z');
 assert.equal(range('3m',f.snapshot,'Asia/Saigon').start.toISOString(),'2026-07-05T17:00:00.000Z');
 const fallback={start:new Date(f.start),end:new Date(f.end),label:'Yesterday',periodDays:1};
 const long=metrics.explicitAnalyticsRange(new URLSearchParams('period=6m&timezone=UTC'),new Date(f.snapshot),fallback);
 assert.equal(long.start.toISOString(),'2026-04-06T00:00:00.000Z');assert.equal(long.label,'Last 6 months');assert.equal(long.periodDays,184);
 assert.equal(metrics.explicitAnalyticsRange(new URLSearchParams('period=6m&timezone=Bad/Zone'),new Date(f.snapshot),fallback),null);
 assert.equal(metrics.explicitAnalyticsRange(new URLSearchParams('start=2024-01-01&end=2026-01-01'),new Date(f.snapshot),fallback),null);
 const exact=metrics.explicitAnalyticsRange(new URLSearchParams('period=1y&start=2025-10-06T00:00:00Z&end=2026-10-06T12:00:00Z'),new Date(f.snapshot),fallback);
 assert.equal(exact.start.toISOString(),'2025-10-06T00:00:00.000Z');assert.equal(exact.label,'Last year');
});
function routeFixture(route){const evidence=JSON.parse(fs.readFileSync('docs/evidence/analytics-redesign-20261007/fixture-results.json')),calls=[];
 const load=loader({'next/server':{NextResponse:{json:(data,init={})=>Response.json(data,init)}},'@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,user:{id:f.U},member:{id:f.M1,business_id:f.A,role:'owner'}})},'@/lib/telegram-personal/visibility':{hiddenPersonalAccountIds:async()=>[]},'@/lib/supabase/admin':{supabaseAdmin:{rpc:async(name,args)=>{calls.push({name,args});return{data:structuredClone(route==='overview'?evidence.overview:evidence.legacy[route]),error:null}},from:()=>({select(){return this},eq(){return this},gte(){return this},lt(){return this},then(resolve){return Promise.resolve({data:null,error:null,count:0}).then(resolve)}})}}},{Date:Clock,URLSearchParams});
 return{calls,get:async period=>{const r=await load('app/api/analytics/'+route+'/route.ts').GET({nextUrl:new URL('https://fixture.invalid?period='+period+'&timezone=UTC&businessId='+f.A)});return{status:r.status,body:await r.json()};}};
}
test('overview makes one aggregate call for the full selected 3/6-month or yearly range',async()=>{
 for(const [period,start]of [['3m','2026-07-06T00:00:00.000Z'],['6m','2026-04-06T00:00:00.000Z'],['1y','2025-10-06T00:00:00.000Z']]){
  const s=routeFixture('overview'),r=await s.get(period);assert.equal(r.status,200);assert.equal(r.body.period,period);assert.equal(s.calls.length,1);assert.equal(s.calls[0].args.p_start,start);assert.equal(s.calls[0].args.p_end,'2026-10-06T12:00:00.000Z');
 }
});
test('existing RPC drilldowns keep long-period identity and exact bounds',async()=>{
 for(const route of ['sla','agents','customers','conversations']){
  const s=routeFixture(route),r=await s.get('6m');assert.equal(r.status,200);assert.equal(r.body.period,'6m');assert.equal(r.body.start,'2026-04-06T00:00:00.000Z');assert.equal(r.body.end,'2026-10-06T12:00:00.000Z');assert.equal(s.calls[0].args.p_start,r.body.start);assert.equal(s.calls[0].args.p_end,r.body.end);
  if(route==='customers'||route==='conversations')assert.equal(r.body.periodLabel,'Last 6 months');
 }
});
