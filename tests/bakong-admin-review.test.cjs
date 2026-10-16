/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');

test('KHQR admin gate is independent, and old or incomplete capabilities cannot reach resolution',async()=>{
 const id='00000000-0000-4000-8000-000000000001',hash='a'.repeat(64);
 for(const mode of ['enabled','disabled','old-schema','partial-schema']){
  const calls=[],enabled=mode!=='disabled',db=database({bakong_payment_attempts:[{id,business_id:'workspace',environment:'production',state:'review',verified_hash:hash,reason:'LATE_PAYMENT_REVIEW',selection:{planCode:'mini'},created_at:'2026-10-16T10:00:00Z'}],businesses:[]});
  db.rpc=async name=>{calls.push(name);return{data:name==='tenh_khqr_checkout_capabilities'?(mode==='old-schema'?null:mode==='partial-schema'?{version:1}:{version:1,accounting:'open-checkout-reservations',originalPlanResolution:'explicit-admin',qrCountCap:false}):name==='tenh_bakong_original_plan_preview'?{[id]:{canApplyOriginal:true,reason:null}}:{outcome:'applied'},error:null};};
  const route=loader({'@/lib/billing/payment-cancellation-feature':{KHQR_CHECKOUT_ENABLED:enabled,PAYMENT_CANCELLATION_ENABLED:!enabled},
   '@/lib/billing/require-billing-admin':{getBillingAdminUser:async()=>({success:true,user:{id:'admin'}})},
   '@/lib/auth/mutation-request':{validateAuthMutationRequest:()=>({success:true})},'@/lib/supabase/admin':{supabaseAdmin:db},
   '@/lib/bakong/payments':{UUID:/^[a-f0-9-]{36}$/i,bakongJson:(body,status=200)=>Response.json(body,{status}),bakongFailure:()=>Response.json({success:false},{status:503}),bakongInquiryStatus:async()=>({canCheck:false})},
  })('app/api/bakong/admin/route.ts');
  const preview=await(await route.GET(new Request('https://fixture.invalid/api/bakong/admin'))).json();assert.equal(preview.items[0].canApplyOriginal,enabled);
  assert.deepEqual(calls,enabled?['tenh_bakong_original_plan_preview']:[]);calls.length=0;
  const response=await route.POST(new Request('https://fixture.invalid/api/bakong/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptId:id,action:'apply_original_plan',requestId:id,reason:'Reviewed exact original payment.',expectedTransactionReference:hash,confirmed:true})}));
  assert.equal(response.status,mode==='enabled'?200:503,mode);
  assert.deepEqual(calls,mode==='enabled'?['tenh_khqr_checkout_capabilities','tenh_apply_reviewed_bakong_original_plan']:enabled?['tenh_khqr_checkout_capabilities']:[]);
 }
});
test('known confirmed funds in review cannot be reported as a successful no-op reconciliation or spend another provider inquiry',async()=>{
 let calls=0;const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{id:'00000000-0000-4000-8000-000000000001',state:'review',verified_hash:'a'.repeat(64)},error:null})};
 const route=loader({'@/lib/billing/require-billing-admin':{getBillingAdminUser:async()=>({success:true,user:{id:'synthetic-admin'}})},
  '@/lib/auth/mutation-request':{validateAuthMutationRequest:()=>({success:true})},
  '@/lib/supabase/admin':{supabaseAdmin:{from:()=>query}},
  '@/lib/bakong/payments':{UUID:/^[a-f0-9-]{36}$/i,bakongJson:(body,status=200)=>Response.json(body,{status}),bakongFailure:error=>{throw error;},checkBakongPayment:async()=>{calls++;throw Error('Forbidden provider or financial action');}},
 })('app/api/bakong/admin/route.ts');
 const response=await route.POST(new Request('https://fixture.invalid/api/bakong/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attemptId:'00000000-0000-4000-8000-000000000001',action:'reconcile'})}));
 assert.equal(response.status,409);const result=await response.json();assert.equal(result.success,false);assert.equal(result.code,'SETTLEMENT_REVIEW_REQUIRED');assert.equal(result.requiresOperatorResolution,true);assert.equal(calls,0);assert.match(result.error,/operator review/);
});
