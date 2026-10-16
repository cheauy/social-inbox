/* eslint-disable @typescript-eslint/no-require-imports */
// Real route/service/SQL path; provider observations, users, money and HTTP are isolated fixtures.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const file=path.resolve('tests/bakong-api.test.cjs'),source=fs.readFileSync(file,'utf8'),moduleFixture={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('server quote"))+'\nmodule.exports={fixture};',{module:moduleFixture,require:createRequire(file),process,console,Request,Response,Buffer,setTimeout,__dirname:path.dirname(file)});
async function fixture(){const f=await moduleFixture.exports.fixture('production');try{await f.capacity();return f;}catch(error){await f.db.close();throw error;}}
const cancel=(f,id)=>f.load('app/api/subscription/cancel-payment/route.ts').POST(f.post('/api/subscription/cancel-payment',{kind:'bakong',paymentId:id,businessId:f.body.businessId,action:'cancel',confirmed:true}));
test('real routes allow 35 close/new cycles for one workspace without extra QR caps or provider inquiries',async()=>{
 const f=await fixture();try{
  const ids=new Set(),before=(await f.db.query('select row_to_json(s)::text body from business_subscriptions s where business_id=$1',[f.body.businessId])).rows[0].body;
  for(let i=0;i<35;i++){
   const started=await f.start();ids.add(started.attemptId);const original=(await (await f.read(started.attemptId)).json()).attempt.expiresAt;
   const closed=await cancel(f,started.attemptId);assert.equal(closed.status,200);assert.equal((await closed.json()).outcome,'checkout_closed');
   const saved=(await (await f.read(started.attemptId)).json()).attempt;assert.equal(saved.checkout,'cancelled');assert.equal(saved.qrImage,null);assert.equal(saved.expiresAt,original);
   const replay=await f.checkout.POST(f.post('/api/bakong/checkout',f.body));assert.equal(replay.status,409);assert.equal((await replay.json()).code,'CHECKOUT_CLOSED');
   f.body.purchaseIntent=randomUUID();
  }
  assert.equal(ids.size,35);assert.equal(f.state.calls,0);assert.equal((await f.db.query("select tenh_bakong_private.reserved_inquiries('production') n")).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.provider_calls')).rows[0].n,0);
  assert.equal((await f.db.query('select row_to_json(s)::text body from business_subscriptions s where business_id=$1',[f.body.businessId])).rows[0].body,before);
 }finally{await f.db.close();}
});
test('removed membership cannot close or release another saved checkout reservation',async()=>{
 const f=await fixture();try{
  const started=await f.start();await f.db.query('update team_members set is_active=false where id=$1',[f.memberId]);
  assert.equal((await cancel(f,started.attemptId)).status,403);assert.equal((await f.db.query('select count(*)::int n from payment_cancellations')).rows[0].n,0);assert.equal(f.state.calls,0);
  assert.equal((await f.db.query("select tenh_bakong_private.reserved_inquiries('production') n")).rows[0].n,3);
 }finally{await f.db.close();}
});
test('late payment is retained for review; admin reconciliation truthfully requires resolution without a second provider call',async()=>{
 const f=await fixture();try{
  const started=await f.start();assert.equal((await cancel(f,started.attemptId)).status,200);
  const checked=await f.check(started.attemptId);assert.equal(checked.status,200);const saved=(await checked.json()).attempt;assert.equal(saved.state,'review');assert.equal(saved.checkout,'cancelled');assert.equal(saved.application,'none');assert.equal(saved.qrImage,null);assert.equal(f.state.calls,1);
  f.state.admin=true;const response=await f.load('app/api/bakong/admin/route.ts').POST(f.post('/api/bakong/admin',{attemptId:started.attemptId,action:'reconcile'}));assert.equal(response.status,409);assert.equal((await response.json()).code,'SETTLEMENT_REVIEW_REQUIRED');assert.equal(f.state.calls,1);
  assert.equal((await f.db.query('select count(*)::int n from tenh_billing_invoices')).rows[0].n,0);
 }finally{await f.db.close();}
});
