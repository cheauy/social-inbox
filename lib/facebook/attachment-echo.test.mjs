import test from "node:test";
import assert from "node:assert/strict";
import { withoutEchoedAttachmentDrafts } from "./attachment-echo.ts";

const draft = { id: "optimistic:attachment:one", conversation_id: "chat-a", direction: "outgoing", raw_payload: {} };
const echo = { ...draft, id: "saved", raw_payload: { message: { metadata: draft.id } } };
test("Meta echo replaces only its matching pending album", () => {
  const second = { ...draft, id: "optimistic:attachment:two" };
  assert.deepEqual(withoutEchoedAttachmentDrafts([draft, echo, second]), [echo, second]);
});
test("same send id in another chat cannot remove this draft", () => {
  const other = { ...echo, conversation_id: "chat-b" };
  assert.deepEqual(withoutEchoedAttachmentDrafts([draft, other]), [draft, other]);
});
test("similar photos without exact metadata stay separate", () => {
  const unrelated = { ...echo, raw_payload: {} };
  assert.deepEqual(withoutEchoedAttachmentDrafts([draft, unrelated]), [draft, unrelated]);
});
test("incoming customer metadata cannot remove an outgoing draft", () => {
  const incoming = { ...echo, direction: "incoming" };
  assert.deepEqual(withoutEchoedAttachmentDrafts([draft, incoming]), [draft, incoming]);
});
