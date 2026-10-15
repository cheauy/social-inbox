/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {database,prepare,settle}=require('./bakong-fixture.cjs');

test('Bakong migration, claims, capacity isolation and shared rolling budget use real local PostgreSQL', async () => {
  const ctx = await database();
  try {
    const p = await prepare(ctx);
    assert.equal((await p.invoke()).rows[0].result.id, p.attempt.id);
    assert.equal((await ctx.db.query('select count(*)::int n from billing_transactions where business_id=$1', [p.businessId])).rows[0].n, 1);
    const [one, two] = await Promise.all([ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r', [p.attempt.id, p.fingerprint]), ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r', [p.attempt.id, p.fingerprint])]);
    assert.equal([one.rows[0].r, two.rows[0].r].filter(r => r.claimed).length, 1);
    const capacity = (await ctx.db.query("select tenh_bakong_capacity($1,'production','merchant@devb',90) r", ['unreviewed'])).rows[0].r;
    assert.equal(capacity.eligible, false);
    assert.equal((await ctx.db.query("select has_function_privilege('authenticated','public.tenh_claim_bakong_check(uuid,text,integer)','EXECUTE') allowed")).rows[0].allowed, false);
    await assert.rejects(ctx.db.exec("set role authenticated; select * from bakong_payment_attempts"), /permission denied/);
    await ctx.db.exec('reset role');
  } finally { await ctx.db.close(); }
});

test('verified production applies once through existing subscription/invoice math; test payments never activate', async () => {
  const ctx = await database();
  try {
    const p = await prepare(ctx, { environment: 'production', approvedCapacity: true });
    const verified = await settle(ctx, p);
    assert.equal(verified.result.state, 'verified');
    const concurrent = await Promise.all([0,1].map(() => ctx.db.query('select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])));
    assert.ok(concurrent.every(result => result.rows[0].r.state === 'applied'));
    const first = concurrent[0].rows[0].r;
    assert.equal(first.state, 'applied', first.reason);
    const before = (await ctx.db.query('select * from business_subscriptions where business_id=$1', [p.businessId])).rows[0];
    assert.equal(before.payment_provider, 'bakong');
    const second = (await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])).rows[0].r;
    assert.equal(second.state, 'applied');
    assert.deepEqual((await ctx.db.query('select * from business_subscriptions where business_id=$1', [p.businessId])).rows[0], before);
    const invoice = (await ctx.db.query('select * from tenh_billing_invoices where source_payment_id=$1', [p.attempt.id])).rows;
    assert.equal(invoice.length, 1); assert.equal(invoice[0].source_type, 'bakong'); assert.equal(invoice[0].provider, 'bakong');
    await ctx.db.exec("update tenh_bakong_private.request_budgets set blocked_until=null");
    const sandbox = await prepare(ctx), baseline = (await ctx.db.query('select * from business_subscriptions where business_id=$1', [sandbox.businessId])).rows[0];
    assert.equal((await settle(ctx, sandbox, 'b'.repeat(64))).result.state, 'test_paid');
    await ctx.db.query('select tenh_apply_bakong_payment($1,$2)', [sandbox.attempt.id, sandbox.userId]);
    assert.deepEqual((await ctx.db.query('select * from business_subscriptions where business_id=$1', [sandbox.businessId])).rows[0], baseline);
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_billing_invoices where source_payment_id=$1', [sandbox.attempt.id])).rows[0].n, 0);
  } finally { await ctx.db.close(); }
});

test('late settlement, changed subscription, consumed hashes, removed membership and activation failures remain recoverable', async t => {
  const ctx = await database();
  const resetCooldown = () => ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
  try {
    await t.test('failed invoice rolls back application but preserves verified evidence for a safe retry', async () => {
      const p = await prepare(ctx, { environment: 'production', approvedCapacity: true });
      await settle(ctx, p, 'c'.repeat(64));
      await ctx.db.exec("create function fixture_bakong_invoice_failure() returns trigger language plpgsql as $$begin raise exception 'fixture unavailable'; end$$; create trigger fixture_bakong_invoice_failure before insert on tenh_billing_invoices for each row execute function fixture_bakong_invoice_failure();");
      const failed = (await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])).rows[0].r;
      assert.equal(failed.state, 'verified'); assert.equal(failed.reason, 'ACTIVATION_PENDING'); assert.equal(failed.verified_hash, 'c'.repeat(64));
      assert.equal((await ctx.db.query('select status from billing_transactions where id=$1', [p.attempt.id])).rows[0].status, 'pending');
      await ctx.db.exec('drop trigger fixture_bakong_invoice_failure on tenh_billing_invoices');
      const applied = (await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])).rows[0].r;
      assert.equal(applied.state, 'applied');
    });
    await resetCooldown();
    await t.test('a verified payment never overwrites a newer entitlement or restores removed membership', async () => {
      const p = await prepare(ctx, { environment: 'production', approvedCapacity: true }); await settle(ctx, p, 'd'.repeat(64));
      await ctx.db.query("update business_subscriptions set plan_code='pro',updated_at=now() where business_id=$1", [p.businessId]);
      const result = (await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r', [p.attempt.id, p.userId])).rows[0].r;
      assert.equal(result.state, 'review'); assert.equal(result.reason, 'SUBSCRIPTION_CHANGED');
      await resetCooldown();
      const removed = await prepare(ctx, { environment: 'production', approvedCapacity: true }); await settle(ctx, removed, 'e'.repeat(64));
      await ctx.db.query('update team_members set is_active=false where id=$1', [removed.memberId]);
      assert.equal((await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r', [removed.attempt.id, removed.userId])).rows[0].r.reason, 'PURCHASER_MEMBERSHIP_REMOVED');
    });
    await resetCooldown();
    await t.test('full transaction identity is single-use across workspaces and evidence cannot change', async () => {
      const p = await prepare(ctx); await settle(ctx, p, 'f'.repeat(64)); await resetCooldown();
      const duplicate = await prepare(ctx); const repeated = await settle(ctx, duplicate, 'f'.repeat(64));
      assert.equal(repeated.result.state, 'review'); assert.equal(repeated.result.reason, 'TRANSACTION_ALREADY_CONSUMED');
      await assert.rejects(ctx.db.query("update bakong_payment_attempts set recipient='forged@bank' where id=$1", [p.attempt.id]), /immutable/);
      await assert.rejects(ctx.db.query("update billing_transactions set amount=1 where id=$1", [p.attempt.id]), /immutable/);
    });
    await resetCooldown();
    await t.test('expired QR remains pending until a real check; late paid evidence is retained for review', async () => {
      const p = await prepare(ctx, { environment: 'production', approvedCapacity: true, expiryMs: 200 });
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal((await ctx.db.query('select state from bakong_payment_attempts where id=$1', [p.attempt.id])).rows[0].state, 'pending');
      const result = await settle(ctx, p, '1'.repeat(64));
      assert.equal(result.result.state, 'review'); assert.equal(result.result.reason, 'LATE_PAYMENT_REVIEW');
      assert.equal(result.result.verified_hash, '1'.repeat(64));
    });
  } finally { await ctx.db.close(); }
});

