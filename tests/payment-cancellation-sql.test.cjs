/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL only: synthetic payments, no bank/network calls or hosted credentials.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { database, prepare, settle } = require('./bakong-fixture.cjs');
const migration = fs.readFileSync('db/migrations/20261016083154_payment_cancellation_safety.sql', 'utf8');
async function setup() {
  const ctx = await database(true, true, true, false);
  await ctx.db.exec("alter table team_members add column if not exists permissions jsonb default '{}'");
  await ctx.db.exec(`alter table manual_payment_requests
    add column if not exists transfer_reference text, add column if not exists customer_note text,
    add column if not exists proof_bucket text, add column if not exists proof_path text,
    add column if not exists proof_file_name text, add column if not exists proof_mime_type text,
    add column if not exists proof_size_bytes bigint`);
  await ctx.db.exec(migration);
  const trial=ctx.trial;
  ctx.trial=async()=>{ const seed=await trial(); await ctx.db.query("insert into businesses(id,name) values($1,'Synthetic workspace') on conflict do nothing",[seed.businessId]); return seed; };
  return ctx;
}
async function owner(ctx) {
  const { businessId } = await ctx.trial(), userId = randomUUID(), memberId = randomUUID();
  await ctx.db.query("insert into team_members(id,user_id,business_id,role,is_active) values($1,$2,$3,'owner',true)", [memberId,userId,businessId]);
  return { businessId,userId,memberId };
}
async function payway(ctx, actor) {
  const id=randomUUID(), reference=id.replaceAll('-','').slice(0,20);
  const expected=(await ctx.db.query('select * from business_subscriptions where business_id=$1',[actor.businessId])).rows[0];
  const amount=(await ctx.db.query("select tenh_expected_subscription_cents('mini','monthly',3,1)::numeric/100 amount")).rows[0].amount;
  await ctx.db.query("insert into billing_transactions(id,business_id,provider,provider_transaction_id,request_time,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,metadata) values($1,$2,'payway',$3,'20261016120000','mini','monthly',$4,'USD','pending',1,3,$5)",
    [id,actor.businessId,reference,amount,{checkout_contract_version:2,environment:'sandbox',live_enabled:false,_expected_subscription:expected}]);
  return { id,reference,amount };
}
async function request(ctx, actor, kind, id, withdraw=false) {
  return (await ctx.db.query('select tenh_request_payment_cancellation($1,$2,$3,$4,$5,$6) r', [kind,id,actor.businessId,actor.userId,actor.memberId,withdraw])).rows[0].r;
}
async function finish(ctx, reference, closed) {
  return (await ctx.db.query('select tenh_finish_payway_cancellation($1,$2,$3) r',[reference,closed,{synthetic:true}])).rows[0].r;
}
async function activate(ctx,row) {
  return (await ctx.db.query("select * from tenh_activate_verified_payway_payment($1,$2,$2,'USD','APPROVED',0,'synthetic',$3,true)", [row.reference,row.amount,{status:{code:'00',tran_id:row.reference}}])).rows[0];
}
async function manual(ctx,actor) {
  const expected=(await ctx.db.query('select * from business_subscriptions where business_id=$1',[actor.businessId])).rows[0];
  const id=randomUUID(), payload={plan_code:'mini',billing_cycle:'monthly',target_member_limit:1,target_channel_limit:3,amount:13,renew_same:false,pricing_snapshot:{},pricing_version:'test',_expected_subscription:expected};
  await ctx.db.query("insert into manual_payment_uploads(id,business_id,member_id,storage_path,file_name,mime_type,size_bytes,selection,request_payload) values($1,$2,$3,$4,'proof.png','image/png',100,'{}',$5)", [id,actor.businessId,actor.memberId,`${actor.businessId}/${id}/proof.png`,payload]);
  return id;
}
test('PayWay closes once, records actor/time, preserves subscription and safely allows a new claim',async()=>{
  const ctx=await setup();try {
    const actor=await owner(ctx), row=await payway(ctx,actor);
    const before=(await ctx.db.query('select * from business_subscriptions where business_id=$1',[actor.businessId])).rows[0];
    assert.equal((await request(ctx,actor,'payway',row.reference)).claimed,true);
    assert.equal((await request(ctx,actor,'payway',row.reference)).claimed,false);
    const result=await finish(ctx,row.reference,true);
    assert.equal(result.outcome,'cancelled');assert.equal(result.actor_user_id,actor.userId);assert.ok(result.completed_at);
    assert.equal((await finish(ctx,row.reference,true)).outcome,'cancelled');
    assert.deepEqual((await ctx.db.query('select * from business_subscriptions where business_id=$1',[actor.businessId])).rows[0],before);
    await payway(ctx,actor);
    assert.equal((await ctx.db.query('select count(*)::int n from payment_cancellations')).rows[0].n,1);
  }finally{await ctx.db.close();}
});
test('PayWay uncertainty blocks another provider; a timed-out request cannot be claimed twice',async()=>{
  const ctx=await setup();try{
    const actor=await owner(ctx),row=await payway(ctx,actor);
    await request(ctx,actor,'payway',row.reference);
    await assert.rejects(manual(ctx,actor),/reconciliation/);
    assert.equal((await finish(ctx,row.reference,false)).outcome,'reconciliation_required');
    assert.equal((await request(ctx,actor,'payway',row.reference)).claimed,false);
    await assert.rejects(payway(ctx,actor),/reconciliation/);
  }finally{await ctx.db.close();}
});
test('payment wins before/while closing; cancellation wins before a late approval, which is reconciled',async()=>{
  const ctx=await setup();try{
    for(const order of ['paid-first','during-close','cancel-first']) {
      const actor=await owner(ctx),row=await payway(ctx,actor);
      if(order==='paid-first') {
        assert.equal((await activate(ctx,row)).subscription_status,'active');
        await assert.rejects(request(ctx,actor,'payway',row.reference),/no longer awaiting/);
      }else if(order==='during-close') {
        await request(ctx,actor,'payway',row.reference);
        assert.equal((await activate(ctx,row)).subscription_status,'active');
        assert.equal((await ctx.db.query('select outcome from payment_cancellations where payment_id=$1',[row.reference])).rows[0].outcome,'paid');
        assert.equal((await finish(ctx,row.reference,true)).outcome,'paid');
      }else{
        await request(ctx,actor,'payway',row.reference);await finish(ctx,row.reference,true);
        assert.equal((await activate(ctx,row)).subscription_status,'recovery_required');
        assert.equal((await ctx.db.query("select outcome from payment_cancellations where payment_id=$1",[row.reference])).rows[0].outcome,'reconciliation_required');
        assert.equal((await activate(ctx,row)).subscription_status,'recovery_required');
        assert.equal((await ctx.db.query('select count(*)::int n from tenh_billing_invoices where source_payment_id=$1',[row.id])).rows[0].n,0);
        await assert.rejects(manual(ctx,actor),/reconciliation/);
      }
    }
  }finally{await ctx.db.close();}
});
test('manual awaiting cancellation and explicit submitted withdrawal preserve proof/audit and block unsafe retry',async()=>{
  const ctx=await setup();try{
    const actor=await owner(ctx),id=await manual(ctx,actor);
    assert.equal((await request(ctx,actor,'manual',id)).outcome,'cancelled');
    assert.equal((await ctx.db.query('select state from manual_payment_uploads where id=$1',[id])).rows[0].state,'aborted');
    const next=await manual(ctx,actor);
    await ctx.db.query('select tenh_finalize_manual_payment_upload($1,$2,$3)',[next,actor.businessId,actor.memberId]);
    await assert.rejects(request(ctx,actor,'manual',next),/explicit withdrawal/);
    assert.equal((await request(ctx,actor,'manual',next,true)).outcome,'withdrawn');
    const saved=(await ctx.db.query('select * from manual_payment_requests where id=$1',[next])).rows[0];
    assert.equal(saved.status,'cancelled');assert.ok(saved.proof_path);
    assert.equal((await request(ctx,actor,'manual',next,true)).claimed,false);
    await assert.rejects(manual(ctx,actor),/reconciliation/);
    // Approval's existing application guard rejects a proof withdrawn under the same row lock.
    await assert.rejects(ctx.db.query("update manual_payment_requests set status='approved' where id=$1",[next]),/terminal|unsubmitted/);
  }finally{await ctx.db.close();}
});
test('KHQR cancellation closes only the checkout; inquiries and late settlement evidence are retained without activation',async()=>{
  const ctx=await setup();try{
    const p=await prepare(ctx,{environment:'production',approvedCapacity:true});
    const budget=await ctx.db.query("select * from tenh_bakong_private.provider_calls");
    assert.equal((await request(ctx,p,'bakong',p.attempt.id)).outcome,'checkout_closed');
    assert.deepEqual((await ctx.db.query('select * from tenh_bakong_private.provider_calls')).rows,budget.rows);
    assert.equal((await settle(ctx,p)).result.state,'review');
    assert.equal((await ctx.db.query('select tenh_apply_bakong_payment($1,$2) r',[p.attempt.id,p.userId])).rows[0].r.state,'review');
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.provider_calls')).rows[0].n,1);
    assert.equal((await ctx.db.query('select count(*)::int n from tenh_bakong_private.settlements')).rows[0].n,1);
    const expired=await prepare(ctx,{expiryMs:100});
    await new Promise(resolve=>setTimeout(resolve,200));
    // An expired checkout is already closed: nothing is recorded and nothing blocks a new purchase.
    assert.equal((await request(ctx,expired,'bakong',expired.attempt.id)).outcome,'expired');
    assert.equal((await ctx.db.query('select count(*)::int n from payment_cancellations where payment_id=$1',[expired.attempt.id])).rows[0].n,0);
  }finally{await ctx.db.close();}
});
test('database authorization denies view-only, revoked/cross-workspace membership and direct client access',async()=>{
  const ctx=await setup();try{
    const actor=await owner(ctx),row=await payway(ctx,actor);
    await ctx.db.query("update team_members set role='agent' where id=$1",[actor.memberId]);
    await assert.rejects(request(ctx,actor,'payway',row.reference),/permission/);
    await ctx.db.query("update team_members set permissions='{"+'"billing":"manage"'+"}' where id=$1",[actor.memberId]);
    assert.equal((await request(ctx,actor,'payway',row.reference)).claimed,true);
    await ctx.db.query('update team_members set is_active=false where id=$1',[actor.memberId]);
    await assert.rejects(request(ctx,actor,'payway',row.reference),/permission/);
    const other=await owner(ctx);
    await assert.rejects(request(ctx,{...actor,userId:other.userId,memberId:other.memberId},'payway',row.reference),/permission/);
    assert.equal((await ctx.db.query("select has_function_privilege('authenticated','tenh_request_payment_cancellation(text,text,uuid,uuid,uuid,boolean)','execute') allowed")).rows[0].allowed,false);
    assert.equal((await ctx.db.query("select has_table_privilege('service_role','payment_cancellations','UPDATE') allowed")).rows[0].allowed,false);
    await assert.rejects(ctx.db.exec("set role authenticated; select * from payment_cancellations"),/permission/);
    await ctx.db.exec('reset role');
  }finally{await ctx.db.close();}
});
