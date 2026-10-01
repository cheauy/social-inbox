/* eslint-disable @typescript-eslint/no-require-imports -- Reuse the existing CommonJS test harness. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { loader, database } = require("./tenh-seven/harness.cjs");
const at = seconds => new Date(Date.now()+seconds*1000).toISOString();
test("recovery reconciles a crashed public send without sending again",async()=>{
  const h=harness({confirmed:"recovered-id"});
  Object.assign(h.job,{status:"needs_review",send_started_at:at(-15),send_template:"Public"});
  Object.assign(h.db.tables.facebook_auto_reply_jobs[0],h.job);
  assert.equal(await h.app.reconcileAutoReplyJob(h.job),true);
  assert.equal(h.posts.length,0);
  assert.equal(h.db.tables.facebook_auto_reply_jobs[0].status,"sent");
  assert.equal(h.db.tables.facebook_auto_reply_jobs[0].send_template,null);
  assert.equal(await h.app.reconcileAutoReplyJob(h.job),false);
});
test("failed durable repair stops the worker observably before claims or Meta calls",async()=>{
  const h=harness(); const calls=[];
  h.db.rpc=async name=>{calls.push(name);return {data:null,error:{code:"fixture_repair_error"}};};
  await assert.rejects(h.app.runAutoReplyBatch(),/auto_reply_repair_failed/);
  assert.deepEqual(calls,["facebook_auto_reply_repair"]); assert.equal(h.posts.length,0);
});
test("comment webhook schedules bounded worker work only after its response",async()=>{
  const callbacks=[];let ingested=0,worked=0;
  const db=database({webhook_events:[]});
  const app=loader({
    "next/server":{after:fn=>callbacks.push(fn),NextResponse:{json:(value,init={})=>Response.json(value,init)}},
    "@/lib/supabase/admin":{supabaseAdmin:db},
    "@/lib/facebook/process-comment":{processFacebookComment:async()=>{ingested++;}},
    "@/lib/facebook/process-message":{processFacebookMessage:async()=>{}},
    "@/lib/facebook/process-messenger-referral":{processFacebookMessengerReferral:async()=>{}},
    "@/lib/facebook/process-message-reaction":{processFacebookMessageReaction:async()=>{}},
    "@/lib/facebook/mark-comment-thread-deleted":{markFacebookCommentThreadDeleted:async()=>{}},
    "@/lib/facebook/process-message-status":{processFacebookMessageStatus:async()=>{}},
    "@/lib/facebook/auto-reply":{runAutoReplyBatch:async()=>{worked++;}},
  },{Buffer,process:{env:{FACEBOOK_APP_SECRET:"test-secret",FACEBOOK_AUTO_REPLY_WORKER_ENABLED:"true"}}})("app/api/webhooks/facebook/route.ts");
  const raw=JSON.stringify({object:"page",entry:[{id:"123",changes:[{field:"feed",value:{item:"comment",verb:"add",comment_id:"123_c"}}]}]});
  const signature="sha256="+require("node:crypto").createHmac("sha256","test-secret").update(raw).digest("hex");
  const response=await app.POST(new Request("https://tenh.test/api/webhooks/facebook",{method:"POST",body:raw,headers:{"x-hub-signature-256":signature}}));
  assert.equal(response.status,200);assert.equal(ingested,1);assert.equal(worked,0);assert.equal(callbacks.length,1);
  await callbacks[0]();assert.equal(worked,1);
});
function harness(options = {}) {
  const rule = {id:"rule",business_id:"tenant",social_account_id:"page",name:"Test",enabled:true,starts_at:at(-120),activated_at:at(-90),post_id:null,public_template:"Public",private_template:"Private"};
  const job = {id:"job",business_id:"tenant",social_account_id:"page",rule_id:"rule",message_id:"message",comment_id:"123_comment",recipient_id:"customer",action:options.action||"public",activation:rule.activated_at,status:"claimed",attempts:1,claim_token:"claim"};
  const db = database({facebook_auto_reply_rules:[rule],facebook_auto_reply_jobs:[job,...(options.sibling?[options.sibling]:[])],
    social_accounts:[{id:"page",business_id:options.foreignPage?"other":"tenant",platform:"facebook",platform_account_id:"123",is_active:true}],
    messages:[{id:"message",business_id:"tenant",conversation_id:"chat",platform_message_id:"123_comment",sender_platform_id:"customer",platform_created_at:at(-30),raw_payload:{item:"comment",post_id:"123_post"}}],
    conversations:[{id:"chat",business_id:"tenant",social_account_id:"page"}],facebook_auto_reply_recipients:[]});
  db.rpc = async (name) => {
    if (name === "facebook_auto_reply_note_result") return { data:null,error:null };
    if (options.pause) {job.status="skipped"; return {data:false,error:null};}
    db.tables.facebook_auto_reply_jobs[0].status="sending"; return {data:true,error:null};
  };
  const posts=[];
  const fetch = async (url, init) => {
    if (init.method==="POST") {
      posts.push(JSON.parse(init.body));
      if (options.network) throw new Error("connection reset");
      if (options.invalid) return new Response("not JSON",{status:200});
      if (options.reject) return Response.json({error:{code:options.reject}},{status:400});
      return Response.json(job.action==="public"?{id:"public-id"}:{message_id:"private-id"});
    }
    if (String(url).includes("/comments?")) return Response.json({data:options.replies||[],...(options.more?{paging:{next:"next"}}:{})});
    return Response.json({id:job.comment_id,from:{id:job.recipient_id},object:{id:"123_post"},created_time:at(-30),can_reply_privately:options.eligible!==false});
  };
  const app = loader({
    "@/lib/supabase/admin":{supabaseAdmin:db},
    "@/lib/facebook/get-facebook-page-access-token":{resolveStoredFacebookPageAccessToken:()=>"token",refreshFacebookPageAccessToken:async()=>"token",isFacebookAccessTokenError:()=>false},
    "@/lib/facebook/messenger-reply-policy":{getFacebookMessengerReplyPolicy:async()=>({waitingForCustomerReply:!!options.waiting,latestDirectOutgoingAt:null,latestDirectIncomingAt:null})},
    "@/lib/facebook/confirm-comment-reply":{confirmCommentReply:async()=>options.confirmed||null},
  },{fetch,Date})("lib/facebook/auto-reply.ts");
  return {app,db,job,rule,posts};
}
test("fresh existing replies block sending, even replies by another customer",async()=>{
  const h=harness({replies:[{id:"someone"}]});await h.app.processAutoReplyJob(h.job);
  assert.equal(h.posts.length,0);assert.equal(h.db.tables.facebook_auto_reply_jobs[0].reason,"already_replied");
});
test("incomplete reply pages fail closed",async()=>{
  const h=harness({more:true});await h.app.processAutoReplyJob(h.job);assert.equal(h.posts.length,0);
});
test("tenant mismatch never resolves a Page token or sends",async()=>{
  const h=harness({foreignPage:true});await h.app.processAutoReplyJob(h.job);assert.equal(h.posts.length,0);
});
test("new-only cutoff rejects an older comment",async()=>{
  const h=harness();h.rule.activated_at=at(10);h.db.tables.facebook_auto_reply_rules[0].activated_at=h.rule.activated_at;
  await h.app.processAutoReplyJob(h.job);assert.equal(h.posts.length,0);
});
test("pause at the send boundary prevents unsent claimed work",async()=>{
  const h=harness({pause:true});await h.app.processAutoReplyJob(h.job);assert.equal(h.posts.length,0);
});
test("public failure and private success persist separate outcomes",async()=>{
  const h=harness({reject:200});await h.app.processAutoReplyJob(h.job);
  assert.equal(h.db.tables.facebook_auto_reply_jobs[0].status,"failed");
  const p=harness({action:"private",sibling:{id:"public-job",social_account_id:"page",comment_id:"123_comment",action:"public",status:"failed"}});
  await p.app.processAutoReplyJob(p.job);assert.equal(p.db.tables.facebook_auto_reply_jobs[0].status,"sent");
  assert.deepEqual(p.posts[0].recipient,{comment_id:"123_comment"});assert.equal(p.posts[0].tag,undefined);
});
test("both replies permit only the confirmed public sibling before private delivery",async()=>{
  const h=harness({action:"private",replies:[{id:"our-public"}],sibling:{id:"public-job",social_account_id:"page",comment_id:"123_comment",action:"public",status:"sent",platform_reply_id:"our-public"}});
  await h.app.processAutoReplyJob(h.job);assert.equal(h.posts.length,1);assert.equal(h.db.tables.facebook_auto_reply_jobs[0].status,"sent");
});
test("uncertain public send is reconciled without a second POST",async()=>{
  const h=harness({network:true,confirmed:"confirmed-public"});await h.app.processAutoReplyJob(h.job);
  assert.equal(h.posts.length,1);assert.equal(h.db.tables.facebook_auto_reply_jobs[0].status,"sent");
});
test("unknown private network outcome remains needs review without resend",async()=>{
  const h=harness({action:"private",network:true});await h.app.processAutoReplyJob(h.job);
  assert.equal(h.posts.length,1);assert.equal(h.db.tables.facebook_auto_reply_jobs[0].status,"needs_review");
});
test("private eligibility and waiting state prevent prohibited repeats",async()=>{
  for (const options of [{eligible:false},{waiting:true}]) {
    const h=harness({action:"private",...options});await h.app.processAutoReplyJob(h.job);assert.equal(h.posts.length,0);
  }
});
test("rate limits back off and bounded attempts become failed",async()=>{
  const h=harness({reject:4});await h.app.processAutoReplyJob(h.job);
  const row=h.db.tables.facebook_auto_reply_jobs[0];assert.equal(row.status,"retry");assert.ok(Date.parse(row.available_at)>Date.now());
  const last=harness({reject:4});last.job.attempts=4;await last.app.processAutoReplyJob(last.job);
  assert.equal(last.db.tables.facebook_auto_reply_jobs[0].status,"failed");
});
test("dry run performs reads only and can test a disabled draft",async()=>{
  const h=harness();h.db.tables.facebook_auto_reply_rules[0].enabled=false;
  const result=await h.app.inspectAutoReply(h.job,true);assert.equal(result.reason,null);assert.equal(h.posts.length,0);
  assert.ok(h.db.history.every(q=>q.op==="read"));
});
test("desktop/mobile Group Chat navigation removed while routes and data remain",()=>{
  const header=readFileSync(require("node:path").join(__dirname,"../components/dashboard/dashboard-header.tsx"),"utf8");
  const mobile=readFileSync(require("node:path").join(__dirname,"../mobile/app/(tabs)/_layout.tsx"),"utf8");
  assert.ok(!header.includes("GroupChatNavBadge"));assert.ok(!header.includes('href: "/dashboard/group-chat"'));
  assert.match(header,/label: "Inbox"[\s\S]*?label: "Tenh Bot", href: "\/dashboard\/tenh-bot"[\s\S]*?label: "Analytics"/);
  assert.match(header,/permission="channels"/);
  assert.match(mobile,/name="index"[\s\S]*?name="bot"[\s\S]*?name="analytics"/);
  assert.match(mobile,/href: canViewBot \? "\/bot" : null/);
  assert.match(mobile,/title: "Tenh Bot"/);
  const dedicated=readFileSync(require("node:path").join(__dirname,"../app/dashboard/tenh-bot/page.tsx"),"utf8");
  assert.ok(!dedicated.includes("SettingsSidebar"));assert.match(dedicated,/<AutoReplySettings/);
  assert.ok(!dedicated.includes("<aside"));assert.ok(!dedicated.includes("<nav"));
  const dashboardLayout=readFileSync(require("node:path").join(__dirname,"../app/dashboard/layout.tsx"),"utf8");
  assert.match(dashboardLayout,/<DashboardHeader/);
  assert.match(dedicated,/requirePermission\("channels", "view"\)/);
  const settings=readFileSync(require("node:path").join(__dirname,"../components/settings/settings-sidebar.tsx"),"utf8");
  assert.ok(!settings.includes("autoReply"));assert.ok(!settings.includes("/dashboard/tenh-bot"));
  const legacy=readFileSync(require("node:path").join(__dirname,"../app/dashboard/settings/auto-reply/page.tsx"),"utf8");
  assert.match(legacy,/redirect\("\/dashboard\/tenh-bot"\)/);
  assert.match(mobile,/name="group-chat"\s+options=\{\{\s+href: null/);
  assert.ok(require("node:fs").existsSync(require("node:path").join(__dirname,"../app/dashboard/group-chat/page.tsx")));
});
