/* eslint-disable @typescript-eslint/no-require-imports */
// Local SQL only: no real database connection, provider, auth state or money.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{randomUUID}=require('node:crypto');
const {database:base,prepare}=require('./bakong-fixture.cjs');
const file=path.resolve('tests/bakong-checkout-lifecycle-sql.test.cjs'),source=fs.readFileSync(file,'utf8'),fixture={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('expired KHQR"))+'\nmodule.exports={again,cancel,one};',{module:fixture,require:createRequire(file),process,console,__dirname:path.dirname(file)});
const {again,cancel,one}=fixture.exports;
const sql=fs.readFileSync('db/proposals/20261016111054_khqr_checkout_cancellation_atomic.sql','utf8');
async function database(){const ctx=await base(true,true,true,false);await ctx.db.exec("alter table team_members add column permissions jsonb default '{}'");return ctx;}
const unchanged=async ctx=>JSON.stringify((await ctx.db.query("select 'subscriptions' source,to_jsonb(s) body from business_subscriptions s union all select 'billing',to_jsonb(b) from billing_transactions b union all select 'attempts',to_jsonb(a) from bakong_payment_attempts a union all select 'calls',to_jsonb(c) from tenh_bakong_private.provider_calls c order by 1,2")).rows);
test('single atomic candidate installs from the source-matched baseline without changing existing purchase, QR, query, subscription or receipt rows',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx),claimed=(await one(ctx,'select tenh_claim_bakong_check($1,$2,90) r',[p.attempt.id,p.fingerprint])).r;assert.equal(claimed.claimed,true);const before=await unchanged(ctx);
  await ctx.db.exec(sql);assert.equal(await unchanged(ctx),before);
  const capabilities=(await one(ctx,'select tenh_khqr_checkout_capabilities() r')).r;assert.equal(capabilities.version,1);assert.equal(capabilities.qrCountCap,false);assert.equal(capabilities.originalPlanResolution,'explicit-admin');
  await cancel(ctx,p);const next=await again(ctx,p);assert.notEqual(next.attempt.id,p.attempt.id);assert.equal((await one(ctx,"select tenh_bakong_private.reserved_inquiries('sandbox') n")).n,3);assert.equal((await one(ctx,'select count(*)::int n from tenh_bakong_private.provider_calls')).n,1);
 }finally{await ctx.db.close();}
});
test('unknown baseline or partial previous installation is rejected without leaving any new cancellation/resolution schema',async t=>{
 for(const scenario of ['unknown-body','partial'])await t.test(scenario,async()=>{
  const ctx=await database();try{
   if(scenario==='unknown-body'){
    const definition=(await one(ctx,"select pg_get_functiondef('public.tenh_claim_bakong_check(uuid,text,integer)'::regprocedure) s")).s;await ctx.db.exec(definition.replace('begin','begin\n-- unexpected installed change'));
   }else await ctx.db.exec('create table payment_cancellations(synthetic text)');
   await assert.rejects(ctx.db.exec(sql),scenario==='partial'?/exact unmodified/:/contract mismatch/);await ctx.db.exec('rollback');
   assert.equal((await one(ctx,"select to_regclass('tenh_bakong_private.late_application_resolutions') n")).n,null);assert.equal((await one(ctx,"select to_regprocedure('public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text)') n")).n,null);
   if(scenario==='unknown-body')assert.equal((await one(ctx,"select to_regclass('public.payment_cancellations') n")).n,null);
  }finally{await ctx.db.close();}
 });
});
test('a failure in the last component rolls back every preceding DDL change and preserves old behavior',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx),before=await unchanged(ctx),broken=sql.replace('-- Read-only deployment capability probe;',()=>"do $$ begin raise exception 'Synthetic final-stage failure'; end $$;\n-- Read-only deployment capability probe;");
  assert.notEqual(broken,sql);await assert.rejects(ctx.db.exec(broken),/final-stage failure/);await ctx.db.exec('rollback');assert.equal(await unchanged(ctx),before);
  assert.equal((await one(ctx,"select to_regclass('public.payment_cancellations') n")).n,null);assert.equal((await one(ctx,"select to_regprocedure('public.tenh_bakong_blocking_attempt(uuid)') n")).n,null);
  const retried=await again(ctx,p);assert.equal(retried.attempt.id,p.attempt.id,'the old unresolved-payment guard remains authoritative');
 }finally{await ctx.db.close();}
});
test('row-preservation guard rejects accidental data rewrites inside the proposal',async()=>{
 const ctx=await database();try{
  const p=await prepare(ctx),before=await unchanged(ctx);const broken=sql.replace('do $preserve$',"update public.business_subscriptions set member_limit=member_limit+1;\ndo $preserve$");
  await assert.rejects(ctx.db.exec(broken),/Existing rows changed/);await ctx.db.exec('rollback');assert.equal(await unchanged(ctx),before);assert.ok(p.attempt.id);
 }finally{await ctx.db.close();}
});
test('new administration RPCs are service-only and audit tables reject direct client/service mutation',async()=>{
 const ctx=await database();try{
  await ctx.db.exec(sql);const permissions=await one(ctx,"select has_function_privilege('anon','public.tenh_khqr_checkout_capabilities()','EXECUTE') a,has_function_privilege('authenticated','public.tenh_apply_reviewed_bakong_original_plan(uuid,uuid,uuid,text,text)','EXECUTE') b,has_table_privilege('service_role','tenh_bakong_private.late_application_resolutions','INSERT,UPDATE,DELETE') c");assert.equal(permissions.a,false);assert.equal(permissions.b,false);assert.equal(permissions.c,false);
  await assert.rejects(ctx.db.query('select tenh_apply_reviewed_bakong_original_plan($1,$2,$3,$4,$5)',[randomUUID(),randomUUID(),randomUUID(),'Reviewed synthetic receipt only.','a'.repeat(64)]),/Payment missing/);
 }finally{await ctx.db.close();}
});
