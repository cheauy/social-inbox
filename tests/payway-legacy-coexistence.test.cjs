/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
// Synthetic isolated PostgreSQL only. No network, production connection or real records.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup,seed,purchase,functions}=require('./payway-compat-fixture.cjs');
async function database(){
 const db=await setup();
 const source=async signature=>(await db.query("select pg_get_functiondef($1::regprocedure) as source",[signature])).rows[0].source;
 const v2=await source('public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)');
 const manual=await source('public.tenh_approve_manual_payment(uuid,uuid,text,text)');
 const guard=await source('public.tenh_guard_custom_upgrade_approval()');
 await db.exec('drop index billing_transactions_one_pending_payway_per_business_idx');
 await db.exec(fs.readFileSync('tests/fixtures/payway-legacy-coexistence-core.sql','utf8'));
 for(const [body,name] of [[functions[0],'activate_payway_v1'],[v2,'activate_payway_v2'],[manual,'approve_manual_v2']])
   await db.exec(body.replace(/CREATE OR REPLACE FUNCTION public\.\w+\(/,'CREATE OR REPLACE FUNCTION tenh_billing_private.'+name+'(')+';');
 const exception="\n if tg_table_name='billing_transactions' and new.status='approved' and old.status is distinct from 'approved' and coalesce(new.pricing_snapshot->>'custom_upgrade_version','')<>'2' and public.tenh_legacy_approval_authorized(new.id) then return new; end if;\n";
 await db.exec(guard.replace(/\nbegin\n/i,'\nbegin\n'+exception)+';');
 await db.exec('revoke all on all functions in schema tenh_billing_private from public,anon,authenticated,service_role');
 return db;
}
async function legacy(db,options={}){
 const fixture=await seed(db,options.subscription||{}),extension=options.extension??2;
 const end=(await db.query("select (($1::timestamptz at time zone 'UTC')+make_interval(months=>$2)) at time zone 'UTC' as value",[fixture.subscription.current_period_end,extension])).rows[0].value;
 const saved={purchase_type:'custom-upgrade',current_billing_cycle:fixture.subscription.billing_cycle,current_period_end:fixture.subscription.current_period_end,new_period_end:new Date(end).toISOString(),extension_months:extension,renewal_total_cents:7125};
 await db.exec("set session_replication_role='replica'");
 const rows=[];
 try{for(let i=0;i<(options.count??1);i++)rows.push((await db.query("insert into billing_transactions(business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,pricing_snapshot,metadata) values($1,'payway',gen_random_uuid()::text,'custom','3-months',12,'USD','pending',3,5,$2,$3) returning *",[fixture.businessId,saved,{environment:'sandbox',live_enabled:false}])).rows[0]);}
 finally{await db.exec("set session_replication_role='origin'");}
 for(const row of rows)await db.query("insert into tenh_billing_private.legacy_payway_enrollments(source_payment_id,provider_transaction_id,business_id,payment_identity,subscription_identity,activation_policy,merchant_binding_verified,activation_timezone,review_reference) select b.id,b.provider_transaction_id,b.business_id,tenh_compat_payment_identity(to_jsonb(b)),tenh_compat_subscription_identity(to_jsonb(s)),$2,$3,'UTC','synthetic authoritative review' from billing_transactions b join business_subscriptions s on s.business_id=b.business_id where b.id=$1",[row.id,options.policy??'captured-v1',options.merchantVerified??true]);
 return {...fixture,rows};
}
function provider(row,patch={}){return {status:{code:'00',tran_id:row.provider_transaction_id},data:{payment_status:'APPROVED',payment_status_code:0,original_amount:row.amount,original_currency:'USD',payment_amount:row.amount,payment_currency:'USD',refund_amount:0,apv:'synthetic',...patch}};}
async function activate(db,row,options={}){return (await db.query("select * from tenh_activate_verified_payway_payment($1,$2,$2,'USD','APPROVED',0,'synthetic',$3,true)",[row.provider_transaction_id,options.amount??row.amount,options.provider??provider(row)])).rows[0];}
const payments=async(db,b)=>(await db.query('select * from billing_transactions where business_id=$1 order by id',[b])).rows;
const subscription=async(db,b)=>(await db.query('select * from business_subscriptions where business_id=$1',[b])).rows[0];
const events=async(db,b)=>(await db.query('select * from tenh_billing_private.reconciliation_events where business_id=$1 order by id',[b])).rows;
test('immutable legacy coexistence and guarded activation draft',async t=>{
 const db=await database();
 try{
 await t.test('six duplicated sandbox payments stay intact; conflicts and callback replays grant nothing',async()=>{
  for(const group of [await legacy(db,{count:3}),await legacy(db,{count:3})]){
   const before=await payments(db,group.businessId),access=await subscription(db,group.businessId);
   for(const row of group.rows){assert.equal((await activate(db,row)).subscription_status,'recovery_required');assert.equal((await activate(db,row)).subscription_status,'recovery_required');}
   assert.deepEqual(await payments(db,group.businessId),before);assert.deepEqual(await subscription(db,group.businessId),access);
   const audit=await events(db,group.businessId);assert.equal(audit.length,3);assert.ok(audit.every(e=>e.reason==='CONFLICTING_UNRESOLVED_PAYMENT'));
   assert.equal((await db.query('select count(*)::integer as n from tenh_billing_invoices where business_id=$1',[group.businessId])).rows[0].n,0);
  }
 });
 await t.test('new PayWay and manual purchases both respect unresolved legacy rows',async()=>{
  const group=await legacy(db);for(const manual of [false,true])await assert.rejects(()=>purchase(db,'none',{fixture:group,manual}),/existing payment/);
  assert.equal((await payments(db,group.businessId)).length,1);
 });
 await t.test('exact legacy v1 two-month difference is preserved, with one invoice on replay',async()=>{
  const group=await legacy(db),row=group.rows[0],first=await activate(db,row);
  assert.equal(first.subscription_status,'active',JSON.stringify(await events(db,group.businessId)));assert.equal(first.already_approved,false);
  assert.equal(new Date(first.current_period_end).toISOString(),row.pricing_snapshot.new_period_end);
  const after=await subscription(db,group.businessId);
  assert.equal(after.member_limit,3);assert.equal(after.channel_limit,5);
  assert.equal(new Date(after.current_period_start).toISOString(),new Date(group.subscription.current_period_start).toISOString());
  const paid=(await payments(db,group.businessId))[0];
  assert.deepEqual(paid.pricing_snapshot,row.pricing_snapshot);assert.equal(Number(paid.amount),12);
  assert.equal(new Date(paid.created_at).toISOString(),new Date(row.created_at).toISOString());
  assert.equal(after.pricing_snapshot.extension_months,2);assert.equal(after.pricing_snapshot.paid_term_basis_version,undefined);assert.equal(after.pricing_snapshot.paid_term_segments,undefined);assert.equal(Number(after.last_paid_amount),71.25);
  assert.equal((await activate(db,row)).already_approved,true);assert.deepEqual(await subscription(db,group.businessId),after);
  assert.equal((await db.query('select count(*)::integer as n from tenh_billing_invoices where source_payment_id=$1',[row.id])).rows[0].n,1);
  const invoice=(await db.query('select * from tenh_billing_invoices where source_payment_id=$1',[row.id])).rows[0];
  assert.equal(Number(invoice.amount),12);assert.equal(invoice.currency,'USD');assert.equal(invoice.status,'paid');
  assert.equal(new Date(invoice.period_end).toISOString(),row.pricing_snapshot.new_period_end);
  await assert.rejects(()=>purchase(db,'none',{fixture:{...group,subscription:after,now:new Date()},connections:6}),/combined paid terms/);
  assert.equal((await events(db,group.businessId)).filter(e=>e.kind==='applied').length,1);
 });
 await t.test('timestamp identity is independent of enrollment and activation timezones',async()=>{
  for(const zone of ['Asia/Phnom_Penh','America/New_York','UTC']){
   await db.query("select set_config('TimeZone',$1,false)",[zone]);
   const group=await legacy(db),row=group.rows[0],before=await payments(db,group.businessId);
   assert.equal((await activate(db,row)).subscription_status,'active',JSON.stringify(await events(db,group.businessId)));
   const after=(await payments(db,group.businessId))[0];assert.deepEqual(after.pricing_snapshot,before[0].pricing_snapshot);
   assert.equal(new Date(after.created_at).getTime(),new Date(before[0].created_at).getTime());
   assert.equal((await activate(db,row)).already_approved,true);
  }
  await db.exec("set timezone='UTC'");
 });
 await t.test('changed paid period is never overwritten by an old quote',async()=>{
  const group=await legacy(db);await db.query("update business_subscriptions set current_period_end=current_period_end+interval '1 day' where business_id=$1",[group.businessId]);const access=await subscription(db,group.businessId);
  assert.equal((await activate(db,group.rows[0])).subscription_status,'recovery_required');assert.deepEqual(await subscription(db,group.businessId),access);
  assert.equal((await events(db,group.businessId))[0].reason,'LEGACY_SUBSCRIPTION_BASELINE_CHANGED');assert.equal((await payments(db,group.businessId))[0].status,'pending');
 });
 await t.test('unknown merchant binding preserves verified evidence without activation',async()=>{
  const group=await legacy(db,{merchantVerified:false});assert.equal((await activate(db,group.rows[0])).subscription_status,'recovery_required');
  const audit=(await events(db,group.businessId))[0];assert.equal(audit.reason,'LEGACY_MERCHANT_BINDING_UNVERIFIED');assert.equal(audit.observation.provider.data.payment_status,'APPROVED');assert.equal((await payments(db,group.businessId))[0].status,'pending');
 });
 await t.test('saved amount, capacity, quote, contract and enrollment cannot be rewritten',async()=>{
  const group=await legacy(db),id=group.rows[0].id,before=await payments(db,group.businessId);
  for(const expression of ["amount=13","target_member_limit=4","created_at=created_at+interval '1 second'","pricing_snapshot=pricing_snapshot||jsonb_build_object('extension_months',12)","metadata=metadata||jsonb_build_object('checkout_contract_version',2)"])await assert.rejects(()=>db.query('update billing_transactions set '+expression+' where id=$1',[id]),/changed/);
  for(const status of ['cancelled','failed','declined'])await assert.rejects(()=>db.query('update billing_transactions set status=$2 where id=$1',[id,status]),/reviewed resolution permit/);
  await assert.rejects(()=>db.query("update billing_transactions set status='approved' where id=$1",[id]),/guarded legacy/);await assert.rejects(()=>db.query('delete from billing_transactions where id=$1',[id]),/cannot be deleted/);
  await assert.rejects(()=>db.query("update tenh_billing_private.legacy_payway_enrollments set activation_policy='review' where source_payment_id=$1",[id]),/append-only/);assert.deepEqual(await payments(db,group.businessId),before);
 });
 await t.test('mismatching approved amount records recovery and leaves access unchanged',async()=>{
  const group=await legacy(db),access=await subscription(db,group.businessId);assert.equal((await activate(db,group.rows[0],{amount:11.99})).subscription_status,'recovery_required');assert.deepEqual(await subscription(db,group.businessId),access);assert.equal((await events(db,group.businessId))[0].reason,'PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH');
 });
 await t.test('legacy not-found and declined inquiries cannot silently cancel or reopen history',async()=>{
  const group=await legacy(db),before=await payments(db,group.businessId);
  for(const observation of [{provider_status_code:'6',payment_status:null},{provider_status_code:'00',payment_status:'DECLINED'}])assert.equal((await db.query('select tenh_observe_payway_verification($1,$2,true) as value',[group.rows[0].provider_transaction_id,observation])).rows[0].value.payment_state,'pending');
  const after=(await payments(db,group.businessId))[0];assert.equal(after.status,before[0].status);assert.deepEqual(after.pricing_snapshot,before[0].pricing_snapshot);assert.ok(after.callback_received_at);assert.equal((await events(db,group.businessId)).length,2);
 });
 await t.test('v2 approval is idempotent and fails closed on later scheduled changes',async()=>{
  const p=await purchase(db,'monthly');assert.equal((await activate(db,p.tx)).subscription_status,'active');assert.equal((await activate(db,p.tx)).already_approved,true);
  const second=await purchase(db,'monthly');await db.query('update business_subscriptions set cancel_at_period_end=true where business_id=$1',[second.businessId]);assert.equal((await activate(db,second.tx)).subscription_status,'recovery_required');assert.equal((await payments(db,second.businessId))[0].status,'pending');assert.equal((await subscription(db,second.businessId)).cancel_at_period_end,true);
 });
 await t.test('ordinary terminal payments cannot become pending again after a late inquiry',async()=>{
  const p=await purchase(db,'none');await db.query("update billing_transactions set status='failed' where id=$1",[p.tx.id]);
  assert.equal((await db.query('select tenh_observe_payway_verification($1,$2,true) as value',[p.tx.provider_transaction_id,{provider_status_code:'6'}])).rows[0].value.payment_state,'failed');
  await assert.rejects(()=>db.query("update billing_transactions set status='pending' where id=$1",[p.tx.id]),/cannot be reopened/);
  for(const expression of ["business_id=gen_random_uuid()","provider='manual'","provider_transaction_id='different'"])await assert.rejects(()=>db.query('update billing_transactions set '+expression+' where id=$1',[p.tx.id]),/identity are immutable/);
 });
 await t.test('terminal provider observations require the matching transaction identity',async()=>{
  const p=await purchase(db,'none');
  const observe=async id=>(await db.query('select tenh_observe_payway_verification($1,$2,true) as value',[p.tx.provider_transaction_id,{provider_status_code:'00',payment_status:'DECLINED',provider_transaction_id:id}])).rows[0].value;
  assert.equal((await observe('different')).payment_state,'pending');
  assert.equal((await observe(undefined)).payment_state,'pending');
  assert.equal((await observe(p.tx.provider_transaction_id)).payment_state,'declined');
 });
 await t.test('conflicting approved evidence is durable recovery without status or entitlement writes',async()=>{
  const group=await legacy(db),row=group.rows[0],access=await subscription(db,group.businessId);
  await db.exec('create temporary table fixture_status_writes(n integer); create function fixture_count_status_write() returns trigger language plpgsql as $$begin insert into fixture_status_writes values(1); return new; end$$; create trigger fixture_count_status_write after update of status on billing_transactions for each row execute function fixture_count_status_write()');
  const observation={provider_transaction_id:'different',provider_status_code:'00',payment_status:'APPROVED',original_amount:11.99,conflict_reason:'PROVIDER_APPROVED_TRANSACTION_ID_MISMATCH'};
  for(let i=0;i<2;i++)assert.equal((await db.query('select tenh_observe_payway_verification($1,$2,true) as result',[row.provider_transaction_id,observation])).rows[0].result.payment_state,'recovery_required');
  assert.equal((await db.query('select count(*)::integer as n from fixture_status_writes')).rows[0].n,0);
  assert.deepEqual(await subscription(db,group.businessId),access);assert.equal((await payments(db,group.businessId))[0].status,'pending');
  const audit=await events(db,group.businessId);assert.equal(audit.length,1);assert.equal(audit[0].kind,'recovery_required');assert.equal(audit[0].observation.payment_status,'APPROVED');
  await db.exec('drop trigger fixture_count_status_write on billing_transactions');
 });
 await t.test('private activation functions and approval permits are not service-callable',async()=>{
  const row=(await db.query("select has_schema_privilege('service_role','tenh_billing_private','USAGE') as schema_access,has_function_privilege('service_role','tenh_billing_private.activate_payway_v1(text,numeric,numeric,text,text,integer,text,jsonb,boolean)','EXECUTE') as direct_activation,has_table_privilege('service_role','tenh_billing_private.approval_attempts','INSERT') as forge_attempt,has_function_privilege('anon','public.tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)','EXECUTE') as public_activation")).rows[0];assert.deepEqual(row,{schema_access:false,direct_activation:false,forge_attempt:false,public_activation:false});
 });
 }finally{await db.close();}
});
