import test from "node:test";
import assert from "node:assert/strict";
import { matchesOptimisticMessage } from "./optimistic-message-match.ts";

const pending = {
  id: "optimistic:request-one",
  conversation_id: "conversation-one",
  platform_message_id: "optimistic:request-one",
};

test("matches a Messenger echo by its exact client request id", () => {
  assert.equal(matchesOptimisticMessage(pending, {
    direction: "outgoing",
    conversation_id: "conversation-one",
    platform_message_id: "mid-one",
    raw_payload: { message: { metadata: pending.id } },
  }), true);
});

test("matches the locally stored send by its exact client request id", () => {
  assert.equal(matchesOptimisticMessage(pending, {
    direction: "outgoing",
    conversation_id: "conversation-one",
    platform_message_id: "mid-one",
    raw_payload: { tenh_client_request_id: pending.id },
  }), true);
});

test("does not merge distinct identical messages without correlation", () => {
  assert.equal(matchesOptimisticMessage(pending, {
    direction: "outgoing",
    conversation_id: "conversation-one",
    platform_message_id: "mid-two",
    message_text: "same text",
    raw_payload: { message: { text: "same text" } },
  }), false);
});

test("does not merge identical messages carrying different request ids", () => {
  assert.equal(matchesOptimisticMessage(pending, {
    direction: "outgoing",
    conversation_id: "conversation-one",
    platform_message_id: "mid-two",
    message_text: "same text",
    raw_payload: { message: { text: "same text", metadata: "optimistic:request-two" } },
  }), false);
});

test("response-before-echo matches the assigned platform id", () => {
  assert.equal(matchesOptimisticMessage({ ...pending, platform_message_id: "mid-one" }, {
    direction: "outgoing",
    conversation_id: "conversation-one",
    platform_message_id: "mid-one",
  }), true);
});

test("never matches a correlated event from another conversation", () => {
  assert.equal(matchesOptimisticMessage(pending, {
    direction: "outgoing",
    conversation_id: "conversation-two",
    raw_payload: { message: { metadata: pending.id } },
  }), false);
});
