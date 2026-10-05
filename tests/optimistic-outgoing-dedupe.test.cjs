const test = require("node:test");
const assert = require("node:assert/strict");

const { loader } = require("./tenh-seven/harness.cjs");

/*
 * Outgoing Messenger messages drawn twice.
 *
 * Inbox state is driven only through the real helpers the Inbox uses: every
 * update goes through normalizeMessages exactly as setLiveMessages does, and a
 * send response goes through confirmOutgoingMessage. The server-side paths are
 * modelled as the Inbox applies them -- props, polling and history merge by
 * database id; Realtime UPDATEs patch an existing row in place.
 */

const load = loader({});
const { normalizeMessages } = load("lib/inbox/normalize-messages.ts");
const { confirmOutgoingMessage, messageRenderKey, isOptimisticConfirmedByServer } =
  load("lib/inbox/confirm-outgoing-message.ts");

const CONVERSATION = "11111111-1111-4111-8111-111111111111";
const OTHER_CONVERSATION = "22222222-2222-4222-8222-222222222222";
const BUSINESS = "33333333-3333-4333-8333-333333333333";

function inbox(initial = []) {
  let state = normalizeMessages(initial);
  return {
    get rows() { return state; },
    set(update) {
      state = normalizeMessages(typeof update === "function" ? update(state) : update, state);
    },
  };
}

function optimistic({ tempId, conversationId = CONVERSATION, text = "Hello", ...rest }) {
  return {
    id: tempId,
    business_id: BUSINESS,
    platform_message_id: tempId,
    conversation_id: conversationId,
    direction: "outgoing",
    message_type: "text",
    message_text: text,
    attachment_url: null,
    raw_payload: { tenh_client_request_id: tempId },
    created_at: "2026-10-05T07:00:00.000Z",
    platform_created_at: "2026-10-05T07:00:00.000Z",
    delivery_status: null,
    __optimistic_status: "sending",
    ...rest,
  };
}

function stored({ id, mid, conversationId = CONVERSATION, text = "Hello", requestId = null, metadata = null, ...rest }) {
  return {
    id,
    business_id: BUSINESS,
    platform_message_id: mid,
    conversation_id: conversationId,
    direction: "outgoing",
    message_type: "text",
    message_text: text,
    attachment_url: null,
    raw_payload: {
      ...(requestId ? { tenh_client_request_id: requestId } : {}),
      ...(metadata ? { message: { metadata } } : {}),
    },
    created_at: "2026-10-05T07:00:01.000Z",
    platform_created_at: "2026-10-05T07:00:01.000Z",
    delivery_status: "sent",
    ...rest,
  };
}

/* Props, polling and history: replace rows with the same database id, append the rest. */
const mergeById = (current, serverRows) => {
  const byId = new Map(serverRows.map((row) => [row.id, row]));
  const merged = current.map((row) => byId.has(row.id) ? { ...row, ...byId.get(row.id) } : row);
  return [...merged, ...serverRows.filter((row) => !current.some((existing) => existing.id === row.id))];
};

/* A Realtime UPDATE to a row the Inbox already holds. */
const realtimeUpdate = (current, row) => current.map((message) => message.id === row.id ? { ...message, ...row } : message);

/* A lost or failed send response, as performOptimisticSend applies it. */
const markFailed = (current, tempId) => current.map((message) => message.id === tempId ? { ...message, __optimistic_status: "failed" } : message);

const visible = (rows, conversationId = CONVERSATION) => rows.filter((row) => row.conversation_id === conversationId);