test('all providers share workspace claims and every provider call consumes the 24-hour budget, including errors', async () => {
  const ctx = await database();
  try {
    const p = await prepare(ctx);
    await assert.rejects(ctx.db.query("insert into billing_transactions(business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,metadata) values($1,'payway',$2,'mini','monthly',$3,'USD','pending',1,3,$4)",
      [p.businessId, randomUUID(), p.amount, { _expected_subscription: p.args[0]._expected_subscription }]), /unresolved payment/);
    await assert.rejects(ctx.db.query("insert into manual_payment_requests(business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit) values($1,'mini','monthly',$2,'USD','submitted',1,3)", [p.businessId, p.amount]), /unresolved payment/);
    const unrelated = await prepare(ctx); assert.notEqual(unrelated.businessId, p.businessId);
    const claim = (await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r', [p.attempt.id, p.fingerprint])).rows[0].r;
    assert.equal(claim.claimed, true);
    await ctx.db.query('select tenh_complete_bakong_check($1,$2,$3,$4)', [p.attempt.id, claim.claimId, { state: 'unresolved', retryAfterSeconds: 7200 }, p.userId]);
    const blocked = (await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r', [unrelated.attempt.id, p.fingerprint])).rows[0].r;
    assert.equal(blocked.claimed, false); assert.equal(blocked.reason, 'cooldown');
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.provider_calls')).rows[0].n, 1, 'an error consumed one request');
    await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
    await ctx.db.query("insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) select gen_random_uuid(),$1,'sandbox',$2 from generate_series(1,89)", [p.fingerprint,p.attempt.id]);
    const exhausted = (await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r', [unrelated.attempt.id, p.fingerprint])).rows[0].r;
    assert.equal(exhausted.claimed, false); assert.equal(exhausted.reason, 'budget');
    const rotated = (await ctx.db.query('select tenh_claim_bakong_check($1,$2,90) r', [unrelated.attempt.id, 'g'.repeat(64)])).rows[0].r;
    assert.equal(rotated.claimed, false); assert.equal(rotated.reason, 'budget', 'rotating a token never resets the shared allowance');
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.provider_calls')).rows[0].n, 90);
    assert.equal((await ctx.db.query('select state from bakong_payment_attempts where id=$1', [p.attempt.id])).rows[0].state, 'pending');
    await ctx.db.exec('grant select,update on billing_transactions to authenticated; set role authenticated');
    await assert.rejects(ctx.db.query("update billing_transactions set status='approved' where id=$1", [p.attempt.id]), /trusted billing service/);
    await ctx.db.exec('reset role');
  } finally { await ctx.db.close(); }
});


test('quota admission reserves three checks per obligation before showing another QR',async()=>{
  const ctx=await database();try{
    await prepare(ctx);await ctx.db.query("insert into tenh_bakong_private.provider_calls(id,fingerprint,environment,attempt_id) select gen_random_uuid(),'fixture','sandbox',gen_random_uuid() from generate_series(1,85)");
    const capacity=(await ctx.db.query("select tenh_bakong_capacity('fixture','sandbox','merchant@devb',90) r")).rows[0].r;
    assert.equal(capacity.canIssue,false);assert.equal(capacity.budget,90);
    await assert.rejects(prepare(ctx),/capacity is reserved/);
    assert.equal((await ctx.db.query('select count(*)::int n from bakong_payment_attempts')).rows[0].n,1);
  }finally{await ctx.db.close();}
});

test('unknown installed activation contracts roll the whole migration back without changing old data',async()=>{
  const ctx=await database(false);try{
    const installed=(await ctx.db.query("select pg_get_functiondef('tenh_billing_private.activate_payway_v2(text,numeric,numeric,text,text,integer,text,jsonb,boolean)'::regprocedure) source")).rows[0].source;
    await ctx.db.exec(installed.replaceAll('payway_verified_payload','unknown_fixture_field'));
    const source=require('node:fs').readFileSync('db/migrations/20261015140343_bakong_subscription_payments.sql','utf8');
    await assert.rejects(ctx.db.exec(source),/Review the installed activation contract/);await ctx.db.exec('rollback');
    assert.equal((await ctx.db.query("select to_regnamespace('tenh_bakong_private') n")).rows[0].n,null);
    assert.equal((await ctx.db.query("select to_regclass('public.bakong_payment_attempts') n")).rows[0].n,null);
  }finally{await ctx.db.close();}
});


test('installed Bakong migration preserves original ABA and manual activation/invoice paths',async()=>{
  const ctx=await database();try{
    for(const manual of [false,true]){
      const seeded=await ctx.trial(),id=randomUUID();
      const amount=(await ctx.db.query("select (tenh_expected_subscription_cents('mini','monthly',3,1)::numeric/100)::numeric(18,2) amount")).rows[0].amount;
      const expected=(await ctx.db.query('select to_jsonb(s) snapshot from business_subscriptions s where business_id=$1',[seeded.businessId])).rows[0].snapshot;
      if(manual)await ctx.db.query("insert into manual_payment_requests(id,business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit) values($1,$2,'mini','monthly',$3,'USD','submitted',1,3)",[id,seeded.businessId,amount]);
      else await ctx.db.query("insert into billing_transactions(id,business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,metadata) values($1,$2,'payway',$5,'mini','monthly',$3,'USD','pending',1,3,$4)",[id,seeded.businessId,amount,{environment:'sandbox',live_enabled:false,checkout_contract_version:2,_expected_subscription:expected},id]);
      const apply=()=>manual?ctx.db.query('select * from tenh_approve_manual_payment($1)',[id]):ctx.db.query("select * from tenh_activate_verified_payway_payment($1,$2,$2,'USD','APPROVED',0,'synthetic',$3,true)",[id,amount,{status:{code:'00',tran_id:id}}]);
      assert.equal((await apply()).rows[0].subscription_status,'active');
      assert.equal((await apply()).rows[0].already_approved,true);
      const invoices=(await ctx.db.query('select * from tenh_billing_invoices where source_payment_id=$1',[id])).rows;
      assert.equal(invoices.length,1);assert.equal(invoices[0].source_type,manual?'manual':'payway');assert.equal(invoices[0].amount,amount);
    }
  }finally{await ctx.db.close();}
});
