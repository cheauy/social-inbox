/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
// Synthetic route and query checks. No provider or production database access.
const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');

test('leaving a saved historical checkout cannot close it at PayWay or modify its record',async()=>{
 const db=database({billing_transactions:[{id:'saved',business_id:'b',provider:'payway',provider_transaction_id:'saved',status:'pending',metadata:{environment:'sandbox',live_enabled:false}}],team_members:[{id:'owner',business_id:'b',user_id:'u',is_active:true,role:'owner'}]});
 const before=JSON.stringify(db.tables);let providerCalls=0;
 const unexpected=()=>{providerCalls++;throw Error('Unexpected provider action');};
 const load=loader({'@/lib/supabase/admin':{supabaseAdmin:db},
 'next/headers':{cookies:async()=>{throw Error('Unexpected cookie mutation');}},
 '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,user:{id:'u'}})},
 '@/lib/auth/require-permission':{memberHasPermission:async()=>true},
 '@/lib/payway/close-transaction':{closePayWayTransaction:unexpected},
 '@/lib/payway/finalize-payment':{verifyAndFinalizePayWayTransaction:unexpected}});
 const response=await load('app/api/payway/cancel-return/route.ts').POST(new Request('https://fixture.example.invalid/api/payway/cancel-return',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transactionId:'saved'})}));
 assert.equal(response.status,409);assert.equal(providerCalls,0);assert.equal(JSON.stringify(db.tables),before);
 assert.ok(db.history.every(e=>e.op==='read'));
});

test('old pending PayWay payments block unrelated manual targets even behind recent approved purchases',async()=>{
 const rows=Array.from({length:30},(_,i)=>({id:'approved-'+i,business_id:'b',provider:'payway',status:'approved'}));
 rows.push({id:'old',business_id:'b',provider:'payway',status:'pending',provider_transaction_id:'synthetic-old',plan_code:'mini',billing_cycle:'monthly',amount:12,currency:'USD',created_at:'2026-08-01T00:00:00Z'});
 const db=database({billing_transactions:rows}),before=JSON.stringify(db.tables);
 const safety=loader({'@/lib/supabase/admin':{supabaseAdmin:db}})('lib/billing/manual-payment-payway-safety.ts');
 const result=await safety.getManualPaymentPayWaySafety({businessId:'b',planCode:'custom',billingCycle:'12-months',amount:999,targetMemberLimit:100,targetChannelLimit:30});
 assert.equal(result.blocked,true);assert.equal(result.kind,'pending');assert.equal(result.transaction.id,'old');
 assert.equal(JSON.stringify(db.tables),before);assert.ok(db.history.every(e=>e.op==='read'));
});

for(const recovery of [false,true])test('cancellation verification conflict stops before provider close: '+recovery,async()=>{
 const db=database({billing_transactions:[{id:'v2',business_id:'b',provider:'payway',provider_transaction_id:'v2',status:'pending',metadata:{checkout_contract_version:2}}],team_members:[{id:'owner',business_id:'b',user_id:'u',is_active:true,role:'owner'}]});
 const before=JSON.stringify(db.tables);let closes=0,verifications=0;
 const load=loader({'@/lib/supabase/admin':{supabaseAdmin:db},'next/headers':{cookies:async()=>{throw Error('Unexpected cookie mutation');}},
 '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,user:{id:'u'}})},'@/lib/auth/require-permission':{memberHasPermission:async()=>true},
 '@/lib/payway/close-transaction':{closePayWayTransaction:async()=>{closes++;throw Error('Unexpected closure');}},
 '@/lib/payway/finalize-payment':{verifyAndFinalizePayWayTransaction:async()=>{verifications++;if(recovery)return {paymentState:'recovery_required'};throw Error('Synthetic conflicting approval');}}});
 const response=await load('app/api/payway/cancel-return/route.ts').POST(new Request('https://fixture.example.invalid/api/payway/cancel-return',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transactionId:'v2'})}));
 assert.equal(response.status,409);assert.equal(closes,0);assert.equal(verifications,1);assert.equal(JSON.stringify(db.tables),before);assert.ok(db.history.every(e=>e.op==='read'));
});

for(const row of [{subscription_status:'recovery_required',business_id:'b'},{subscription_status:'active',business_id:'other'}])test('manual approval rejects '+row.subscription_status+'/'+row.business_id+' before success audit or notifications',async()=>{
 const db=database({manual_payment_requests:[{id:'request',business_id:'b',status:'submitted',plan_code:'mini',billing_cycle:'monthly',amount:12,currency:'USD'}],business_subscriptions:[{business_id:'b',status:'active',plan_code:'mini',payment_provider:'manual'}]});
 let calls=0,successAudit=0;db.rpc=async(name)=>{assert.equal(name,'tenh_approve_manual_payment');calls++;return {data:[row],error:null};};
 const load=loader({'@/lib/supabase/admin':{supabaseAdmin:db},
 '@/lib/admin/tenh-admin-auth':{getTenhAdminMutationUser:async()=>({success:true,user:{id:'admin',email:'fixture@example.invalid'}})},
 '@/lib/admin/log-tenh-admin-action':{logTenhAdminAction:async()=>{successAudit++;throw Error('Unexpected success audit');}},
 '@/lib/billing/manual-payment-payway-safety':{getManualPaymentPayWaySafety:async()=>({blocked:false})}});
 const response=await load('app/api/manual-payments/admin/route.ts').POST(new Request('https://fixture.example.invalid/api/manual-payments/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'request',decision:'approve'})}));
 assert.equal(response.status,row.subscription_status==='recovery_required'?409:500);assert.equal(calls,1);assert.equal(successAudit,0);
 assert.ok(db.history.every(e=>e.op==='read'));assert.equal(db.tables.manual_payment_requests[0].status,'submitted');
});
