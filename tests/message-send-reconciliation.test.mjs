import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inbox = readFileSync(new URL("../components/inbox/inbox-view.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/inbox/message-panel.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/facebook/send/route.ts", import.meta.url), "utf8");

test("Facebook text and quick replies carry the optimistic request id end to end", () => {
  assert.match(inbox, /clientRequestId:\s*tempId/);
  assert.match(route, /message:\s*\{[\s\S]*metadata: clientRequestId/);
  assert.match(route, /tenh_client_request_id: clientRequestId/);
});

test("a retry with the same request id returns the stored send", () => {
  assert.match(route, /contains\("raw_payload", \{ tenh_client_request_id: clientRequestId \}\)/);
  assert.match(route, /idempotentReplay: true/);
});

test("idempotent replay cannot bypass workspace, permission or recipient checks", () => {
  const replay = route.indexOf("if (clientRequestId)");
  assert.ok(route.indexOf("getInboxConversationAccess(conversationId)") < replay);
  assert.ok(route.indexOf('memberHasPermission(currentMember, "conversations", "manage")') < replay);
  assert.ok(route.indexOf("Recipient does not match the customer in this conversation.") < replay);
});

test("confirmation keeps one bubble and one render identity", () => {
  assert.match(inbox, /index === optimisticIndex \? replacement : message/);
  assert.match(panel, /DeferredInboxItem key=\{messageRenderKey\(message\)\}/);
  assert.doesNotMatch(inbox, /\.filter\([\s\S]{0,180}optimisticIndex[\s\S]{0,180}replacement/);
});

test("photo, file and prepared voice sends use the same stable correlation path", () => {
  assert.match(inbox, /formData\.set\("clientRequestId", pending\.tempId\)/);
  assert.match(inbox, /createOptimisticAttachmentMessage\([\s\S]*__render_key: tempId/);
  assert.match(inbox, /retainLocalImagePreview\(withOptimisticRenderKey/);
});
