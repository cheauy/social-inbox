/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL and mocked HTTP only. Never reads .env or contacts a provider.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { database, prepare, settle } = require('./bakong-fixture.cjs');
const MIGRATION = 'db/migrations/20261016070506_bakong_general_authorization.sql';
const sql = fs.readFileSync(MIGRATION,'utf8');
function fixtureFrom(file, marker) {
  const filename=path.resolve(file), source=fs.readFileSync(filename,'utf8'), fixtureModule={exports:{}};
  vm.runInNewContext(source.slice(0,source.indexOf(marker))+'\nmodule.exports={fixture};',
    {require:createRequire(filename),module:fixtureModule,process,console,Request,Response,Headers,setTimeout,Buffer});
  return fixtureModule.exports.fixture;
}
const fixture=fixtureFrom('tests/bakong-api.test.cjs',"test('server quote");
const pilotFixture=fixtureFrom('tests/bakong-pilot.test.cjs',"test('pilot stays off");
async function authorize(f, options={}) {
  return (await f.db.query(`insert into tenh_bakong_private.general_authorizations(credential_fingerprint,recipient,environment,
    quota_source,reported_daily_limit,allocated_daily_budget,dedicated_token_attested,provider_eligibility,approved_by,approval_reference,attestation_reference)
    values($1,$2,'production','user-attested',100,$3,true,'not-independently-verified',$4,'synthetic operator approval','synthetic dedicated-token/quota statement') returning id`,
  [options.fingerprint??f.config.fingerprint,options.recipient??f.config.accountId,options.budget??90,f.userId])).rows[0].id;
}
const clear = f => f.db.exec("update tenh_bakong_private.request_budgets set blocked_until=null; update bakong_payment_attempts set next_check_at=clock_timestamp()-interval '1 second',lease_until=null");
const counts = async db => (await db.query(`select (select count(*)::int from billing_transactions) billing,
  (select count(*)::int from bakong_payment_attempts) attempts,(select count(*)::int from tenh_bakong_private.provider_calls) calls,
  (select count(*)::int from tenh_billing_invoices) invoices`)).rows[0];

test('general operator approval is honest, credential-bound, private, immutable and separately revocable',async()=>{
  const f=await fixture('production','individual');
  try {
    const cap = (fingerprint=f.config.fingerprint,recipient=f.config.accountId) => f.pg.rpc('tenh_bakong_capacity',
      {p_fingerprint:fingerprint,p_environment:'production',p_recipient:recipient,p_budget:10000});
    assert.equal((await cap()).data.eligible,false);
    const id=await authorize(f), approved=(await cap()).data;
    assert.equal(approved.eligible,true); assert.equal(approved.budget,90);
    assert.equal(approved.approvalBasis,'operator-attested'); assert.equal(approved.providerEligibility,'not-independently-verified');
    assert.equal((await cap('a'.repeat(64))).data.eligible,false); assert.equal((await cap(undefined,'different@devb')).data.eligible,false);
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.capacity_reviews')).rows[0].n,0);
    for(const role of ['anon','authenticated','service_role']) {
      for(const table of ['general_authorizations','general_authorization_audit']) for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
        assert.equal((await f.db.query('select has_table_privilege($1,$2,$3) ok',[role,'tenh_bakong_private.'+table,privilege])).rows[0].ok,false);
      assert.equal((await f.db.query("select has_function_privilege($1,'public.tenh_bakong_inquiry_status(uuid,text,integer)','EXECUTE') ok",[role])).rows[0].ok,role==='service_role');
    }
    await assert.rejects(f.db.query('update tenh_bakong_private.general_authorizations set allocated_daily_budget=89 where id=$1',[id]),/one-way/);
    await assert.rejects(f.db.query('delete from tenh_bakong_private.general_authorizations where id=$1',[id]),/Retain/);
    await f.db.query('update tenh_bakong_private.general_authorizations set revoked_at=clock_timestamp() where id=$1',[id]);
    assert.equal((await cap()).data.eligible,false);
    await assert.rejects(f.db.query('update tenh_bakong_private.general_authorizations set revoked_at=null where id=$1',[id]),/one-way/);
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.general_authorization_audit')).rows[0].n,2);
    assert.deepEqual(await counts(f.db),{billing:0,attempts:0,calls:0,invoices:0});
  }finally{await f.db.close();}
});

