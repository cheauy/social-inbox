/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic PostgreSQL node:test harness. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { setup, seed } = require('./payway-compat-fixture.cjs');
const policy = 'preserve_member_reference_redact_member_profile';

async function fixture(count = 2) {
  const db = await setup({ install: false });
  const { businessId } = await seed(db);
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    alter table team_members add primary key(id);
    alter table businesses add primary key(id);
    alter table team_members add foreign key(user_id) references auth.users(id) on delete set null;
    alter table team_members add foreign key(business_id) references businesses(id) on delete cascade;
    alter table billing_transactions add foreign key(requested_by_member_id) references team_members(id) on delete set null;
    alter table billing_transactions add foreign key(business_id) references businesses(id) on delete cascade;
    alter table manual_payment_requests add foreign key(requested_by_member_id) references team_members(id) on delete set null;`);
  await db.query("insert into businesses values($1,'Synthetic workspace')", [businessId]);
  const ids = (await db.query('select gen_random_uuid() as user_id,gen_random_uuid() as member_id,gen_random_uuid() as outsider')).rows[0];
  await db.query('insert into auth.users values($1)', [ids.user_id]);
  await db.query("insert into team_members values($1,$2,$3,'Synthetic person','synthetic@example.invalid','owner',false)", [ids.member_id, ids.user_id, businessId]);
  await db.exec(fs.readFileSync('tests/fixtures/payway-legacy-coexistence-core.sql', 'utf8'));
  await db.exec("set session_replication_role='replica'");
  for (let i = 0; i < count; i++) await db.query(`insert into billing_transactions(business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,requested_by_member_id)
    values($1,'payway',$2,'mini','monthly',12,'USD','pending',$3)`, [businessId, `synthetic-retained-${i}`, ids.member_id]);
  await db.exec("set session_replication_role='origin'");
  await db.query(`insert into tenh_billing_private.legacy_payway_enrollments
    select b.id,b.provider_transaction_id,b.business_id,tenh_compat_payment_identity(to_jsonb(b)),tenh_compat_subscription_identity(to_jsonb(s)),
    'review',false,'UNKNOWN','synthetic review',clock_timestamp() from billing_transactions b
    join business_subscriptions s on s.business_id=b.business_id where b.business_id=$1`, [businessId]);
  const snapshot = async () => (await db.query('select tenh_billing_private.account_deletion_snapshot($1) as v', [ids.user_id])).rows[0].v;
  const reviews = async () => (await snapshot()).payments.map(p => ({source_payment_id:p.source_payment_id,
    identity_fingerprint:p.identity_fingerprint, payment_status:p.status,
    review_disposition:p.status==='pending'?'retain_unresolved_recovery':p.status==='approved'?'approved_verified':'resolved_terminal',
    evidence_kind:'authoritative_operator_case_review',evidence_reference:'synthetic case review',evidence_sha256:'a'.repeat(64),
    authorizes_account_unlink_only:true,preserves_financial_history:true}));
  const release = async (items, ref='synthetic-release', user=ids.user_id, operator='synthetic-operator', disposition=policy) =>
    (await db.query('select tenh_billing_private.release_account_deletion($1,$2,$3,$4,$5) as v', [user,ref,operator,items,disposition])).rows[0].v;
  const held = async () => (await db.query('select tenh_get_account_deletion_billing_hold($1) as v', [ids.user_id])).rows[0].v.held;
  const financials = async () => (await db.query(`select jsonb_build_object(
    'payments',(select jsonb_agg(to_jsonb(b) order by id) from billing_transactions b),
    'subscriptions',(select jsonb_agg(to_jsonb(s) order by business_id) from business_subscriptions s),
    'invoices',(select coalesce(jsonb_agg(to_jsonb(i) order by id),'[]') from tenh_billing_invoices i),
    'enrollments',(select jsonb_agg(to_jsonb(e) order by source_payment_id) from tenh_billing_private.legacy_payway_enrollments e)) as v`)).rows[0].v;
  return { db,businessId,...ids,snapshot,reviews,release,held,financials };
}

test('real SET ROLE denies release and private audit access to all application roles', async () => {
  const h=await fixture(); try {
    const items=await h.reviews();
    for (const role of ['anon','authenticated','service_role']) {
      await h.db.exec(`set role ${role}`);
      await assert.rejects(()=>h.release(items), /permission denied/);
      await assert.rejects(()=>h.db.exec('select * from tenh_billing_private.account_deletion_releases'), /permission denied/);
      await h.db.exec('reset role');
    }
    assert.equal((await h.release(items)).currently_effective,true);
    await assert.rejects(()=>h.db.exec('update tenh_billing_private.account_deletion_releases set operator_reference=\'changed\''), /append-only/);
    await assert.rejects(()=>h.db.exec('delete from tenh_billing_private.account_deletion_releases'), /append-only/);
  } finally {await h.db.close();}
});

test('invalid, missing, partial, duplicate, wrong-user and mismatched evidence fail without financial or grant mutations', async () => {
  const h=await fixture(); try {
    const items=await h.reviews(), before=await h.financials();
    const invalid = [null,{},[],items.slice(0,1),[items[0],items[0]]];
    for (const [field,value] of Object.entries({source_payment_id:h.outsider,identity_fingerprint:'bad',payment_status:'failed',
      review_disposition:'resolved_terminal',evidence_kind:'provider_not_found',evidence_reference:'',evidence_sha256:'x',
      authorizes_account_unlink_only:'true',preserves_financial_history:false,unapproved_field:true})) {
      invalid.push([{...items[0],[field]:value},items[1]]);
    }
    invalid.push([{...items[0],evidence_reference:123},items[1]]);
    for (const value of invalid) await assert.rejects(()=>h.release(value), /required|review|unresolved|invalid/i);
    await assert.rejects(()=>h.release(items,'wrong-user',h.outsider), /No affected/);
    await assert.rejects(()=>h.release(items,'wrong-policy',h.user_id,'op','delete_financial_history'), /required/);
    await assert.rejects(()=>h.release(items,'missing-op',h.user_id,''), /required/);
    assert.equal(await h.held(),true); assert.deepEqual(await h.financials(),before);
    assert.equal((await h.db.query('select count(*)::int as n from tenh_billing_private.account_deletion_releases')).rows[0].n,0);
  } finally {await h.db.close();}
});

test('explicit pending-case review only permits Auth unlink; financials, requester and durable minimal audit survive', async () => {
  const h=await fixture(); try {
    const before=await h.financials(), items=await h.reviews();
    const grant=await h.release(items); assert.equal(grant.scope,'account_unlink_only'); assert.equal(await h.held(),false);
    assert.deepEqual(await h.financials(),before);
    await h.db.query("update team_members set full_name='Deleted user',email='deleted@example.invalid',is_active=false where id=$1", [h.member_id]);
    assert.equal(await h.held(),false);
    await h.db.query('delete from auth.users where id=$1', [h.user_id]);
    const member=(await h.db.query('select * from team_members where id=$1',[h.member_id])).rows[0];
    assert.equal(member.user_id,null); assert.equal(member.id,h.member_id);
    assert.deepEqual(await h.financials(),before);
    const audit=(await h.db.query('select * from tenh_billing_private.account_deletion_releases')).rows[0];
    assert.equal(audit.user_id,h.user_id); assert.equal(audit.id,grant.release_id);
    assert.doesNotMatch(JSON.stringify(audit), /synthetic@example|Synthetic person/);
    assert.equal((await h.release(items)).already_released,true);
    await assert.rejects(()=>h.db.query('delete from team_members where id=$1',[h.member_id]), /identity|immutable/i);
    await assert.rejects(()=>h.db.query('delete from businesses where id=$1',[h.businessId]), /cannot be deleted/);
    assert.deepEqual(await h.financials(),before);
  } finally {await h.db.close();}
});

test('exact replay is idempotent; stale conflict, new pending purchase and changed membership invalidate permission', async () => {
  const h=await fixture(); try {
    const items=await h.reviews(), first=await h.release(items);
    const replay=await h.release(items); assert.equal(replay.release_id,first.release_id); assert.equal(replay.already_released,true);
    await assert.rejects(()=>h.release(items,'synthetic-release',h.user_id,'another-operator'), /replay differs/);
    await assert.rejects(()=>h.release(items,'synthetic-release',h.outsider), /replay differs/);
    await assert.rejects(()=>h.release([{...items[0],evidence_reference:'changed'},items[1]]), /replay differs/);
    await h.db.query("select tenh_billing_private.record_event('payway',$1,$2,'recovery_required','synthetic late conflict','{}')",[items[0].source_payment_id,h.businessId]);
    assert.equal(await h.held(),true); assert.equal((await h.release(items)).currently_effective,false);
    assert.equal((await h.release(await h.reviews(),'fresh-review')).currently_effective,true);
    await h.db.query("update team_members set role='agent' where id=$1",[h.member_id]); assert.equal(await h.held(),true);
    await h.release(await h.reviews(),'role-review');
    await h.db.exec("set session_replication_role='replica'");
    await h.db.query("insert into manual_payment_requests(business_id,status) values($1,'submitted')",[h.businessId]);
    await h.db.exec("set session_replication_role='origin'");
    assert.equal(await h.held(),true);
    await assert.rejects(async()=>h.release(await h.reviews(),'new-purchase-review'), /Other unresolved/);
  } finally {await h.db.close();}
});

test('partial authoritative terminal resolution remains held until every affected case is explicitly reviewed', async () => {
  const h=await fixture(); try {
    const items=await h.reviews();
    const payment=(await h.db.query('select * from billing_transactions where id=$1',[items[0].source_payment_id])).rows[0];
    await h.db.query("select tenh_billing_private.resolve_legacy_payment($1,'failed','synthetic resolution',$2)",[payment.id,{
      owner_authorization_reference:'synthetic authorization',merchant_binding_verified:true,provider_status_code:'00',payment_status:'FAILED',provider_transaction_id:payment.provider_transaction_id}]);
    assert.equal(await h.held(),true);
    await assert.rejects(async()=>h.release([ (await h.reviews())[0] ]), /Every affected/);
    const before=await h.financials(); await h.release(await h.reviews()); assert.equal(await h.held(),false);
    assert.deepEqual(await h.financials(),before);
    assert.deepEqual(before.payments.map(p=>p.status).sort(),['failed','pending']);
  } finally {await h.db.close();}
});

test('release authorization expires after 30 minutes; stale replay cannot refresh expiry', async () => {
  const h=await fixture(); try {
    const items=await h.reviews(); await h.release(items);
    const audit=(await h.db.query('select extract(epoch from (expires_at-released_at)) as seconds from tenh_billing_private.account_deletion_releases')).rows[0];
    assert.ok(Number(audit.seconds)>=1799 && Number(audit.seconds)<=1801);
    // Synthetic time passage only: bypass the immutable trigger to test the expired branch without waiting.
    await h.db.exec("set session_replication_role='replica'; update tenh_billing_private.account_deletion_releases set expires_at=clock_timestamp()-interval '1 second'; set session_replication_role='origin'");
    assert.equal(await h.held(),true); assert.equal((await h.release(items)).currently_effective,false);
    assert.equal((await h.release(items,'new-timed-review')).currently_effective,true);
  } finally {await h.db.close();}
});

test('terminal and approved states require existing guarded audit and a financially matching paid receipt', async () => {
  const h=await fixture(1); try {
    const payment=(await h.db.query('select * from billing_transactions')).rows[0];
    await h.db.exec("set session_replication_role='replica'; update billing_transactions set status='failed'; set session_replication_role='origin'");
    await assert.rejects(async()=>h.release(await h.reviews()), /resolution audit/);
    await h.db.exec("set session_replication_role='replica'; update billing_transactions set status='approved'; set session_replication_role='origin'");
    await assert.rejects(async()=>h.release(await h.reviews()), /guarded approval/);
    await h.db.query("select tenh_billing_private.record_event('payway',$1,$2,'applied',null,'{}')",[payment.id,h.businessId]);
    await h.db.exec("set session_replication_role='replica'");
    await h.db.query("insert into tenh_billing_invoices(source_type,source_payment_id,business_id,status,amount,currency) values('payway',$1,$2,'paid',12,'USD')",[payment.id,h.outsider]);
    await h.db.exec("set session_replication_role='origin'");
    await assert.rejects(async()=>h.release(await h.reviews()), /matching receipt/);
    await h.db.query('update tenh_billing_invoices set business_id=$1,amount=11 where source_payment_id=$2',[h.businessId,payment.id]);
    await assert.rejects(async()=>h.release(await h.reviews()), /matching receipt/);
    await h.db.query("update tenh_billing_invoices set amount=12,currency='KHR' where source_payment_id=$1",[payment.id]);
    await assert.rejects(async()=>h.release(await h.reviews()), /matching receipt/);
    assert.equal(await h.held(),true);
  } finally {await h.db.close();}
});

test('unresolved paid access cannot be cancelled, shortened, nulled or prematurely expired/suspended before or after release', async () => {
  const h=await fixture(); try {
    const before=await h.financials();
    for (const released of [false,true]) {
      if(released) await h.release(await h.reviews());
      for (const change of ["status='cancelled'","current_period_end=current_period_end-interval '1 day'","current_period_end=null","status='expired'","status='suspended'","status='past_due'"]) {
        await assert.rejects(()=>h.db.query('update business_subscriptions set '+change+' where business_id=$1',[h.businessId]), /prevent ending/);
        assert.deepEqual(await h.financials(),before);
      }
    }
  } finally {await h.db.close();}
});

test('ordinary expiry after the paid term passes is allowed while retaining pending financial recovery', async () => {
  const h=await fixture(); try {
    await h.db.exec("set session_replication_role='replica'");
    await h.db.query("update business_subscriptions set current_period_end=clock_timestamp()-interval '1 day' where business_id=$1",[h.businessId]);
    await h.db.exec("set session_replication_role='origin'");
    await h.db.query("update business_subscriptions set status='expired' where business_id=$1",[h.businessId]);
    assert.equal(await h.held(),true);
    assert.equal((await h.db.query("select count(*)::int as n from billing_transactions where status='pending'")).rows[0].n,2);
  } finally {await h.db.close();}
});
