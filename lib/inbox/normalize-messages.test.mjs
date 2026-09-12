import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessages } from "./normalize-messages.ts";

const row = (patch = {}) => ({ id: "stored", conversation_id: "chat", platform_message_id: "mid", message_type: "text", message_text: "Hello", attachment_url: null, delivery_status: "sent", seen_at: null, delivered_at: null, ...patch });
for (const message_type of ["text", "audio", "voice", "video", "image", "file", "location"]) {
  for (const reversed of [false, true]) test(`${message_type}: ${reversed ? "late temporary response" : "read update"} stays one bubble`, () => {
    const temporary = row({ id: "optimistic:one", message_type, __optimistic_status: "sent", attachment_url: "blob:preview" });
    const stored = row({ message_type, delivery_status: "seen", seen_at: "2026-09-12T12:00:00Z" });
    const result = normalizeMessages(reversed ? [stored, temporary] : [temporary, stored]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "stored");
    assert.equal(result[0].delivery_status, "seen");
    assert.equal(result[0].__optimistic_status, undefined);
    assert.equal(result[0].attachment_url, "blob:preview");
  });
}
test("stale poll cannot downgrade seen receipt to sent", () => {
  const result = normalizeMessages([row()], [row({ delivery_status: "seen", seen_at: "now" })]);
  assert.equal(result[0].delivery_status, "seen");
  assert.equal(result[0].seen_at, "now");
});
test("intentional identical texts with distinct platform IDs remain separate", () => {
  assert.equal(normalizeMessages([row(), row({ id: "other", platform_message_id: "other" })]).length, 2);
});
test("platform IDs are scoped to conversation", () => {
  assert.equal(normalizeMessages([row(), row({ conversation_id: "other" })]).length, 2);
});
test("unsent messages without platform IDs stay separate", () => {
  assert.equal(normalizeMessages([row({ id: "optimistic:a", platform_message_id: null }), row({ id: "optimistic:b", platform_message_id: null })]).length, 2);
});
test("removed messages are not restored from prior state", () => {
  assert.deepEqual(normalizeMessages([], [row()]), []);
});