test('ordinary checkout can pass an unused expired pilot without consuming or changing that pilot',async()=>{
  const f=await pilotFixture();
  try {
    await f.authorize({ageSeconds:7200}); f.env.BAKONG_CHECKOUT_ENABLED='true';
    const pilotBefore=(await f.db.query('select row_to_json(p)::text p from tenh_bakong_private.pilot_authorizations p')).rows[0].p;
    const auditBefore=(await f.db.query('select count(*)::int n from tenh_bakong_private.pilot_audit')).rows[0].n;
    assert.equal((await f.postCheckout()).status,503);
    await authorize(f); f.env.BAKONG_PILOT_ENABLED='false';
    const before=await f.subscription(), started=await f.start();
    const attempt=(await f.db.query('select pilot_authorization_id from bakong_payment_attempts where id=$1',[started.attemptId])).rows[0];
    assert.equal(attempt.pilot_authorization_id,null);
    assert.equal((await f.db.query('select request_time ~ $2 utc from billing_transactions where id=$1',[started.attemptId,'^[0-9]{14}$'])).rows[0].utc,true);
    const result=(await(await f.check(started.attemptId)).json()).attempt;
    assert.equal(result.application,'active'); assert.equal(f.state.calls,1);
    const after=await f.subscription(); assert.equal(after.channel_limit,13); assert.equal(after.member_limit,8);
    assert.equal(after.current_period_start,before.current_period_start); assert.equal(after.current_period_end,before.current_period_end);
    await f.check(started.attemptId); assert.deepEqual(await f.subscription(),after); assert.equal(f.state.calls,1);
    assert.equal((await f.db.query('select row_to_json(p)::text p from tenh_bakong_private.pilot_authorizations p')).rows[0].p,pilotBefore);
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.pilot_audit')).rows[0].n,auditBefore);
    assert.deepEqual(await counts(f.db),{billing:1,attempts:1,calls:1,invoices:1});
  }finally{await f.db.close();}
});

test('issued pilot keeps its expiry/revocation restrictions after general authorization',async()=>{
  const f=await pilotFixture();
  try {
    await f.authorize(); const started=await f.start(); await authorize(f); f.env.BAKONG_CHECKOUT_ENABLED='true';
    await f.db.exec("alter table tenh_bakong_private.pilot_authorizations disable trigger bakong_protect_pilot; update tenh_bakong_private.pilot_authorizations set authorized_at=authorized_at-interval '2 hours',issue_until=issue_until-interval '2 hours',inquiry_until=inquiry_until-interval '2 hours'; alter table tenh_bakong_private.pilot_authorizations enable trigger bakong_protect_pilot");
    await f.check(started.attemptId); assert.equal(f.state.calls,0);
    const view=(await(await f.read(started.attemptId)).json()).attempt;
    assert.equal(view.canCheck,false); assert.equal(view.reconciliationRequired,true); assert.equal(view.qrImage,null);
    assert.equal((await f.start()).attemptId,started.attemptId); assert.equal((await f.subscription()).channel_limit,12);
  }finally{await f.db.close();}
});

test('customer, admin, failures and crashed claims share three lifetime inquiries and preserve pending evidence',async()=>{
  const f=await fixture('production','individual');
  try {
    await authorize(f); const started=await f.start(); f.state.admin=true; f.state.observation='unresolved';
    const admin=f.load('app/api/bakong/admin/route.ts');
    const reconcile=()=>admin.POST(f.post('/api/bakong/admin',{attemptId:started.attemptId,action:'reconcile'}));
    const crash=await f.pg.rpc('tenh_claim_bakong_check',{p_attempt:started.attemptId,p_fingerprint:f.config.fingerprint,p_budget:90});
    assert.equal(crash.data.claimed,true); // Simulated crash: no completion; reservation still consumed.
    await clear(f); await f.check(started.attemptId);
    await clear(f); await Promise.all([f.check(started.attemptId),reconcile(),f.check(started.attemptId)]);
    assert.equal(f.state.calls,2);
    await clear(f); await f.db.exec("update bakong_payment_attempts set check_count=0; update tenh_bakong_private.provider_calls set counted_at=counted_at-interval '2 days'");
    await Promise.all([f.check(started.attemptId),reconcile()]); assert.equal(f.state.calls,2);
    const view=(await(await f.read(started.attemptId)).json()).attempt;
    assert.equal(view.state,'pending'); assert.equal(view.canCheck,false); assert.equal(view.qrImage,null);
    assert.equal(view.automaticChecksRemaining,0); assert.equal(view.reconciliationRequired,true); assert.equal(view.reconciliationReason,'INQUIRY_LIMIT_REVIEW');
    const list=await(await admin.GET(new Request('https://app.tenhchat.com/api/bakong/admin'))).json();
    assert.equal(list.items[0].canCheck,false); assert.equal(list.items[0].reason,'INQUIRY_LIMIT_REVIEW');
    f.body.purchaseIntent=require('node:crypto').randomUUID(); assert.equal((await f.start()).attemptId,started.attemptId);
    assert.deepEqual(await counts(f.db),{billing:1,attempts:1,calls:3,invoices:0});
    assert.equal((await f.db.query('select count(*)::int n from tenh_bakong_private.provider_calls where completed_at is null')).rows[0].n,1);
  }finally{await f.db.close();}
});