test("reproduction: persisted row before response, late correlation, lost response, poll, refresh, reopen", () => {
  const tempId = "optimistic:aaaa";
  const view = inbox();

  // 1. The agent sends; the pending bubble appears.
  view.set((current) => [...current, optimistic({ tempId })]);

  // 2. The echo is stored before Meta's response, without the request id yet.
  const echo = stored({ id: "db-1", mid: "m_real_1" });
  view.set((current) => mergeById(current, [echo]));

  // 3. The send route attaches the client request id to the existing row.
  view.set((current) => realtimeUpdate(current, { ...echo, raw_payload: { tenh_client_request_id: tempId } }));

  // 4. The send response never arrives.
  view.set((current) => markFailed(current, tempId));

  // 5. Poll, refresh and reopen from a cached page.
  view.set((current) => mergeById(current, [{ ...echo, raw_payload: { tenh_client_request_id: tempId } }]));
  view.set((current) => mergeById(current, [{ ...echo, raw_payload: { tenh_client_request_id: tempId }, delivery_status: "delivered" }]));
  const reopened = normalizeMessages(view.rows.slice());

  for (const rows of [view.rows, reopened]) {
    const shown = visible(rows);
    assert.equal(shown.length, 1, "exactly one bubble");
    assert.equal(shown[0].id, "db-1", "the stored row is what remains");
    assert.equal(shown[0].__optimistic_status, undefined, "no leftover pending/failed state");
    assert.equal(messageRenderKey(shown[0]), tempId, "React identity of the bubble is unchanged");
  }
});

test("response before echo: the response MID confirms, the echo then merges into it", () => {
  const tempId = "optimistic:resp-first";
  const view = inbox([optimistic({ tempId })]);

  view.set((current) => confirmOutgoingMessage(current, tempId, "m_real_2"));
  view.set((current) => mergeById(current, [stored({ id: "db-2", mid: "m_real_2", metadata: tempId })]));

  const shown = visible(view.rows);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "db-2");
  assert.equal(messageRenderKey(shown[0]), tempId);
});

test("echo before response: correlated echo replaces the bubble, the late response is a no-op", () => {
  const tempId = "optimistic:echo-first";
  const view = inbox([optimistic({ tempId })]);

  view.set((current) => mergeById(current, [stored({ id: "db-3", mid: "m_real_3", metadata: tempId })]));
  assert.equal(visible(view.rows).length, 1);

  view.set((current) => confirmOutgoingMessage(current, tempId, "m_real_3"));
  const shown = visible(view.rows);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].id, "db-3");
});

test("a late send error cannot downgrade a message an exact server event already confirmed", () => {
  const tempId = "optimistic:late-error";
  const view = inbox([optimistic({ tempId })]);

  view.set((current) => mergeById(current, [stored({ id: "db-4", mid: "m_real_4", requestId: tempId })]));
  assert.equal(isOptimisticConfirmedByServer(view.rows, tempId), true);

  view.set((current) => markFailed(current, tempId));
  const shown = visible(view.rows);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].__optimistic_status, undefined);
});

test("a pending bubble with no correlated server row stays pending and visible", () => {
  const tempId = "optimistic:unmatched";
  const view = inbox([optimistic({ tempId })]);

  view.set((current) => markFailed(current, tempId));
  view.set((current) => mergeById(current, [stored({ id: "db-x", mid: "m_unrelated" })]));

  const pending = visible(view.rows).filter((row) => row.id === tempId);
  assert.equal(pending.length, 1, "never hidden");
  assert.equal(pending[0].__optimistic_status, "failed", "uncertain stays uncertain");
  assert.equal(isOptimisticConfirmedByServer(view.rows, tempId), false);
});

test("repeated Realtime events for the same row never multiply it", () => {
  const tempId = "optimistic:repeat";
  const view = inbox([optimistic({ tempId })]);
  const row = stored({ id: "db-5", mid: "m_real_5", requestId: tempId });

  for (let i = 0; i < 4; i += 1) {
    view.set((current) => mergeById(current, [row]));
    view.set((current) => realtimeUpdate(current, { ...row, delivery_status: i % 2 ? "delivered" : "sent" }));
  }

  assert.equal(visible(view.rows).length, 1);
});

