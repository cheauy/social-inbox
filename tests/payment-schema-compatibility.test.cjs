/* eslint-disable @typescript-eslint/no-require-imports */
// Real isolated PostgreSQL and existing auth fixtures. No network, hosted records or bank calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const {loader}=require('./tenh-seven/harness.cjs');
function fixtureModule(name,marker,names){
 const file=path.resolve('tests',name),source=fs.readFileSync(file,'utf8'),fixture={exports:{}};
 vm.runInNewContext(source.slice(0,source.indexOf(marker))+`\nmodule.exports={${names}};`,{module:fixture,require:createRequire(file),process,console,Request,Response,Headers,URLSearchParams,Buffer,setTimeout,clearTimeout});
 return fixture.exports;
}
const api=fixtureModule('bakong-api.test.cjs',"test('server quote",'fixture');
const savedStatus=fixtureModule('billing-payment-attempt.test.cjs',"test('one persisted",'route,saved,businessId,manualId');

test('KHQR release is independent while other cancellation remains disabled',()=>{
 assert.equal(loader()('lib/billing/payment-cancellation-feature.ts').KHQR_CHECKOUT_ENABLED,true);
 assert.equal(loader()('lib/billing/payment-cancellation-feature.ts').PAYMENT_CANCELLATION_ENABLED,false);
});

test('retired KHQR creation refuses missing or incomplete schema without saving an obligation',async()=>{
 for(const mode of ['missing','incomplete']){
  const f=await api.fixture('sandbox','merchant',mode!=='missing',true);
  try{
   if(mode==='incomplete')await f.db.exec("create or replace function public.tenh_khqr_checkout_capabilities() returns jsonb language sql as $$ select '{\"version\":1}'::jsonb $$");
   const response=await f.checkout.POST(f.post('/api/bakong/checkout',f.body));
   assert.equal(response.status,410,mode);assert.equal((await response.json()).code,'BAKONG_CHECKOUT_RETIRED');assert.equal(f.state.calls,0);
   assert.equal((await f.db.query('select count(*)::int n from billing_transactions')).rows[0].n,0);
   assert.equal((await f.db.query('select count(*)::int n from bakong_payment_attempts')).rows[0].n,0);
  }finally{await f.db.close();}
 }
});
test('KHQR returns its saved QR and server deadlines on the installed schema without cancellation tables',async()=>{
 const f=await api.fixture('sandbox','merchant',false);
 try{
  assert.equal((await f.db.query("select to_regclass('public.payment_cancellations') t")).rows[0].t,null);
  const started=await f.seedExistingAttempt(),response=await f.read(started.attemptId),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.success,true);assert.match(body.attempt.qrImage,/^data:image\/png;base64,/);
  assert.ok(Number.isFinite(Date.parse(body.attempt.createdAt)));assert.equal(f.state.calls,0);
  const saved=(await f.db.query('select expires_at from bakong_payment_attempts where id=$1',[started.attemptId])).rows[0];
  assert.equal(Date.parse(body.attempt.expiresAt),saved.expires_at.getTime());
  f.state.userId=null;assert.equal((await f.read(started.attemptId)).status,401);
  f.state.userId=f.userId;await f.db.query('update team_members set is_active=false where id=$1',[f.memberId]);
  assert.equal((await f.read(started.attemptId)).status,403);assert.equal(f.state.calls,0);
 }finally{await f.db.close();}
});
test('expired unresolved KHQR keeps the installed purchase guard and cannot mint another obligation',async()=>{
 const f=await api.fixture('sandbox','merchant',false);
 try{
  const started=await f.seedExistingAttempt();
  await f.db.exec(`alter table bakong_payment_attempts disable trigger bakong_immutable_attempt_identity;update bakong_payment_attempts set expires_at=now()-interval '1 minute' where id='${started.attemptId}';alter table bakong_payment_attempts enable trigger bakong_immutable_attempt_identity;`);
  const before=(await f.read(started.attemptId));assert.equal(before.status,200);assert.equal((await before.json()).attempt.qrImage,null);
  f.body.purchaseIntent=randomUUID();
  const retired=await f.checkout.POST(f.post('/api/bakong/checkout',f.body));
  assert.equal(retired.status,410);assert.equal((await retired.json()).code,'BAKONG_CHECKOUT_RETIRED');
  assert.equal(await f.load('lib/bakong/payments.ts').pendingBakong(f.body.businessId),started.attemptId);
  assert.equal((await f.db.query('select count(*)::int n from bakong_payment_attempts')).rows[0].n,1);
  assert.equal(f.state.calls,0);
 }finally{await f.db.close();}
});
test('paid PayWay and submitted manual status are readable with no cancellation-table query or writes',async()=>{
 for(const kind of ['payway','manual']){
  const seed=savedStatus.saved();
  if(kind==='manual'){seed.source='manual';seed.payment={id:savedStatus.manualId,business_id:savedStatus.businessId,status:'submitted',amount:12,currency:'USD',plan_code:'mini',billing_cycle:'monthly'};seed.invoice=null;}
  const f=savedStatus.route(seed,{lifecycleEnabled:false});delete f.db.tables.payment_cancellations;
  const query=new URLSearchParams({[kind==='manual'?'manual_request':'tran_id']:kind==='manual'?savedStatus.manualId:seed.payment.provider_transaction_id,purchase_business:savedStatus.businessId});
  const result=await f.get(query);assert.equal(result.response.status,200);assert.equal(result.body.attempt.application,kind==='manual'?'pending':'active');
  assert.ok(f.db.history.every(x=>x.op==='read'&&x.table!=='payment_cancellations'));
  const denied=savedStatus.route(seed,{lifecycleEnabled:false,outsider:true});assert.equal((await denied.get(query)).response.status,404);
 }
});
test('summary reads work without new schema while retaining membership and permission checks',async()=>{
 const fixture=fixtureModule('subscription-pending-payments.test.cjs',"test('read-only summary",'server');
 const f=fixture.server({lifecycleEnabled:false});delete f.db.tables.payment_cancellations;
 assert.equal((await f.get()).status,200);assert.ok(f.db.history.every(x=>x.op==='read'&&x.table!=='payment_cancellations'));
 assert.equal((await fixture.server({lifecycleEnabled:false,unauthenticated:true}).get()).status,401);
});
test('disabled cancellation never reaches its RPC or any provider for any method',async()=>{
 let calls=0;const forbidden=async()=>{calls++;throw Error('forbidden fixture operation');};
 const load=loader({'@/lib/billing/payment-cancellation-feature':{KHQR_CHECKOUT_ENABLED:false,PAYMENT_CANCELLATION_ENABLED:false},'@/lib/supabase/admin':{supabaseAdmin:{rpc:forbidden}},'@/lib/payway/finalize-payment':{verifyAndFinalizePayWayTransaction:forbidden},'@/lib/payway/close-transaction':{closePayWayTransaction:forbidden}});
 for(const kind of ['bakong','payway','manual'])await assert.rejects(load('lib/billing/cancel-payment.ts').cancelPayment({kind,paymentId:'synthetic',businessId:'synthetic',actorId:'synthetic',memberId:'synthetic',withdraw:kind==='manual'}),/temporarily unavailable/);
 assert.equal(calls,0);
});
