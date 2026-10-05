import test from "node:test";
import assert from "node:assert/strict";
import { confirmOutgoingMessage } from "./confirm-outgoing-message.ts";
const pending = { id: "temp", conversation_id: "chat", platform_message_id: null, text: "https://www.google.com/maps?q=1,2", delivery_status: "sent" };
const stored = { ...pending, id: "stored", platform_message_id: "mid", delivery_status: "seen" };
test("webhook before response confirms the original bubble in place", () => {
  assert.deepEqual(confirmOutgoingMessage([pending, stored], "temp", "mid"), [{
    ...stored,
    __render_key: "temp",
  }]);
});
test("response before webhook gives temporary message its platform ID", () => {
  assert.deepEqual(confirmOutgoingMessage([pending], "temp", "mid"), [{ ...pending, platform_message_id: "mid" }]);
});
test("intentional repeated location with a different ID is kept", () => {
  assert.equal(confirmOutgoingMessage([pending, stored], "temp", "other-mid").length, 2);
});
test("another conversation cannot remove the temporary message", () => {
  assert.equal(confirmOutgoingMessage([pending, { ...stored, conversation_id: "other" }], "temp", "mid").length, 2);
});
test("already reconciled message is unchanged", () => {
  assert.deepEqual(confirmOutgoingMessage([stored], "temp", "mid"), [stored]);
});

test("confirmation keeps the temporary list position", () => {
  const before = { ...stored, id: "before", platform_message_id: "before" };
  assert.deepEqual(
    confirmOutgoingMessage([before, pending, stored], "temp", "mid").map((message) => message.id),
    ["before", "stored"],
  );
});

test("confirmation keeps the optimistic display time stable", () => {
  const optimistic = { ...pending, id: "optimistic:one", platform_created_at: "2026-10-02T01:38:00.000Z" };
  const confirmed = { ...stored, platform_created_at: "2026-10-02T01:39:00.000Z" };
  assert.equal(
    confirmOutgoingMessage([optimistic, confirmed], optimistic.id, "mid")[0].platform_created_at,
    optimistic.platform_created_at,
  );
});
