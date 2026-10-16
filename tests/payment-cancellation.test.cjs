/* eslint-disable @typescript-eslint/no-require-imports */
// All provider/auth/server calls are mocks. No bank credentials or hosted writes.
const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');
const businessId='10000000-0000-4000-8000-000000000001';
function service(options={}) {
  const calls=[];
  const load=loader({
    '@/lib/billing/payment-cancellation-feature':{PAYMENT_CANCELLATION_ENABLED:true},
    '@/lib/supabase/admin':{supabaseAdmin:{rpc:async(name,args)=>{
      calls.push({name,args});
      if(options.rpcError)return{data:null,error:{message:'unavailable'}};
      return{data:name==='tenh_request_payment_cancellation'?{outcome:options.outcome??'processing',claimed:options.claimed??true}:{outcome:args.p_closed?'cancelled':'reconciliation_required'},error:null};
    }}},
    '@/lib/payway/finalize-payment':{verifyAndFinalizePayWayTransaction:async()=>{calls.push({name:'verify'});if(options.verifyError)throw Error('timeout');return{paymentState:options.status??'pending',providerStatus:options.providerStatus??'PENDING'};}},
    '@/lib/payway/close-transaction':{closePayWayTransaction:async()=>{calls.push({name:'close'});if(options.closeError)throw Error('timeout');return{closed:options.closed??true,response:{status:{code:'00'}},reqTime:'synthetic'};}},
  });
  return{calls,cancel:(kind='payway')=>load('lib/billing/cancel-payment.ts').cancelPayment({kind,paymentId:'synthetic',businessId,actorId:'trusted-user',memberId:'trusted-member',withdraw:false})};
}
test('provider close is attempted once only after a durable claim and verification',async()=>{
  const f=service();assert.equal(await f.cancel(),'cancelled');
  assert.deepEqual(f.calls.map(x=>x.name),['tenh_request_payment_cancellation','verify','close','tenh_finish_payway_cancellation']);
  assert.equal(f.calls[0].args.p_actor,'trusted-user');assert.equal(f.calls[3].args.p_closed,true);
  for(const outcome of ['processing','cancelled','reconciliation_required']){
    const repeated=service({claimed:false,outcome});assert.equal(await repeated.cancel(),outcome);assert.equal(repeated.calls.length,1);
  }
});
test('uncertain/in-progress verification never closes the provider or discards the attempt',async()=>{
  for(const options of [{verifyError:true},{status:'recovery_required'},{status:'processing'},{status:'pending',providerStatus:'PROCESSING'}]){
    const f=service(options);assert.equal(await f.cancel(),'reconciliation_required');assert.ok(!f.calls.some(x=>x.name==='close'));
    assert.equal(f.calls.at(-1).args.p_closed,false);
  }
  const timeout=service({closeError:true});assert.equal(await timeout.cancel(),'reconciliation_required');
  assert.equal(timeout.calls.at(-1).args.p_result.uncertain,true);
  const missingMigration=service({rpcError:true});await assert.rejects(missingMigration.cancel());assert.equal(missingMigration.calls.length,1);
});
test('manual and KHQR never call PayWay or claim provider cancellation',async()=>{
  for(const kind of ['manual','bakong']){
    const f=service({outcome:kind==='manual'?'withdrawn':'reconciliation_required',claimed:false});
    assert.equal(await f.cancel(kind),kind==='manual'?'withdrawn':'reconciliation_required');assert.equal(f.calls.length,1);
  }
});
test('PayWay close acknowledgement rejects a mismatched transaction and unconfirmed provider status',async()=>{
  for(const [status,closed] of [[{code:'00',tran_id:'synthetic'},true],[{code:'00',tran_id:'other'},false],[{code:'99'},false]]){
    const load=loader({'@/lib/payway/config':{getPayWayConfig:()=>({merchantId:'synthetic',apiKey:'synthetic',checkTransactionUrl:'https://provider.invalid/check'})}},
      {fetch:async()=>Response.json({status})});
    assert.equal((await load('lib/payway/close-transaction.ts').closePayWayTransaction('synthetic')).closed,closed);
  }
});
function endpoint(options={}){
  const calls=[],db=database({team_members:[{id:'member',business_id:businessId,role:options.role??'owner',user_id:'trusted-user',is_active:!options.revoked}]});
  const load=loader({
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:options.signedOut?null:{id:'trusted-user'}},error:null})}})},
    '@/lib/auth/require-permission':{memberHasPermission:async()=>!options.denied},
    '@/lib/billing/cancel-payment':{cancelPayment:async input=>{calls.push(input);return'cancelled';}},
  });
  return{calls,post:(patch={},origin='https://fixture.invalid')=>load('app/api/subscription/cancel-payment/route.ts').POST(new Request('https://fixture.invalid/api/subscription/cancel-payment',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({kind:'manual',paymentId:'synthetic',businessId,action:'cancel',confirmed:true,...patch})}))};
}
test('endpoint requires current workspace billing permission, confirmation and same origin; never trusts actor fields',async()=>{
  for(const options of [{signedOut:true},{denied:true},{revoked:true}]){
    const f=endpoint(options);assert.ok([401,403].includes((await f.post()).status));assert.equal(f.calls.length,0);
  }
  const f=endpoint();assert.equal((await f.post({confirmed:false})).status,400);
  assert.equal((await f.post({},'https://attacker.invalid')).status,403);
  assert.equal((await f.post({kind:'payway',action:'withdraw'})).status,400);
  assert.equal((await f.post({actorId:'attacker',memberId:'attacker'})).status,200);
  assert.equal(f.calls[0].actorId,'trusted-user');assert.equal(f.calls[0].memberId,'member');
  assert.equal((await f.post({action:'withdraw'})).status,200);assert.equal(f.calls.at(-1).withdraw,true);
});
