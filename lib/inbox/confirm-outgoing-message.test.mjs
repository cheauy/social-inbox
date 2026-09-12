import test from "node:test";
import assert from "node:assert/strict";
import { confirmOutgoingMessage } from "./confirm-outgoing-message.ts";
const pending = { id: "temp", conversation_id: "chat", platform_message_id: null, text: "https://www.google.com/maps?q=1,2", delivery_status: "sent" };
const stored = { ...pending, id: "stored", platform_message_id: "mid", delivery_status: "seen" };
test("webhook before response removes temporary location and preserves seen receipt", () => {
  assert.deepEqual(confirmOutgoingMessage([pending, stored], "temp", "mid"), [stored]);
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
