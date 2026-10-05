/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
// In-memory PostgreSQL only. Historical IDs identify synthetic fixture rows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {setup,seed}=require('./payway-compat-fixture.cjs');
const {build,validate,serializeEnrollmentCapture}=require('./build-payway-coexistence-installer.cjs');
const {triggerFingerprintQuery,pricingAclFingerprintQuery,triggerPlaceholder,pricingAclPlaceholder}=require('./build-payway-installer-draft.cjs');
test('replacement generator rejects absent enrollment capture',()=>assert.throws(()=>validate({}),/authenticated five-query/));
test('exact serializer restores only two money fields without rounding or altering other values',()=>{
 const value=[{payment_identity:{amount:12,pricing_snapshot:{discount:0.2}},subscription_identity:{last_paid_amount:1315.2},other_amount:12}];
 const before=JSON.stringify(value),text=serializeEnrollmentCapture(value);
 assert.match(text,/"amount":12\.00/);assert.match(text,/"last_paid_amount":1315\.20/);assert.match(text,/"other_amount":12[,}]/);
 assert.equal(JSON.stringify(value),before);assert.deepEqual(JSON.parse(text),value);
 assert.throws(()=>serializeEnrollmentCapture([{payment_identity:{amount:12.001}}]),/cannot be rounded/);
});
test('separate replacement installer preserves exact six-row inventory in isolated PostgreSQL',async()=>{
 const db=await setup({install:false});
 try{
  await db.exec("set timezone='UTC'");
  await db.exec('alter table billing_transactions alter column amount type numeric(12,2); alter table business_subscriptions alter column last_paid_amount type numeric(12,2)');
  const groups=[await seed(db),await seed(db)],ids=['178798123601437','178798124683199','178740541334731','178740542390545','178740902940328','178793067865680'];
  for(let i=0;i<6;i++)await db.query("insert into billing_transactions(business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,pricing_snapshot,metadata) values($1,'payway',$2,'mini','monthly',12,'USD','pending',1,3,'{}',$3)",[groups[i<3?0:1].businessId,ids[i],{environment:'sandbox',live_enabled:false}]);
  const captureSql=fs.readFileSync('docs/sql/payway-legacy-enrollment-readonly.sql','utf8').replace(/^--.*$/gm,'').split(';')[0];
  const packet={captured_at:new Date().toISOString(),capture_reference:'synthetic private review',enrollments:(await db.query(captureSql)).rows,payway_pending:(await db.query("select provider_transaction_id from billing_transactions where status='pending'")).rows,manual_pending:[]};
  packet.session_settings=(await db.query("select current_setting('TimeZone') as current_session_timezone,current_setting('default_transaction_isolation') as default_transaction_isolation")).rows[0];
  packet.constraints=(await db.query("select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid in ('billing_transactions'::regclass,'manual_payment_requests'::regclass)")).rows;
  const before=(await db.query('select * from billing_transactions order by id')).rows,access=(await db.query('select * from business_subscriptions order by business_id')).rows;
  const sql=build(packet);assert.doesNotMatch(sql,/create unique index/i);assert.match(sql,/access exclusive mode nowait/i);
  // Synthetic trigger wiring and pricing ACL are intentionally different.
  // Substitute ONLY those two fixture fingerprints, never production source.
  const trigger=(await db.query(triggerFingerprintQuery)).rows[0].md5,acl=(await db.query(pricingAclFingerprintQuery)).rows[0].md5;
  const drift=JSON.parse(JSON.stringify(packet));drift.enrollments[0].payment_identity.amount=13;
  await assert.rejects(()=>db.exec(build(drift).replaceAll(triggerPlaceholder,trigger).replaceAll(pricingAclPlaceholder,acl)),/fingerprint differs/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regnamespace('tenh_billing_private') as namespace")).rows[0].namespace,null);
  assert.deepEqual((await db.query('select * from billing_transactions order by id')).rows,before);
  const badOracle=JSON.parse(JSON.stringify(packet));badOracle.enrollments[0].payment_fingerprint='0'.repeat(32);
  await assert.rejects(()=>db.exec(build(badOracle).replaceAll(triggerPlaceholder,trigger).replaceAll(pricingAclPlaceholder,acl)),/supplied original oracle/);
  await db.exec('rollback');
  const first=packet.enrollments[0];
  await db.query("update business_subscriptions set current_period_end=current_period_end+interval '1 second' where business_id=$1",[first.business_id]);
  await assert.rejects(()=>db.exec(sql.replaceAll(triggerPlaceholder,trigger).replaceAll(pricingAclPlaceholder,acl)),/Live raw PostgreSQL identity fingerprint drifted/);
  await db.exec('rollback');
  await db.query('update business_subscriptions set current_period_end=$2 where business_id=$1',[first.business_id,first.subscription_identity.current_period_end]);
  const extra=JSON.parse(JSON.stringify(packet));extra.payway_pending.push({provider_transaction_id:'unknown'});
  assert.throws(()=>build(extra),/Unknown or missing pending/);
  const fixtureSql=sql.replaceAll(triggerPlaceholder,trigger).replaceAll(pricingAclPlaceholder,acl);
  await db.exec(fixtureSql);
  assert.deepEqual((await db.query('select * from billing_transactions order by id')).rows,before);
  assert.deepEqual((await db.query('select * from business_subscriptions order by business_id')).rows,access);
  assert.equal((await db.query('select count(*)::integer as n from tenh_billing_private.legacy_payway_enrollments')).rows[0].n,6);
  assert.ok((await db.query('select activation_policy,merchant_binding_verified from tenh_billing_private.legacy_payway_enrollments')).rows.every(r=>r.activation_policy==='review'&&!r.merchant_binding_verified));
  assert.ok((await db.query('select activation_timezone from tenh_billing_private.legacy_payway_enrollments')).rows.every(r=>r.activation_timezone==='UNKNOWN'));
 }finally{await db.close();}
});
