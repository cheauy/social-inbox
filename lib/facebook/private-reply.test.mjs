import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { getFacebookMessengerWindowState } from "./messenger-window.ts";

function load(path, dependencies, fetch) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, fetch);
  return module.exports;
}

async function policy(rows) {
  const query = {
    select() { return this; }, eq(column, id) { assert.equal(column, "conversation_id"); assert.equal(id, "chat"); return this; },
    order() { return this; }, limit: async () => ({ data: rows, error: null }),
  };
  return load("./messenger-reply-policy.ts", {
    "@/lib/facebook/messenger-window": { getFacebookMessengerWindowState },
    "@/lib/supabase/admin": { supabaseAdmin: { from: () => query } },
  }).getFacebookMessengerReplyPolicy("chat");
}
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const comment = (id, minutes = 5) => ({ direction: "incoming", platform_message_id: id, platform_created_at: at(minutes), raw_payload: { item: "comment", comment_id: id } });

test("policy selects newest incoming comment even after a Page public reply", async () => {
  const result = await policy([
    comment("old", 20),
    { direction: "outgoing", platform_created_at: at(1), raw_payload: { source: "facebook_comment_reply", comment_id: "page-reply" } },
    comment("new"),
  ]);
  assert.equal(result.windowState, "private_reply_available");
  assert.equal(result.latestIncomingCommentId, "new");
});
test("imported comment uses its platform message ID", async () => {
  const row = comment("imported"); row.raw_payload = { item: "comment" };
  assert.equal((await policy([row])).latestIncomingCommentId, "imported");
});
test("successful private reply locks further sends until customer responds", async () => {
  const result = await policy([comment("new"), { direction: "outgoing", platform_created_at: at(1), raw_payload: { message_id: "mid", recipient_id: "psid" } }]);
  assert.equal(result.windowState, "waiting_for_customer_reply");
});

function harness(state, commentId = "post_comment", rejected = false) {
  const requests = [];
  const records = {
    conversations: { id: "chat", business_id: "business", contact_id: "contact", social_account_id: "page" },
    contacts: { platform: "facebook", platform_user_id: "comment-author" },
    social_accounts: { platform: "facebook", platform_account_id: "page", is_active: true }, messages: null,
  };
  const admin = { from(table) { return {
    select() { return this; }, eq() { return this; }, update() { return this; }, insert() { return this; },
    maybeSingle: async () => ({ data: records[table], error: null }),
    then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
  }; } };
  const { POST } = load("../../app/api/facebook/send/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/inbox/get-inbox-resource-access": { getInboxConversationAccess: async () => ({ success: true, member: { id: "agent", business_id: "business" } }) },
    "@/lib/auth/require-permission": { memberHasPermission: () => true },
    "@/lib/facebook/get-facebook-page-access-token": { getFacebookPageAccessToken: async () => "test-token", isFacebookAccessTokenError: () => false },
    "@/lib/inbox/conversation-preview": { getConversationMessagePreview: () => "Hello" },
    "@/lib/facebook/messenger-reply-policy": { getFacebookMessengerReplyPolicy: async () => ({ windowState: state, latestIncomingCommentId: commentId }) },
    "@/lib/supabase/admin": { supabaseAdmin: admin },
  }, async (url, options) => {
    requests.push(JSON.parse(options.body));
    return rejected ? Response.json({ error: { code: 551, message: "This person isn't available right now." } }, { status: 400 })
      : Response.json({ message_id: "mid", recipient_id: "psid" });
  });
  return { requests, send: (recipientId = "comment-author") => POST({ json: async () => ({ conversationId: "chat", recipientId, message: "Hello" }) }) };
}

for (const [state, recipient, type, tag] of [
  ["private_reply_available", { comment_id: "post_comment" }, undefined, undefined],
  ["standard", { id: "comment-author" }, "RESPONSE", undefined],
  ["human_agent", { id: "comment-author" }, "MESSAGE_TAG", "HUMAN_AGENT"],
]) test(`${state} uses the correct Meta recipient and messaging type`, async () => {
  const app = harness(state);
  assert.equal((await app.send()).status, 200);
  assert.equal(app.requests.length, 1);
  assert.deepEqual(app.requests[0].recipient, recipient);
  assert.equal(app.requests[0].messaging_type, type);
  assert.equal(app.requests[0].tag, tag);
});
for (const state of ["expired", "waiting_for_customer_reply", "unknown"]) test(`${state} never calls Meta`, async () => {
  const app = harness(state);
  assert.equal((await app.send()).status, 409);
  assert.equal(app.requests.length, 0);
});
test("private reply with missing comment ID fails closed", async () => {
  const app = harness("private_reply_available", null);
  assert.equal((await app.send()).status, 409);
  assert.equal(app.requests.length, 0);
});
test("caller cannot redirect private reply to another customer", async () => {
  const app = harness("private_reply_available");
  assert.equal((await app.send("different-customer")).status, 400);
  assert.equal(app.requests.length, 0);
});
test("Meta 551 remains an error without a second send or tag fallback", async () => {
  const app = harness("private_reply_available", "post_comment", true);
  assert.equal((await app.send()).status, 400);
  assert.equal(app.requests.length, 1);
});
