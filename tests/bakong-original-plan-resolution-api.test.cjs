/* eslint-disable @typescript-eslint/no-require-imports */
// Real local route/service/SQL; synthetic receipt observations only. No real auth/provider calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const file=path.resolve('tests/bakong-closed-accounting-api.test.cjs'),source=fs.readFileSync(file,'utf8'),fixtureModule={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('real routes"))+'\nmodule.exports={fixture,cancel};',{module:fixtureModule,require:createRequire(file),process,console,Request,Response,Buffer,setTimeout,__dirname:path.dirname(file)});
async function fixture(){const f=await fixtureModule.exports.fixture();try{const started=await f.start();await fixtureModule.exports.cancel(f,started.attemptId);const received=await f.check(started.attemptId);assert.equal(received.status,200);f.attempt=(await received.json()).attempt;f.state.admin=true;f.admin=f.load('app/api/bakong/admin/route.ts');return f;}catch(error){await f.db.close();throw error;}}
const request=(f,extra={})=>({attemptId:f.attempt.id,action:'apply_original_plan',requestId:randomUUID(),reason:'Reviewed exact original received-money evidence and no overlapping purchases.',expectedTransactionReference:f.attempt.transactionReference,confirmed:true,...extra});
const apply=(f,body)=>f.admin.POST(f.post('/api/bakong/admin',body));
const state=async f=>JSON.stringify((await f.db.query('select row_to_json(s)::text body from business_subscriptions s where business_id=$1',[f.body.businessId])).rows[0].body);
test('admin preview is advisory; explicit confirmed application uses the authenticated admin identity and applies once without another provider inquiry',async()=>{
 const f=await fixture();try{
  const items=(await (await f.admin.GET(new Request('https://app.tenhchat.com/api/bakong/admin'))).json()).items;assert.equal(items[0].canApplyOriginal,true);assert.equal(items[0].planCode,'mini');
  const body=request(f),response=await apply(f,body);assert.equal(response.status,200);const first=await response.json();assert.equal(first.outcome,'applied');assert.ok(first.invoiceId);const after=await state(f);
  const replay=await apply(f,body);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),first);assert.equal(await state(f),after);assert.equal(f.state.calls,1);
  const audit=(await f.db.query('select actor_user_id,reason from tenh_bakong_private.late_application_resolutions')).rows[0];assert.equal(audit.actor_user_id,f.userId);assert.equal(audit.reason,body.reason);
 }finally{await f.db.close();}
});
test('a changed subscription after preview remains a clear audited conflict rather than overwriting the new baseline',async()=>{
 const f=await fixture();try{
  assert.equal((await (await f.admin.GET(new Request('https://app.tenhchat.com/api/bakong/admin'))).json()).items[0].canApplyOriginal,true);
  await f.db.query('update business_subscriptions set member_limit=member_limit+1 where business_id=$1',[f.body.businessId]);const before=await state(f),response=await apply(f,request(f));assert.equal(response.status,409);assert.equal((await response.json()).code,'SUBSCRIPTION_BASELINE_CHANGED');assert.equal(await state(f),before);assert.equal(f.state.calls,1);
 }finally{await f.db.close();}
});
test('current admin permission, same-origin mutation and explicit reason/confirmation are required before resolution',async()=>{
 const f=await fixture();try{
  const before=await state(f);f.state.admin=false;assert.equal((await apply(f,request(f))).status,403);f.state.admin=true;
  assert.equal((await f.admin.POST(f.post('/api/bakong/admin',request(f),{Origin:'https://evil.invalid'}))).status,403);
  for(const extra of [{confirmed:false},{reason:'short'},{actorId:randomUUID()},{planCode:'pro'},{amount:'0.01'},{requestId:'invalid'}])assert.equal((await apply(f,request(f,extra))).status,400);
  assert.equal((await apply(f,request(f,{expectedTransactionReference:'b'.repeat(64)}))).status,409);assert.equal(await state(f),before);assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.late_application_resolutions')).rows[0].n,0);assert.equal(f.state.calls,1);
 }finally{await f.db.close();}
});
test('lost acknowledgement is recovered by the same idempotency key with one invoice and no repeat financial application',async()=>{
 const f=await fixture();try{
  const original=f.pg.rpc.bind(f.pg);let lost=false;f.pg.rpc=async(name,args)=>{const result=await original(name,args);if(name==='tenh_apply_reviewed_bakong_original_plan'&&!lost&&!result.error){lost=true;return{data:null,error:{code:'NETWORK'}};}return result;};
  const body=request(f),uncertain=await apply(f,body);assert.equal(uncertain.status,503);assert.equal((await uncertain.json()).code,'RESOLUTION_UNCERTAIN');const after=await state(f);
  const retry=await apply(f,body);assert.equal(retry.status,200);assert.equal((await retry.json()).outcome,'applied');assert.equal(await state(f),after);assert.equal((await f.db.query('select count(*)::int n from tenh_billing_invoices')).rows[0].n,1);assert.equal((await f.db.query("select count(*)::int n from tenh_bakong_private.late_application_resolutions where outcome='applied'")).rows[0].n,1);assert.equal(f.state.calls,1);
 }finally{await f.db.close();}
});