test("two intentionally identical sends remain two messages", () => {
  const view = inbox([
    optimistic({ tempId: "optimistic:same-1", text: "OK" }),
    optimistic({ tempId: "optimistic:same-2", text: "OK" }),
  ]);

  view.set((current) => mergeById(current, [
    stored({ id: "db-6", mid: "m_same_1", text: "OK", requestId: "optimistic:same-1" }),
    stored({ id: "db-7", mid: "m_same_2", text: "OK", requestId: "optimistic:same-2" }),
  ]));

  const shown = visible(view.rows);
  assert.equal(shown.length, 2);
  assert.equal(JSON.stringify(shown.map((row) => row.id).sort()), JSON.stringify(["db-6", "db-7"]));
  assert.equal(JSON.stringify(shown.map(messageRenderKey).sort()), JSON.stringify(["optimistic:same-1", "optimistic:same-2"]));
});

test("same text and time but no exact correlation is never merged", () => {
  const tempId = "optimistic:mine";
  const view = inbox([optimistic({ tempId, text: "Price?" })]);

  view.set((current) => mergeById(current, [stored({ id: "db-8", mid: "m_other", text: "Price?",
    created_at: "2026-10-05T07:00:00.000Z", platform_created_at: "2026-10-05T07:00:00.000Z" })]));

  assert.equal(visible(view.rows).length, 2);
});

test("another agent's message carrying their own request id is not folded into mine", () => {
  const view = inbox([optimistic({ tempId: "optimistic:agent-a", text: "Hi" })]);

  view.set((current) => mergeById(current, [stored({ id: "db-9", mid: "m_agent_b", text: "Hi", requestId: "optimistic:agent-b" })]));

  assert.equal(visible(view.rows).length, 2);
});

test("a correlated row in another conversation never confirms this one", () => {
  const tempId = "optimistic:isolated";
  const view = inbox([optimistic({ tempId })]);

  view.set((current) => mergeById(current, [stored({ id: "db-10", mid: "m_elsewhere", requestId: tempId, conversationId: OTHER_CONVERSATION })]));

  assert.equal(visible(view.rows).filter((row) => row.id === tempId).length, 1, "still pending here");
  assert.equal(visible(view.rows, OTHER_CONVERSATION).length, 1, "the other conversation keeps its own row");
});

test("attachment preview, reply context and the strongest receipt survive the merge", () => {
  const tempId = "optimistic:attachment";
  const view = inbox([optimistic({
    tempId,
    message_type: "image",
    attachment_url: "blob:http://local/preview",
    raw_payload: { tenh_client_request_id: tempId, tenh_reply: { message_id: "db-parent", text: "Which size?" } },
  })]);

  view.set((current) => mergeById(current, [stored({ id: "db-11", mid: "m_img", requestId: tempId,
    message_type: "image", attachment_url: null, delivery_status: "seen", seen_at: "2026-10-05T07:01:00.000Z" })]));
  view.set((current) => realtimeUpdate(current, { id: "db-11", delivery_status: "delivered" }));

  const [row] = visible(view.rows);
  assert.equal(visible(view.rows).length, 1);
  assert.equal(row.delivery_status, "seen", "a weaker receipt never downgrades");
  assert.ok(row.attachment_url, "the image preview is kept until the stored url exists");
  assert.equal(row.raw_payload.tenh_reply.message_id, "db-parent", "reply context retained");
});

test("message order is preserved: the confirmed row keeps the bubble's place", () => {
  const tempId = "optimistic:order";
  const before = stored({ id: "db-before", mid: "m_before", created_at: "2026-10-05T06:59:00.000Z", platform_created_at: "2026-10-05T06:59:00.000Z" });
  const view = inbox([before, optimistic({ tempId })]);

  view.set((current) => [stored({ id: "db-12", mid: "m_real_12", requestId: tempId }), ...current]);

  assert.equal(JSON.stringify(visible(view.rows).map((row) => row.id)), JSON.stringify(["db-before", "db-12"]));
});
