import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const root = process.env.TENH_PGLITE_ROOT;
if (!root) test("Auto Reply safety SQL", { skip: "Requires existing isolated PGlite." }, () => {});
else {
const { PGlite } = createRequire(resolve(root,"package.json"))("@electric-sql/pglite");
const db = new PGlite();
const B="00000000-0000-4000-8000-000000000001", P="00000000-0000-4000-8000-000000000002", C="00000000-0000-4000-8000-000000000003";
const safety=readFileSync(new URL("../db/migrations/20261001_facebook_auto_reply_safety.sql",import.meta.url),"utf8")
  .replace("create index concurrently","create index"); // Embedded engine cannot prove concurrent CREATE INDEX.
const recovery=readFileSync(new URL("../db/migrations/20261002_facebook_auto_reply_recovery_test_gate.sql",import.meta.url),"utf8")
  .replace("create index concurrently","create index");
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table businesses(id uuid primary key);
    create table social_accounts(id uuid primary key,business_id uuid,platform text,platform_account_id text,is_active boolean);
    create table conversations(id uuid primary key,business_id uuid,social_account_id uuid);
    create table messages(id uuid primary key default gen_random_uuid(),business_id uuid,conversation_id uuid,
      platform_message_id text,sender_platform_id text,direction text,is_echo boolean default false,
      raw_payload jsonb,platform_created_at timestamptz,created_at timestamptz default clock_timestamp());`);
  await db.exec(readFileSync(new URL("../db/migrations/20260930_facebook_auto_reply.sql",import.meta.url),"utf8"));
  // Simulate an older installation with the unsafe legacy trigger; safety upgrade must detach it.
  await db.exec("create trigger facebook_auto_reply_enqueue after insert on messages for each row execute function facebook_auto_reply_enqueue()");
  await db.exec(safety);
  await db.exec(recovery);
});
after(()=>db.close());
beforeEach(async()=>{
  await db.exec("truncate businesses,social_accounts,conversations,messages,facebook_auto_reply_rules,facebook_auto_reply_jobs,facebook_auto_reply_recipients,facebook_auto_reply_controls,facebook_auto_reply_test_gates cascade");
  await db.query("insert into businesses values($1)",[B]);
  await db.query("insert into social_accounts values($1,$2,'facebook','123',true)",[P,B]);
  await db.query("insert into conversations values($1,$2,$3)",[C,B,P]);
  await db.exec("update facebook_auto_reply_recovery set cursor_at=clock_timestamp()-interval '1 hour',cursor_id='00000000-0000-0000-0000-000000000000'");
});
async function activate() {
  await db.query("select facebook_auto_reply_pause($1,false)",[B]);
  const r=(await db.query("insert into facebook_auto_reply_rules(business_id,social_account_id,name,public_template) values($1,$2,'Rule','Hello') returning id",[B,P])).rows[0];
  await db.query("update facebook_auto_reply_rules set enabled=true,starts_at=clock_timestamp()-interval '1 day' where id=$1",[r.id]);
  return r.id;
}
async function comment(id="123_c1") {
  await db.query(`insert into messages(business_id,conversation_id,platform_message_id,sender_platform_id,direction,raw_payload,platform_created_at,created_at)
    values($1,$2,$3,'customer','incoming','{"item":"comment","verb":"add","post_id":"123_456","created_time":1}',
      clock_timestamp()+interval '1 second',clock_timestamp()-interval '1 minute')`,[B,C,id]);
}
const repair=async limit=>(await db.query("select facebook_auto_reply_repair($1) as count",[limit??100])).rows[0].count;
const claim=async()=>(await db.query("select * from facebook_auto_reply_claim(5)")).rows;
test("feature trigger is detached: broken feature helper cannot reject inbox INSERT",async()=>{
  await activate();
  await db.exec("alter function facebook_auto_reply_enqueue_message(uuid) rename to temporarily_broken_enqueue");
  try { await comment(); assert.equal((await db.query("select count(*)::integer as count from messages")).rows[0].count,1); }
  finally { await db.exec("alter function temporarily_broken_enqueue(uuid) rename to facebook_auto_reply_enqueue_message"); }
  assert.equal((await db.query("select count(*)::integer as count from pg_trigger where tgname='facebook_auto_reply_enqueue'")).rows[0].count,0);
});
test("bounded indexed recovery queues durable comments idempotently, service role can recover",async()=>{
  await activate(); for(let i=0;i<7;i++) await comment("comment"+i);
  assert.equal((await db.query("select count(*)::integer as count from facebook_auto_reply_jobs")).rows[0].count,0);
  assert.equal(await repair(2),2); assert.equal(await repair(2),2);
  await db.exec("set role service_role");
  try { assert.equal(await repair(),3); } finally { await db.exec("reset role"); }
  assert.equal(await repair(),0);
  assert.equal((await db.query("select count(*)::integer as count from facebook_auto_reply_jobs")).rows[0].count,7);
});
test("recovery failure rolls back its message marker; restored worker repairs exactly once",async()=>{
  await activate(); await comment();
  await db.exec("alter table facebook_auto_reply_jobs add constraint fixture_error check (false) not valid");
  try {
    await assert.rejects(repair());
    assert.equal((await db.query("select facebook_auto_reply_processed as processed from messages")).rows[0].processed,false);
    assert.equal((await db.query("select count(*)::integer as count from facebook_auto_reply_jobs")).rows[0].count,0);
  } finally { await db.exec("alter table facebook_auto_reply_jobs drop constraint fixture_error"); }
  assert.equal(await repair(),1); assert.equal((await claim()).length,1);
});
test("global default pause, pause-before-send, resume cutoff and per-rule pause stop queued work",async()=>{
  const r=await activate(); await comment(); await repair(); const j=(await claim())[0];
  await db.query("select facebook_auto_reply_pause($1,true)",[B]);
  assert.equal((await db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[j.id,j.claim_token])).rows[0].allowed,false);
  await db.query("select facebook_auto_reply_pause($1,false)",[B]);
  assert.equal((await claim()).length,0);
  await comment("after-resume"); await repair();
  await db.query("update facebook_auto_reply_rules set enabled=false where id=$1",[r]);
  assert.equal((await claim()).length,0);
});
test("five consecutive errors open cooldown and gate already claimed jobs",async()=>{
  await activate(); await comment(); await repair(); const j=(await claim())[0];
  for(let i=0;i<5;i++) await db.query("select facebook_auto_reply_note_result($1,true)",[B]);
  assert.ok(Date.parse((await db.query("select circuit_until from facebook_auto_reply_controls")).rows[0].circuit_until)>Date.now());
  assert.equal((await db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[j.id,j.claim_token])).rows[0].allowed,false);
});
test("migrations rerun without losing markers/dedupe; untrusted roles cannot bypass gates",async()=>{
  await activate(); await comment(); await repair(); await db.exec(safety); await db.exec(recovery);
  assert.equal((await db.query("select count(*)::integer as count from facebook_auto_reply_jobs")).rows[0].count,1);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select facebook_auto_reply_pause($1,false)",[B]),/permission denied/);
    await assert.rejects(db.query("select facebook_auto_reply_begin_send(null,null)"),/permission denied/);
  } finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try { await assert.rejects(db.query("select facebook_auto_reply_begin_send_legacy(null,null)"),/permission denied/); }
  finally { await db.exec("reset role"); }
});
test("late commit behind a newer timestamp/order is discovered without a cursor or age horizon",async()=>{
  await activate(); await comment("newer"); assert.equal(await repair(),1);
  // Same visible database state as A committing after B's repair; not real multi-connection proof.
  await comment("late");
  await db.exec("update messages set created_at=clock_timestamp()-interval '30 days' where platform_message_id='late'");
  assert.equal(await repair(),1); assert.equal(await repair(),0);
  assert.deepEqual((await db.query("select comment_id from facebook_auto_reply_jobs order by comment_id")).rows.map(r=>r.comment_id),["late","newer"]);
});
test("pending index is used and missing index fails observably without marking or sending",async()=>{
  await activate(); await comment();
  await db.exec("set enable_seqscan=off");
  const plan=(await db.query("explain select id from messages where not facebook_auto_reply_processed and direction='incoming' and raw_payload->>'item'='comment' and raw_payload->>'verb'='add' order by created_at,id limit 100 for update skip locked")).rows;
  assert.match(JSON.stringify(plan),/facebook_auto_reply_unprocessed/);
  await db.exec("reset enable_seqscan; alter index facebook_auto_reply_unprocessed rename to fixture_hidden_pending_index");
  try { await assert.rejects(repair(),/pending index unavailable/); }
  finally { await db.exec("alter index fixture_hidden_pending_index rename to facebook_auto_reply_unprocessed"); }
  await db.exec("alter index facebook_auto_reply_unprocessed rename to fixture_correct_pending_index; create index facebook_auto_reply_unprocessed on messages(created_at,id) where not facebook_auto_reply_processed and direction='outgoing'");
  try { await assert.rejects(repair(),/pending index unavailable/); }
  finally { await db.exec("drop index facebook_auto_reply_unprocessed; alter index fixture_correct_pending_index rename to facebook_auto_reply_unprocessed"); }
  assert.equal((await db.query("select facebook_auto_reply_processed as processed from messages")).rows[0].processed,false);
  assert.equal(await repair(),1);
});
test("fresh marker migration excludes old messages; rerun retains pending and processed markers",async()=>{
  // Independent minimal database proves the metadata-default transition, without altering application fixtures.
  const fixture=new PGlite();
  try {
    await fixture.exec("create table messages(id integer primary key); insert into messages values(1); alter table messages add column facebook_auto_reply_processed boolean not null default true; alter table messages alter column facebook_auto_reply_processed set default false; insert into messages(id) values(2)");
    assert.deepEqual((await fixture.query("select facebook_auto_reply_processed as processed from messages order by id")).rows.map(r=>r.processed),[true,false]);
  } finally { await fixture.close(); }
  await activate(); await comment("done"); await repair(); await comment("pending"); await db.exec(recovery);
  assert.deepEqual((await db.query("select facebook_auto_reply_processed as processed from messages order by platform_message_id")).rows.map(r=>r.processed),[true,false]);
});
async function gate(publicCap=1,privateCap=0,commentId="123_901") {
  const id=(await db.query(`insert into facebook_auto_reply_test_gates(business_id,social_account_id,page_platform_id,post_id,comment_id,public_cap,private_cap,enabled)
    values($1,$2,'123','123_456',$3,$4,$5,true) returning *`,[B,P,commentId,publicCap,privateCap])).rows[0];
  assert.equal(id.enabled,false); assert.equal(id.armed_at,null);
  await db.query("update facebook_auto_reply_test_gates set enabled=true,expires_at=clock_timestamp()+interval '10 minutes' where id=$1",[id.id]);
  return id.id;
}
const boundary=async j=>(await db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[j.id,j.claim_token])).rows[0].allowed;
test("test gate defaults disabled, claims exact identity only and reserves one public POST attempt",async()=>{
  await activate(); await comment("123_901"); await comment("123_902"); await repair();
  const id=await gate(); const first=await claim(); assert.equal(first.length,1); assert.equal(first[0].comment_id,"123_901");
  assert.equal(await boundary(first[0]),true); assert.equal(await boundary(first[0]),false);
  assert.equal((await db.query("select public_attempts from facebook_auto_reply_test_gates where id=$1",[id])).rows[0].public_attempts,1);
  // Even a definite rate-limit retry may not issue another test POST.
  await db.query("update facebook_auto_reply_jobs set status='retry',available_at=now() where id=$1",[first[0].id]);
  assert.equal((await claim()).length,0);
  assert.equal((await db.query("select status from facebook_auto_reply_jobs where comment_id='123_902'")).rows[0].status,"pending");
});
test("test gate independently bounds public/private, preserves uncertainty reservation and never refunds",async()=>{
  const r=await activate(); await db.query("update facebook_auto_reply_rules set enabled=false where id=$1",[r]);
  await db.query("update facebook_auto_reply_rules set private_template='Private',enabled=true where id=$1",[r]);
  await comment("123_901"); await repair(); const id=await gate(1,1);
  const first=(await claim())[0]; assert.equal(first.action,"public"); assert.equal(await boundary(first),true);
  await db.query("update facebook_auto_reply_jobs set status='sent',platform_reply_id='confirmed-public' where id=$1",[first.id]);
  const second=(await claim())[0]; assert.equal(second.action,"private"); assert.equal(await boundary(second),true);
  await db.query("update facebook_auto_reply_jobs set status='needs_review' where id=$1",[second.id]);
  assert.equal((await claim()).length,0);
  const caps=(await db.query("select public_attempts,private_attempts from facebook_auto_reply_test_gates where id=$1",[id])).rows[0];
  assert.deepEqual(caps,{public_attempts:1,private_attempts:1});
  await assert.rejects(db.query("update facebook_auto_reply_test_gates set private_attempts=0 where id=$1",[id]),/cannot be refunded/);
  await assert.rejects(db.query("update facebook_auto_reply_test_gates set comment_id='123_999' where id=$1",[id]),/immutable/);
  await assert.rejects(db.query("update facebook_auto_reply_test_gates set expires_at=clock_timestamp()+interval '1 hour' where id=$1",[id]),/immutable/);
});
test("test gate rejects foreign Page, wrong post/comment and expires closed; non-target jobs stay held",async()=>{
  await activate(); await comment("123_901"); await comment("123_902"); await repair();
  const claimed=await claim(); const id=await gate(1,0);
  const wrong=claimed.find(j=>j.comment_id==="123_902"); assert.equal(await boundary(wrong),false);
  assert.equal((await db.query("select reason from facebook_auto_reply_jobs where id=$1",[wrong.id])).rows[0].reason,"live_test_not_allowlisted");
  const correct=claimed.find(j=>j.comment_id==="123_901");
  await db.exec("update messages set raw_payload=jsonb_set(raw_payload,'{post_id}','\"123_999\"') where platform_message_id='123_901'");
  assert.equal(await boundary(correct),false);
  await assert.rejects(db.query("insert into facebook_auto_reply_test_gates(business_id,social_account_id,page_platform_id,post_id,comment_id) values($1,$2,'999','999_123','1')",[B,P]),/does not belong/);
  // Only the isolated fixture bypasses the guard to simulate passage of time without sleeping.
  await db.exec("alter table facebook_auto_reply_test_gates disable trigger facebook_auto_reply_test_gate_guard");
  try { await db.query("update facebook_auto_reply_test_gates set expires_at=clock_timestamp()-interval '1 second' where id=$1",[id]); }
  finally { await db.exec("alter table facebook_auto_reply_test_gates enable trigger facebook_auto_reply_test_gate_guard"); }
  await db.exec("update messages set raw_payload=jsonb_set(raw_payload,'{post_id}','\"123_456\"') where platform_message_id='123_901'");
  await db.query("update facebook_auto_reply_jobs set status='claimed' where id=$1",[correct.id]);
  assert.equal(await boundary(correct),false);
  assert.equal((await db.query("select reason from facebook_auto_reply_jobs where id=$1",[correct.id])).rows[0].reason,"live_test_expired");
  assert.equal((await claim()).length,0);
  assert.equal((await db.query("select enabled from facebook_auto_reply_test_gates where id=$1",[id])).rows[0].enabled,true);
  await assert.rejects(db.query("update facebook_auto_reply_test_gates set enabled=false where id=$1",[id]),/Global pause/);
  await db.query("select facebook_auto_reply_pause($1,true)",[B]);
  await db.query("update facebook_auto_reply_test_gates set enabled=false where id=$1",[id]);
});
test("private-only test has zero public attempts, and a global test gate holds another tenant's jobs",async()=>{
  const r=await activate(); await db.query("update facebook_auto_reply_rules set enabled=false where id=$1",[r]);
  await db.query("update facebook_auto_reply_rules set private_template='Private',enabled=true where id=$1",[r]);
  const foreignB="00000000-0000-4000-8000-000000000004", foreignP="00000000-0000-4000-8000-000000000005", foreignC="00000000-0000-4000-8000-000000000006";
  await db.query("insert into businesses values($1)",[foreignB]);
  await db.query("insert into social_accounts values($1,$2,'facebook','789',true)",[foreignP,foreignB]);
  await db.query("insert into conversations values($1,$2,$3)",[foreignC,foreignB,foreignP]);
  await db.query("select facebook_auto_reply_pause($1,false)",[foreignB]);
  const foreignRule=(await db.query("insert into facebook_auto_reply_rules(business_id,social_account_id,name,public_template) values($1,$2,'Foreign','Foreign') returning id",[foreignB,foreignP])).rows[0].id;
  await db.query("update facebook_auto_reply_rules set enabled=true,starts_at=now()-interval '1 day' where id=$1",[foreignRule]);
  await db.query(`insert into messages(business_id,conversation_id,platform_message_id,sender_platform_id,direction,raw_payload,platform_created_at)
    values($1,$2,'789_901','foreign-customer','incoming','{"item":"comment","verb":"add","post_id":"789_456","created_time":1}',clock_timestamp()+interval '1 second')`,[foreignB,foreignC]);
  await comment("123_901"); await repair(); const id=await gate(0,1);
  const claimed=await claim(); assert.equal(claimed.length,1); assert.equal(claimed[0].action,"private");
  assert.equal(await boundary(claimed[0]),true);
  const caps=(await db.query("select public_attempts,private_attempts from facebook_auto_reply_test_gates where id=$1",[id])).rows[0];
  assert.deepEqual(caps,{public_attempts:0,private_attempts:1});
  assert.equal((await db.query("select status from facebook_auto_reply_jobs where business_id=$1",[foreignB])).rows[0].status,"pending");
  await db.exec("set role authenticated");
  try { await assert.rejects(db.query("select * from facebook_auto_reply_test_gates"),/permission denied/); }
  finally { await db.exec("reset role"); }
  await db.exec("set role service_role");
  try { await assert.rejects(db.query("delete from facebook_auto_reply_test_gates"),/permission denied/); }
  finally { await db.exec("reset role"); }
});
}
