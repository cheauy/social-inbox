/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated real SQL + synthetic claimed-call rows only. No hosted DB, provider, refunds or auth.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.resolve('tests/bakong-checkout-lifecycle-sql.test.cjs'),source=fs.readFileSync(file,'utf8'),fixture={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('expired KHQR"))+'\nmodule.exports={setup,prepare,again,cancel,one,subscription,settle,shiftExpiry};',{module:fixture,require:createRequire(file),process,console,__dirname:path.dirname(file)});
const {setup,prepare,again,cancel,one,subscription,settle,shiftExpiry}=fixture.exports;
const proposal=fs.readFileSync('db/proposals/20261016105717_bakong_closed_checkout_accounting.sql','utf8');
async function database(){const ctx=await setup();try{await ctx.db.exec(proposal);return ctx;}catch(error){await ctx.db.close();throw error;}}
const reserved=async ctx=>(await one(ctx,"select tenh_bakong_private.reserved_inquiries('sandbox') n")).n;
const used=async ctx=>(await one(ctx,'select count(*)::int n from tenh_bakong_private.provider_calls')).n;
const claim=async(ctx,p)=>(await one(ctx,'select tenh_claim_bakong_check($1,$2,90) r',[p.attempt.id,p.fingerprint])).r;
const capacity=async(ctx,p)=>(await one(ctx,'select tenh_bakong_capacity($1,$2,$3,90) r',[p.fingerprint,p.attempt.environment,p.attempt.recipient])).r;
const clearCooldown=async(ctx,p)=>{
 await ctx.db.query('update bakong_payment_attempts set next_check_at=clock_timestamp()-interval \'1 second\',lease_until=null where id=$1',[p.attempt.id]);
 await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
};
const paid=p=>({state:'paid',settlement:{md5:p.attempt.md5,hash:'8'.repeat(64),recipient:p.attempt.recipient,amount:p.amount,currency:'USD',environment:p.attempt.environment}});

test('120 ordinary close/new cycles have no per-user/workspace cap and do not hoard inquiry promises',async()=>{
 const ctx=await database();try{
  let p=await prepare(ctx);const before=await subscription(ctx,p.businessId),actor=p.userId,business=p.businessId,ids=new Set();
  for(let i=0;i<120;i++){
   ids.add(p.attempt.id);assert.equal(p.userId,actor);assert.equal(p.businessId,business);assert.equal(await reserved(ctx),3);
   assert.equal((await cancel(ctx,p)).outcome,'checkout_closed');assert.equal(await reserved(ctx),0);
   p=await again(ctx,p);
  }
  assert.equal(ids.size,120);assert.equal(await used(ctx),0);assert.equal(await reserved(ctx),3);assert.equal((await capacity(ctx,p)).canIssue,true);
  assert.deepEqual(await subscription(ctx,business),before);assert.equal((await one(ctx,'select count(*)::int n from payment_cancellations')).n,120);
 }finally{await ctx.db.close();}
});
test('expiry releases only unused promises immediately, retains identities, and never resumes the old intent',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx);const original=p.attempt.expires_at;
  await shiftExpiry(ctx,p.attempt.id,"clock_timestamp()-interval '1 second'");assert.equal(await reserved(ctx),0);assert.equal(await used(ctx),0);
  const next=await again(ctx,p);assert.notEqual(next.attempt.id,p.attempt.id);assert.notEqual(next.attempt.md5,p.attempt.md5);
  await assert.rejects(again(ctx,p,{intent:p.args[3]}),/Checkout closed/);
  assert.ok(original);assert.equal((await one(ctx,'select state from bakong_payment_attempts where id=$1',[p.attempt.id])).state,'pending');
 }finally{await ctx.db.close();}
});
test('an in-flight claim survives closure and its late paid completion holds the replacement without changing the plan',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx,{environment:'production',approvedCapacity:true}),before=await subscription(ctx,p.businessId),lease=await claim(ctx,p);assert.equal(lease.claimed,true);
  const saved=await one(ctx,'select lease_id,lease_until,next_check_at,check_count from bakong_payment_attempts where id=$1',[p.attempt.id]);
  await cancel(ctx,p);assert.equal(await used(ctx),1);assert.deepEqual(await one(ctx,'select lease_id,lease_until,next_check_at,check_count from bakong_payment_attempts where id=$1',[p.attempt.id]),saved);
  assert.equal((await one(ctx,"select tenh_bakong_private.reserved_inquiries('production') n")).n,0);
  const next=await again(ctx,p),done=(await one(ctx,'select tenh_complete_bakong_check($1,$2,$3,$4) r',[p.attempt.id,lease.claimId,paid(p),p.userId])).r;
  assert.equal(done.state,'review');assert.equal(done.reason,'CANCELLATION_PAYMENT_REVIEW');assert.equal(done.verified_hash,'8'.repeat(64));
  const held=await one(ctx,'select * from bakong_payment_attempts where id=$1',[next.attempt.id]);assert.equal(held.state,'review');assert.equal(held.reason,'WORKSPACE_LATE_PAYMENT_REVIEW');
  assert.ok(held.qr);assert.equal(held.verified_hash,null);assert.deepEqual(await subscription(ctx,p.businessId),before);assert.equal(await used(ctx),1);
  assert.equal((await one(ctx,'select count(*)::int n from tenh_billing_invoices')).n,0);
  // A saved replacement QR can still receive money; its evidence must also stay in review.
  await clearCooldown(ctx,next);const second=await settle(ctx,next,'7'.repeat(64));assert.equal(second.result.state,'review');assert.equal(second.result.verified_hash,'7'.repeat(64));
  assert.equal((await one(ctx,'select tenh_apply_bakong_payment($1,$2) r',[next.attempt.id,p.userId])).r.state,'review');assert.deepEqual(await subscription(ctx,p.businessId),before);
 }finally{await ctx.db.close();}
});
test('replacement-applied-first keeps its existing paid plan and invoice when old money is later confirmed',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx,{environment:'production',approvedCapacity:true});await cancel(ctx,p);const next=await again(ctx,p);
  assert.equal((await settle(ctx,next,'6'.repeat(64))).result.state,'verified');
  assert.equal((await one(ctx,'select tenh_apply_bakong_payment($1,$2) r',[next.attempt.id,p.userId])).r.state,'applied');const before=await subscription(ctx,p.businessId);
  await clearCooldown(ctx,p);assert.equal((await settle(ctx,p,'5'.repeat(64))).result.state,'review');assert.deepEqual(await subscription(ctx,p.businessId),before);
  assert.equal((await one(ctx,'select state from bakong_payment_attempts where id=$1',[next.attempt.id])).state,'applied');assert.equal((await one(ctx,'select count(*)::int n from tenh_billing_invoices')).n,1);
 }finally{await ctx.db.close();}
});
test('closed reconciliation cannot steal the promises of 30 currently open QRs, but can use released spare capacity',async()=>{
 const ctx=await database();try{
  const old=await prepare(ctx);await cancel(ctx,old);const open=[];for(let i=0;i<30;i++)open.push(await prepare(ctx));
  assert.equal(await reserved(ctx),90);assert.equal((await capacity(ctx,old)).canIssue,false);assert.equal((await claim(ctx,old)).claimed,false);assert.equal(await used(ctx),0);
  await cancel(ctx,open[0]);assert.equal(await reserved(ctx),87);assert.equal((await claim(ctx,old)).claimed,true);assert.equal(await used(ctx),1);
  assert.equal((await capacity(ctx,old)).canIssue,false,'only two slots remain; a new checkout still requires three');
 }finally{await ctx.db.close();}
});
test('failed/lost claims stay counted after cancel, and the three-check lifetime limit cannot be reset by closing or aging usage',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx);await cancel(ctx,p);
  for(let i=0;i<3;i++){
   await clearCooldown(ctx,p);const lease=await claim(ctx,p);assert.equal(lease.claimed,true);
   if(i!==1)await ctx.db.query('select tenh_complete_bakong_check($1,$2,$3,$4)',[p.attempt.id,lease.claimId,{state:'unresolved'},p.userId]); // middle acknowledgement deliberately lost
  }
  await clearCooldown(ctx,p);assert.equal(await used(ctx),3);assert.equal((await claim(ctx,p)).reason,'INQUIRY_LIMIT_REVIEW');assert.equal(await reserved(ctx),0);
  // Fixture-only clock aging: rolling usage expires; lifetime usage does not.
  await ctx.db.exec("update tenh_bakong_private.provider_calls set counted_at=clock_timestamp()-interval '25 hours'");
  assert.equal((await claim(ctx,p)).reason,'INQUIRY_LIMIT_REVIEW');assert.equal(await used(ctx),3);
 }finally{await ctx.db.close();}
});
test('90 claimed queries remain a hard global stop even after every checkout is closed',async()=>{
 const ctx=await database();try{
  let p;for(let i=0;i<30;i++){
   p=await prepare(ctx);await cancel(ctx,p);
   await ctx.db.query("insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) select gen_random_uuid(),$1,'sandbox',$2 from generate_series(1,3)",[p.fingerprint,p.attempt.id]);
  }
  assert.equal(await used(ctx),90);assert.equal(await reserved(ctx),0);assert.equal((await capacity(ctx,p)).canIssue,false);await assert.rejects(again(ctx,p),/capacity is reserved/);assert.equal((await claim(ctx,p)).claimed,false);
 }finally{await ctx.db.close();}
});
test('proposal retains service-only ACLs and fails atomically for an unknown installed contract',async()=>{
 const ctx=await database();try{
  const acl=await one(ctx,"select has_function_privilege('anon','public.tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean)','EXECUTE') client,has_function_privilege('service_role','tenh_bakong_private.hold_related_checkouts()','EXECUTE') direct,has_table_privilege('service_role','payment_cancellations','DELETE') deletes");
  assert.equal(acl.client,false);assert.equal(acl.direct,false);assert.equal(acl.deletes,false);
 }finally{await ctx.db.close();}
 const old=await setup();try{
  const original=(await one(old,"select pg_get_functiondef('tenh_bakong_private.reserved_inquiries(text,uuid)'::regprocedure) s")).s;
  await old.db.exec(original.replace('select coalesce','-- unknown contract\n  select coalesce'));
  await assert.rejects(old.db.exec(proposal),/exact installed/);await old.db.exec('rollback');
  assert.equal((await one(old,"select to_regprocedure('tenh_bakong_private.hold_related_checkouts()') n")).n,null);
 }finally{await old.db.close();}
});
