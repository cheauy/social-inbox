/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test harness. */
// Syntax/fixture semantics only. This does not execute native concurrency.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require(process.env.TENH_PGLITE_MODULE||'C:/Users/TUF/AppData/Local/Temp/tenh-branch-sql-check/node_modules/@electric-sql/pglite');
test('portable native fixture and unchanged core compile with labelled synthetic activation models',async()=>{
 const db=new PGlite();
 try{
  // PGlite's fixed database name differs. Substitute ONLY the test fixture's
  // disposable-name guard, not the exact core or activation logic.
  const fixture=fs.readFileSync('tests/native-payway-fixture.sql','utf8').replace('current_database() !~',"'tenh_native_test_syntax' !~");
  await db.exec(fixture);await db.exec(fs.readFileSync('tests/fixtures/payway-legacy-coexistence-core.sql','utf8'));await db.exec(fs.readFileSync('tests/native-payway-models.sql','utf8'));
  const business=(await db.query("insert into business_subscriptions(business_id,plan_code,status,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end) values(gen_random_uuid(),'mini','trialing','monthly',1,3,now(),now()+interval '1 month') returning business_id")).rows[0].business_id;
  await db.query("insert into billing_transactions(business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,metadata) values($1,'payway','synthetic-native','mini','monthly',13,'USD','pending',1,3,'{\"checkout_contract_version\":2}')",[business]);
  const envelope={status:{code:'00',tran_id:'synthetic-native'}};
  const approve=async()=> (await db.query("select * from tenh_activate_verified_payway_payment('synthetic-native',13,13,'USD','APPROVED',0,'synthetic',$1,true)",[envelope])).rows[0];
  assert.equal((await approve()).subscription_status,'active');assert.equal((await approve()).already_approved,true);
  assert.equal((await db.query('select count(*)::integer as n from tenh_billing_invoices')).rows[0].n,1);
 }finally{await db.close();}
});
