/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
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