test('90 rolling requests reserve three calls per new attempt atomically across workspaces',async()=>{
  const ctx=await database();
  try {
    await ctx.db.exec("insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) select gen_random_uuid(),'synthetic','sandbox',gen_random_uuid() from generate_series(1,85)");
    const results=await Promise.allSettled([prepare(ctx),prepare(ctx)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match(results.find(r=>r.status==='rejected').reason.message,/capacity is reserved/);
    const p=results.find(r=>r.status==='fulfilled').value;
    assert.equal((await ctx.db.query("select tenh_bakong_private.reserved_inquiries('sandbox') n")).rows[0].n,3);
    for(let i=0;i<3;i++) {
      await clear(ctx);
      const claim=(await ctx.db.query('select tenh_claim_bakong_check($1,$2,10000) r',[p.attempt.id,p.fingerprint])).rows[0].r;
      assert.equal(claim.claimed,true);
      assert.equal((await ctx.db.query("select tenh_bakong_private.reserved_inquiries('sandbox') n")).rows[0].n,2-i);
    }
    await clear(ctx);
    assert.equal((await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r',[p.attempt.id,p.fingerprint])).rows[0].r.reason,'INQUIRY_LIMIT_REVIEW');
    await assert.rejects(prepare(ctx),/capacity is reserved/);
    await ctx.db.exec("update tenh_bakong_private.provider_calls set counted_at=counted_at-interval '25 hours'");
    const fresh=await prepare(ctx); assert.notEqual(fresh.attempt.id,p.attempt.id);
    assert.equal((await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r',[p.attempt.id,p.fingerprint])).rows[0].r.reason,'INQUIRY_LIMIT_REVIEW');
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.provider_calls')).rows[0].n,88);
  }finally{await ctx.db.close();}
});

test('new checkout stop and authorization revocation preserve the existing saved payment',async()=>{
  const f=await fixture('production','individual');
  try {
    const id=await authorize(f), started=await f.start(); f.env.BAKONG_CHECKOUT_ENABLED='false';
    assert.equal((await(await f.checkout.GET(new Request('https://app.tenhchat.com/api/bakong/checkout?purchase_business='+f.body.businessId))).json()).enabled,false);
    f.state.observation='pending'; await f.check(started.attemptId); assert.equal(f.state.calls,1);
    await f.db.query('update tenh_bakong_private.general_authorizations set revoked_at=clock_timestamp() where id=$1',[id]);
    await clear(f); await f.check(started.attemptId); assert.equal(f.state.calls,1);
    const view=(await(await f.read(started.attemptId)).json()).attempt;
    assert.equal(view.canCheck,false); assert.equal(view.reconciliationRequired,true); assert.equal(view.state,'pending');
    assert.equal((await f.start()).attemptId,started.attemptId);
    assert.deepEqual(await counts(f.db),{billing:1,attempts:1,calls:1,invoices:0});
  }finally{await f.db.close();}
});

test('delayed and out-of-order observations cannot erase paid evidence or apply a plan twice',async()=>{
  const ctx=await database();
  try {
    const p=await prepare(ctx,{environment:'production',approvedCapacity:true});
    const claim=async()=>(await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r',[p.attempt.id,p.fingerprint])).rows[0].r;
    const old=await claim(); await clear(ctx); const latest=await claim();
    assert.equal(old.claimed,true); assert.equal(latest.claimed,true);
    const paid={state:'paid',settlement:{md5:p.attempt.md5,hash:'e'.repeat(64),recipient:p.attempt.recipient,amount:p.amount,currency:'USD',environment:'production'}};
    const complete=(id,observation)=>ctx.db.query('select tenh_complete_bakong_check($1,$2,$3,$4) r',[p.attempt.id,id,observation,p.userId]);
    const stalePending=(await complete(old.claimId,{state:'pending'})).rows[0].r;
    assert.equal(stalePending.lease_id,latest.claimId,'an old non-paid response cannot clear the current claim');
    const verified=(await complete(latest.claimId,paid)).rows[0].r; assert.equal(verified.state,'verified');
    const apply=()=>ctx.db.query('select tenh_apply_bakong_payment($1,$2) r',[p.attempt.id,p.userId]);
    await Promise.all([apply(),apply()]);
    const subscription=async()=>(await ctx.db.query('select row_to_json(s)::text s from business_subscriptions s where business_id=$1',[p.businessId])).rows[0].s;
    const after=await subscription();
    const duplicate=(await complete(latest.claimId,paid)).rows[0].r; assert.equal(duplicate.state,'applied');
    await complete(old.claimId,{state:'unresolved',retryAfterSeconds:7200}); await apply();
    assert.equal(await subscription(),after);
    assert.deepEqual(await counts(ctx.db),{billing:1,attempts:1,calls:2,invoices:1});
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.settlements')).rows[0].n,1);
  }finally{await ctx.db.close();}
});

test('general migration preserves all financial functions, original OIDs/grants, old payments and private RLS',async()=>{
  const ctx=await database(true,true,false);
  try {
    await ctx.db.exec(fs.readFileSync('db/migrations/20261016043734_bakong_scoped_pilot.sql','utf8'));
    const p=await prepare(ctx,{environment:'production',approvedCapacity:true});
    const functions=async()=>(await ctx.db.query(`select p.oid,p.proname,p.proacl::text acl,p.proowner,p.prosecdef,p.proconfig,
      md5(replace(pg_get_functiondef(p.oid),chr(13),'')) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','tenh_billing_private','tenh_bakong_private') order by p.oid`)).rows;
    const before=await functions(), rows=await counts(ctx.db);
    await ctx.db.exec(sql); const after=await functions();
    for(const previous of before) {
      const current=after.find(row=>row.oid===previous.oid); assert.ok(current);
      if(['tenh_bakong_capacity','tenh_claim_bakong_check','tenh_prepare_bakong_payment'].includes(previous.proname)) assert.deepEqual({...current,body:null},{...previous,body:null});
      else assert.deepEqual(current,previous,previous.proname);
    }
    assert.deepEqual(await counts(ctx.db),rows);
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.general_authorizations')).rows[0].n,0);
    const tables=(await ctx.db.query("select relname,relrowsecurity from pg_class where oid in ('tenh_bakong_private.general_authorizations'::regclass,'tenh_bakong_private.general_authorization_audit'::regclass)")).rows;
    assert.ok(tables.every(row=>row.relrowsecurity));
    await settle(ctx,p); const applied=(await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r',[p.attempt.id,p.userId])).rows[0].r;
    assert.equal(applied.state,'applied');
  }finally{await ctx.db.close();}
});

test('unknown installed function aborts the entire general migration before authorization/schema writes',async()=>{
  const ctx=await database(true,true,false);
  try {
    await ctx.db.exec(fs.readFileSync('db/migrations/20261016043734_bakong_scoped_pilot.sql','utf8'));
    const body=(await ctx.db.query("select pg_get_functiondef('public.tenh_claim_bakong_check(uuid,text,integer)'::regprocedure) s")).rows[0].s;
    await ctx.db.exec(body.replace('check_count=check_count+1','check_count=check_count + 1'));
    await assert.rejects(ctx.db.exec(sql),/Review the installed Bakong contracts/); await ctx.db.exec('rollback');
    assert.equal((await ctx.db.query("select to_regclass('tenh_bakong_private.general_authorizations') missing")).rows[0].missing,null);
    assert.deepEqual(await counts(ctx.db),{billing:0,attempts:0,calls:0,invoices:0});
  }finally{await ctx.db.close();}
});
