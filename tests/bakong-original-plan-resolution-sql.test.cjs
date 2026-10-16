/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated real SQL, synthetic received-money evidence only. No bank/refund/hosted calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const file=path.resolve('tests/bakong-closed-accounting-sql.test.cjs'),source=fs.readFileSync(file,'utf8'),fixture={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('120 ordinary"))+'\nmodule.exports={database,prepare,again,cancel,one,subscription,settle};',{module:fixture,require:createRequire(file),process,console,__dirname:path.dirname(file)});
const {prepare,again,cancel,one,subscription,settle}=fixture.exports;
async function database(){const ctx=await fixture.exports.database();try{await ctx.db.exec(fs.readFileSync('db/proposals/20261016111428_bakong_admin_original_plan_resolution.sql','utf8'));return ctx;}catch(error){await ctx.db.close();throw error;}}
async function late(ctx){const p=await prepare(ctx,{environment:'production',approvedCapacity:true});await cancel(ctx,p);p.received=(await settle(ctx,p,'4'.repeat(64))).result;assert.equal(p.received.state,'review');return p;}
const preview=async(ctx,p)=>(await one(ctx,'select tenh_bakong_original_plan_preview($1) r',[[p.attempt.id]])).r[p.attempt.id];
const resolve=async(ctx,p,options={})=>(await one(ctx,'select tenh_apply_reviewed_bakong_original_plan($1,$2,$3,$4,$5) r',[p.attempt.id,options.actor??p.userId,options.key??randomUUID(),options.reason??'Reviewed original bank receipt and absence of overlapping purchases.',options.hash??'4'.repeat(64)])).r;
const invoiceCount=async ctx=>(await one(ctx,'select count(*)::int n from tenh_billing_invoices')).n;

test('explicit reviewed original plan applies once with an immutable actor/reason/evidence audit and one paid invoice',async()=>{
 const ctx=await database();try{
  const p=await late(ctx),before=await subscription(ctx,p.businessId),calls=(await one(ctx,'select count(*)::int n from tenh_bakong_private.provider_calls')).n;
  assert.equal((await preview(ctx,p)).canApplyOriginal,true);assert.equal((await subscription(ctx,p.businessId)).status,before.status);
  const key=randomUUID(),first=await resolve(ctx,p,{key});assert.equal(first.outcome,'applied');assert.ok(first.invoiceId);assert.equal(await invoiceCount(ctx),1);
  const after=await subscription(ctx,p.businessId);assert.equal(after.status,'active');assert.equal(after.plan_code,'mini');assert.equal(after.billing_cycle,'monthly');
  assert.deepEqual(await resolve(ctx,p,{key}),first);assert.deepEqual(await subscription(ctx,p.businessId),after);assert.equal(await invoiceCount(ctx),1);
  const again=await resolve(ctx,p);assert.equal(again.outcome,'conflict');assert.equal(again.reason,'ALREADY_APPLIED');assert.equal(await invoiceCount(ctx),1);
  const audit=await one(ctx,'select * from tenh_bakong_private.late_application_resolutions where request_id=$1',[key]);assert.equal(audit.actor_user_id,p.userId);assert.equal(audit.purchase.planCode,'mini');assert.equal(audit.transaction_hash,'4'.repeat(64));assert.ok(audit.reason);assert.deepEqual(audit.evidence,p.received.evidence);
  await assert.rejects(ctx.db.query('delete from tenh_bakong_private.late_application_resolutions where request_id=$1',[key]),/audit|immutable|delete|Retain/i);
  assert.equal((await one(ctx,'select count(*)::int n from tenh_bakong_private.provider_calls')).n,calls);
 }finally{await ctx.db.close();}
});
test('changed baseline and removed purchaser remain audited conflicts with no entitlement or receipt change',async t=>{
 for(const scenario of ['baseline','membership'])await t.test(scenario,async()=>{
  const ctx=await database();try{
   const p=await late(ctx);if(scenario==='baseline')await ctx.db.query('update business_subscriptions set member_limit=member_limit+1 where business_id=$1',[p.businessId]);else await ctx.db.query('update team_members set is_active=false where id=$1',[p.memberId]);
   const before=await subscription(ctx,p.businessId),result=await resolve(ctx,p);assert.equal(result.outcome,'conflict');assert.equal(result.reason,scenario==='baseline'?'SUBSCRIPTION_BASELINE_CHANGED':'PURCHASER_MEMBERSHIP_REMOVED');
   assert.deepEqual(await subscription(ctx,p.businessId),before);assert.equal(await invoiceCount(ctx),0);assert.equal((await one(ctx,'select state from bakong_payment_attempts where id=$1',[p.attempt.id])).state,'review');
  }finally{await ctx.db.close();}
 });
});
test('a later replacement blocks original-plan approval even when that replacement was also cancelled',async t=>{
 for(const closeNext of [false,true])await t.test(closeNext?'cancelled replacement':'open replacement',async()=>{
  const ctx=await database();try{
   const p=await prepare(ctx,{environment:'production',approvedCapacity:true});await cancel(ctx,p);const next=await again(ctx,p);if(closeNext)await cancel(ctx,next);
   await settle(ctx,p,'4'.repeat(64));const before=await subscription(ctx,p.businessId),result=await resolve(ctx,p);assert.equal(result.reason,'OVERLAPPING_PURCHASE');assert.equal(result.outcome,'conflict');assert.equal(await invoiceCount(ctx),0);assert.deepEqual(await subscription(ctx,p.businessId),before);
  }finally{await ctx.db.close();}
 });
});
test('an unconfirmed or mismatched receipt cannot be turned into a received payment by an admin request',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx,{environment:'production',approvedCapacity:true});await cancel(ctx,p);
  await ctx.db.query("update bakong_payment_attempts set state='review',reason='CANCELLATION_PAYMENT_REVIEW',verified_hash=$2,verified_at=clock_timestamp(),evidence=$3 where id=$1",[p.attempt.id,'4'.repeat(64),{hash:'4'.repeat(64),amount:p.amount}]);
  assert.equal((await resolve(ctx,p)).reason,'RECEIPT_EVIDENCE_MISMATCH');assert.equal(await invoiceCount(ctx),0);
 }finally{await ctx.db.close();}
});
test('reviewed identity, reason and idempotency cannot be changed or replayed to apply a second purchase',async()=>{
 const ctx=await database();try{
  const p=await late(ctx);await assert.rejects(resolve(ctx,p,{reason:'short'}),/identity and reason/);await assert.rejects(resolve(ctx,p,{hash:'3'.repeat(64)}),/receipt changed/);
  const key=randomUUID();assert.equal((await resolve(ctx,p,{key})).outcome,'applied');await assert.rejects(resolve(ctx,p,{key,actor:randomUUID()}),/identity changed/);await assert.rejects(resolve(ctx,p,{key,reason:'A different audit reason that was not originally confirmed.'}),/identity changed/);assert.equal(await invoiceCount(ctx),1);
 }finally{await ctx.db.close();}
});
test('financial-engine failure rolls back entitlement and invoice together while preserving the received evidence and failed decision audit',async()=>{
 const ctx=await database();try{
  const p=await late(ctx),before=await subscription(ctx,p.businessId);
  await ctx.db.exec("create function synthetic_resolution_failure() returns trigger language plpgsql as $$ begin raise exception 'Synthetic activation failure'; end $$; create trigger synthetic_resolution_failure before update on business_subscriptions for each row execute function synthetic_resolution_failure();");
  const key=randomUUID(),failed=await resolve(ctx,p,{key});assert.equal(failed.outcome,'application_failed');assert.equal(failed.reason,'ORIGINAL_PLAN_APPLICATION_FAILED');assert.equal(await invoiceCount(ctx),0);assert.deepEqual(await subscription(ctx,p.businessId),before);
  assert.equal((await one(ctx,'select state from bakong_payment_attempts where id=$1',[p.attempt.id])).state,'review');
  await ctx.db.exec('drop trigger synthetic_resolution_failure on business_subscriptions');assert.deepEqual(await resolve(ctx,p,{key}),failed,'same failed request never silently retries a financial action');assert.equal((await resolve(ctx,p)).outcome,'applied');assert.equal(await invoiceCount(ctx),1);
 }finally{await ctx.db.close();}
});
test('mandatory audit failure rolls back an otherwise successful application instead of leaving an unaudited financial change',async()=>{
 const ctx=await database();try{
  const p=await late(ctx),before=await subscription(ctx,p.businessId);
  await ctx.db.exec("create function synthetic_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit unavailable'; end $$; create trigger synthetic_audit_failure before insert on tenh_bakong_private.late_application_resolutions for each row execute function synthetic_audit_failure();");
  await assert.rejects(resolve(ctx,p),/audit unavailable/);assert.equal(await invoiceCount(ctx),0);assert.deepEqual(await subscription(ctx,p.businessId),before);assert.equal((await one(ctx,'select state from bakong_payment_attempts where id=$1',[p.attempt.id])).state,'review');
 }finally{await ctx.db.close();}
});
test('browser roles and direct service table writes cannot create or rewrite a resolution',async()=>{
 const ctx=await database();try{
  const result=await one(ctx,"select has_function_privilege('authenticated','public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text)','EXECUTE') client,has_function_privilege('anon','public.tenh_bakong_original_plan_preview(uuid[])','EXECUTE') anon,has_table_privilege('service_role','tenh_bakong_private.late_application_resolutions','INSERT') direct");assert.equal(result.client,false);assert.equal(result.anon,false);assert.equal(result.direct,false);
 }finally{await ctx.db.close();}
});
test('partial stored receipt evidence returns an audited conflict rather than applying a plan or claiming success',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx,{environment:'production',approvedCapacity:true});await cancel(ctx,p);
  await ctx.db.query("update bakong_payment_attempts set state='review',reason='CANCELLATION_PAYMENT_REVIEW',verified_hash=$2,verified_at=clock_timestamp() where id=$1",[p.attempt.id,'4'.repeat(64)]);
  const before=await subscription(ctx,p.businessId),result=await resolve(ctx,p);assert.equal(result.outcome,'conflict');assert.equal(result.reason,'RECEIPT_NOT_CONFIRMED');assert.equal(await invoiceCount(ctx),0);assert.deepEqual(await subscription(ctx,p.businessId),before);
 }finally{await ctx.db.close();}
});
test('conflict revalidation sees a baseline changed by the calling SQL statement',async()=>{
 const ctx=await database();try{
  const p=await late(ctx);assert.equal((await preview(ctx,p)).canApplyOriginal,true);
  const checked=await one(ctx,'with changed as (update business_subscriptions set member_limit=member_limit+1 where business_id=$1 returning business_id) select tenh_bakong_private.original_plan_conflict($2) reason from changed',[p.businessId,p.attempt.id]);
  assert.equal(checked.reason,'SUBSCRIPTION_BASELINE_CHANGED');assert.equal(await invoiceCount(ctx),0);
 }finally{await ctx.db.close();}
});
