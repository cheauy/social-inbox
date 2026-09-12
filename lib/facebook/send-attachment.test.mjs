import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { facebookMediaMessage } from "./media-message.ts";

const source = readFileSync(new URL("../../app/api/facebook/send-attachment/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness({ state = "standard", failUpload = 0, commentId = "post_comment" } = {}) {
  const requests = [];
  let uploads = 0;
  const records = {
    conversations: { id: "chat", business_id: "business", contact_id: "contact", social_account_id: "page", source_type: "comment" },
    contacts: { platform: "facebook", platform_user_id: "recipient" },
    social_accounts: { platform: "facebook", platform_account_id: "page", is_active: true },
    messages: null,
  };
  const admin = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from(table) {
    let write;
    const query = {
      select() { return this; }, eq() { return this; },
      update(value) { write = value; return this; }, insert(value) { write = value; return this; },
      async maybeSingle() { return { data: records[table], error: null }; },
      async single() { return { data: { id: "saved", ...write }, error: null }; },
      then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject); },
    };
    return query;
  } };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/facebook/media-message": { facebookMediaMessage },
    "@/lib/telegram/telegram-message-media": {
      TELEGRAM_MESSAGE_MEDIA_BUCKET: "test-media",
      telegramMessageMediaStoragePath: () => "test/file",
      telegramMessageMediaUrl: () => "/test/media",
    },
    "@/lib/inbox/get-inbox-resource-access": { getInboxConversationAccess: async () => ({ success: true, member: { id: "agent", business_id: "business" } }) },
    "@/lib/auth/require-permission": { memberHasPermission: async () => true },
    "@/lib/facebook/get-facebook-page-access-token": { getFacebookPageAccessToken: async () => "test-token", isFacebookAccessTokenError: () => false },
    "@/lib/inbox/conversation-preview": { getConversationMessagePreview: () => "Photo" },
    "@/lib/facebook/messenger-reply-policy": { getFacebookMessengerReplyPolicy: async () => ({ windowState: state, latestIncomingCommentId: commentId }) },
    "@/lib/supabase/admin": { supabaseAdmin: admin },
  };
  const fakeFetch = async (url, options) => {
    if (String(url).includes("message_attachments")) {
      uploads++;
      return Response.json(uploads === failUpload ? { error: { message: "Upload rejected" } } : { attachment_id: `attachment-${uploads}` }, { status: uploads === failUpload ? 400 : 200 });
    }
    if (options.method === "POST") {
      requests.push(JSON.parse(options.body));
      return Response.json({ message_id: "mid", recipient_id: "recipient" });
    }
    return Response.json({ attachments: { data: [] } });
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "fetch", compiled)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports, fakeFetch);
  return { post: module.exports.POST, requests, uploadCount: () => uploads };
}

function request(kind, count = 1) {
  const data = new FormData();
  data.set("conversationId", "chat"); data.set("recipientId", "recipient"); data.set("kind", kind);
  data.set("clientRequestId", "optimistic:attachment:one");
  for (let i = 0; i < count; i++) data.append(i ? "additionalFiles" : "file", new File(["bytes"], `${i}.bin`, { type: kind === "file" ? "application/pdf" : `${kind}/${kind === "audio" ? "wav" : kind === "video" ? "mp4" : "png"}` }));
  return { formData: async () => data };
}

test("route uploads photos and makes exactly one album send", async () => {
  const app = harness();
  assert.equal((await app.post(request("image", 2))).status, 200);
  assert.equal(app.uploadCount(), 2);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].message.attachments.length, 2);
  assert.equal(app.requests[0].message.metadata, "optimistic:attachment:one");
});
for (const kind of ["audio", "video", "file", "image"]) {
  test(`route keeps single ${kind} sends compatible`, async () => {
    const app = harness();
    assert.equal((await app.post(request(kind))).status, 200);
    assert.equal(app.requests[0].message.attachment.type, kind);
  });
}
test("failed second upload never sends a partial album", async () => {
  const app = harness({ failUpload: 2 });
  assert.equal((await app.post(request("image", 2))).status, 502);
  assert.equal(app.requests.length, 0);
});
for (const state of ["expired", "waiting_for_customer_reply", "unknown"]) {
  test(`policy ${state} blocks before media upload`, async () => {
    const app = harness({ state });
    assert.equal((await app.post(request("image", 2))).status, 409);
    assert.equal(app.uploadCount(), 0);
  });
}
test("human agent album preserves messaging tag", async () => {
  const app = harness({ state: "human_agent" });
  assert.equal((await app.post(request("image", 2))).status, 200);
  assert.equal(app.requests[0].tag, "HUMAN_AGENT");
});

test("initial private media reply targets the comment, not the comment author's ID", async () => {
  const app = harness({ state: "private_reply_available" });
  assert.equal((await app.post(request("image"))).status, 200);
  assert.deepEqual(app.requests[0].recipient, { comment_id: "post_comment" });
  assert.equal(app.requests[0].messaging_type, undefined);
  assert.equal(app.requests[0].tag, undefined);
});

test("missing private reply comment blocks before uploading or sending", async () => {
  const app = harness({ state: "private_reply_available", commentId: null });
  assert.equal((await app.post(request("image"))).status, 409);
  assert.equal(app.uploadCount(), 0);
  assert.equal(app.requests.length, 0);
});
