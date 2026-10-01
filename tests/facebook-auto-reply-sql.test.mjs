import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
// Test-only engine: install outside the application, then set TENH_PGLITE_ROOT.
const root = process.env.TENH_PGLITE_ROOT;
if (!root) {
  test("PostgreSQL Auto Reply integration", { skip: "Set TENH_PGLITE_ROOT to an isolated @electric-sql/pglite installation." }, () => {});
} else {
const { PGlite } = createRequire(resolve(root, "package.json"))("@electric-sql/pglite");
const db = new PGlite();
const B = "00000000-0000-4000-8000-000000000001", B2 = "00000000-0000-4000-8000-000000000002";
const P = "00000000-0000-4000-8000-000000000003", C = "00000000-0000-4000-8000-000000000004";
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table businesses(id uuid primary key);
    create table social_accounts(id uuid primary key,business_id uuid,platform text,platform_account_id text,is_active boolean);
    create table conversations(id uuid primary key,business_id uuid,social_account_id uuid);
    create table messages(id uuid primary key default gen_random_uuid(),business_id uuid,conversation_id uuid,
      platform_message_id text,sender_platform_id text,direction text,is_echo boolean default false,
      raw_payload jsonb,platform_created_at timestamptz);
  `);
  await db.exec(readFileSync(new URL("../db/migrations/20260930_facebook_auto_reply.sql", import.meta.url), "utf8"));
  // Exercise the legacy queue helper in this isolated fixture only; fresh application installs DO NOT attach it.
  // The separate safety suite verifies the real background path and removal of an older attached trigger.
  await db.exec("create trigger facebook_auto_reply_enqueue after insert on messages for each row execute function facebook_auto_reply_enqueue()");
});
after(() => db.close());
beforeEach(async () => {
  await db.exec("truncate businesses,social_accounts,conversations,messages,facebook_auto_reply_rules,facebook_auto_reply_jobs,facebook_auto_reply_recipients cascade");
  await db.query("insert into businesses values($1),($2)", [B,B2]);
  await db.query("insert into social_accounts values($1,$2,'facebook','123',true)", [P,B]);
  await db.query("insert into conversations values($1,$2,$3)", [C,B,P]);
});
async function rule(post = null, publicText = "Hello", privateText = "Private") {
  const row = (await db.query(`insert into facebook_auto_reply_rules(business_id,social_account_id,name,post_id,public_template,private_template)
    values($1,$2,'Rule',$3,$4,$5) returning *`,[B,P,post,publicText,privateText])).rows[0];
  return (await db.query("update facebook_auto_reply_rules set enabled=true,starts_at=now()-interval '1 day' where id=$1 returning *",[row.id])).rows[0];
}
async function comment(id = "123_c1", post = "123_456", age = "10 seconds", author = "user", payload = {}) {
  await db.query(`insert into messages(business_id,conversation_id,platform_message_id,sender_platform_id,direction,raw_payload,platform_created_at)
    values($1,$2,$3,$4,'incoming',$5,clock_timestamp()+$6::interval)`,
    [B,C,id,author,JSON.stringify({item:"comment",verb:"add",post_id:post,created_time:Math.floor(Date.now()/1000),...payload}),age]);
}
const jobs = async () => (await db.query("select * from facebook_auto_reply_jobs order by action")).rows;
const claim = async () => (await db.query("select * from facebook_auto_reply_claim(5)")).rows;
test("rules default disabled even when insert requests enabled; activation never backfills", async () => {
  const r = (await db.query("insert into facebook_auto_reply_rules(business_id,social_account_id,name,public_template,enabled) values($1,$2,'Draft','Hello',true) returning *",[B,P])).rows[0];
  assert.equal(r.enabled,false); assert.equal(r.activated_at,null);
  await comment(); assert.equal((await jobs()).length,0);
  await db.query("update facebook_auto_reply_rules set enabled=true,starts_at=now()-interval '1 day' where id=$1",[r.id]);
  await comment("old","123_456","-1 hour");
  assert.equal((await jobs())[0].reason,"before_start");
});
test("specific post wins and all-post scope includes another/future post", async () => {
  const all = await rule(null,"All",null);
  const specific = await rule("123_456",null,"Specific");
  await comment(); await comment("future","123_999");
  const rows = await jobs();
  assert.equal(rows.length,2);
  assert.equal(rows.find(j=>j.comment_id==="123_c1").rule_id,specific.id);
  assert.equal(rows.find(j=>j.comment_id==="future").rule_id,all.id);
});
test("tenant Page binding rejects cross-workspace rules; clients cannot query or claim", async () => {
  await assert.rejects(db.query("insert into facebook_auto_reply_rules(business_id,social_account_id,name,public_template) values($1,$2,'Unsafe','X')",[B2,P]),/does not belong/);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.query("select * from facebook_auto_reply_jobs"),/permission denied/);
    await assert.rejects(db.query("select * from facebook_auto_reply_claim(5)"),/permission denied/);
  } finally { await db.exec("reset role"); }
});
test("duplicate comment inserts produce one durable row per action", async () => {
  await rule(); await comment(); await comment();
  assert.equal((await jobs()).length,2);
});
test("Page/bot comments, echoes, missing creation timestamp do not queue", async () => {
  await rule(); await comment("own","123_456","10 seconds","123");
  await comment("no-clock","123_456","10 seconds","user",{created_time:null});
  assert.equal((await jobs()).length,0);
});
test("overlapping claim calls cannot claim the same job; public runs before private", async () => {
  await rule(); await comment();
  const [first,second] = await Promise.all([claim(),claim()]);
  assert.equal(first.length,1); assert.equal(first[0].action,"public"); assert.equal(second.length,0);
  await db.query("update facebook_auto_reply_jobs set status='sent',platform_reply_id='reply' where id=$1",[first[0].id]);
  const next = await claim(); assert.equal(next.length,1); assert.equal(next[0].action,"private");
});
test("pause cancels claimed/pending work; old generation cannot send after resume", async () => {
  const r = await rule(); await comment();
  const claimed = (await claim())[0];
  await db.query("update facebook_auto_reply_rules set enabled=false where id=$1",[r.id]);
  assert.ok((await jobs()).every(j=>j.status==="skipped"));
  assert.equal((await db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[claimed.id,claimed.claim_token])).rows[0].allowed,false);
  await db.query("update facebook_auto_reply_rules set enabled=true where id=$1",[r.id]);
  assert.equal((await claim()).length,0);
});
test("expired send lease becomes needs review; expired preflight can recover with bounded attempts", async () => {
  await rule(); await comment();
  let claimed = (await claim())[0];
  assert.equal((await db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[claimed.id,claimed.claim_token])).rows[0].allowed,true);
  await db.query("update facebook_auto_reply_jobs set lease_until=now()-interval '1 minute' where id=$1",[claimed.id]);
  await claim();
  assert.equal((await db.query("select status from facebook_auto_reply_jobs where id=$1",[claimed.id])).rows[0].status,"needs_review");
  await db.exec("update facebook_auto_reply_jobs set status='claimed',attempts=4,lease_until=now()-interval '1 minute' where action='private'");
  await claim();
  assert.equal((await jobs()).find(j=>j.action==="private").status,"failed");
});
test("private reservation blocks simultaneous messages to same customer", async () => {
  await rule(null,null,"Private"); await comment("one"); await comment("two");
  const claimed = await claim(); assert.equal(claimed.length,2);
  const results = await Promise.all(claimed.map(j=>db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[j.id,j.claim_token])));
  assert.deepEqual(results.map(r=>r.rows[0].allowed),[true,false]);
  assert.equal((await jobs()).find(j=>j.status==="skipped").reason,"private_reply_already_reserved");
});
test("disconnected Page is stopped at the atomic send boundary", async () => {
  await rule(); await comment(); const j = (await claim())[0];
  await db.query("update social_accounts set is_active=false where id=$1",[P]);
  assert.equal((await db.query("select facebook_auto_reply_begin_send($1,$2) as allowed",[j.id,j.claim_token])).rows[0].allowed,false);
});
}
