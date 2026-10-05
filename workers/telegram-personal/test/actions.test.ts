import assert from "node:assert/strict";
import test from "node:test";
import { sessionDirectory } from "../src/local-data.ts";
import { FakeTelegram, type FakeUser } from "./helpers/fake-telegram.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";
import type { MemoryStore } from "./helpers/memory-store.ts";

/* Same message buttons as Telegram Bot chats: edit, delete for everyone, typing. */

const OWNER: FakeUser = { id: 5550001, firstName: "Fake Owner", phone: "85512345678" };
type H = ReturnType<typeof makeHarness<MemoryStore>>;
const client = (h: H, id: string) => h.telegram.clientFor(sessionDirectory(h.dataDir, id).database)!;
const now = () => Math.floor(Date.now() / 1000);

async function chatWithMessages(h: H) {
  const id = h.store.beginLogin("biz-1", "qr");
  await h.supervisor.tick();
  await waitFor(() => h.store.logins.get(id)?.qrLink != null);
  client(h, id).approveQr(OWNER);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  h.store.shareChat(id, "5001");
  await waitFor(() => client(h, id).requests.some((r) => r._ === "getChatHistory"));
  client(h, id).receive(FakeTelegram.textMessage(5001, 10, "mine", { outgoing: true, date: now() }));
  client(h, id).receive(FakeTelegram.textMessage(5001, 11, "theirs", { date: now() }));
  await waitFor(() => h.store.messages.filter((m) => m.chatId === "5001").length === 2, 3000, "stored");
  return id;
}

test("edit from TENH changes the real Telegram message and the inbox copy", async () => {
  const h = makeHarness();
  try {
    const id = await chatWithMessages(h);
    const command = h.store.enqueueAction(id, "edit_text", { chat_id: "5001", message_id: 10, text: "mine (fixed)" });
    await waitFor(() => command.status === "done", 3000, "edited");
    assert.deepEqual(h.telegram.edits, [{ chatId: 5001, messageId: 10 }]);
    assert.equal(h.store.messages.find((m) => m.messageId === 10)?.body, "mine (fixed)");
    assert.ok(!h.logs.join("\n").includes("mine (fixed)"), "text never logged");
  } finally {
    await h.cleanup();
  }
});

test("an edit Telegram refuses is reported failed and the inbox copy is unchanged", async () => {
  const h = makeHarness();
  try {
    const id = await chatWithMessages(h);
    const command = h.store.enqueueAction(id, "edit_text", { chat_id: "5001", message_id: 11, text: "not allowed" });
    await waitFor(() => command.status === "failed", 3000, "refused");
    assert.equal(command.errorCode, "TELEGRAM_400");
    assert.equal(h.store.messages.find((m) => m.messageId === 11)?.body, "theirs");
  } finally {
    await h.cleanup();
  }
});

test("delete from TENH deletes for everyone in Telegram and marks it deleted by the member; repeating is harmless", async () => {
  const h = makeHarness();
  try {
    const id = await chatWithMessages(h);
    const row = h.store.messages.find((m) => m.messageId === 11)!;
    const command = h.store.enqueueAction(id, "delete_messages", { chat_id: "5001", message_ids: [11], member_id: "member-7" }, row.id);
    await waitFor(() => command.status === "done", 3000, "deleted");
    assert.deepEqual(h.telegram.deletions, [{ chatId: 5001, ids: [11], revoke: true }]);
    assert.equal(row.deleted, true);
    assert.equal(row.deletedBy, "member-7");
    const again = h.store.enqueueAction(id, "delete_messages", { chat_id: "5001", message_ids: [11], member_id: "member-7" }, row.id);
    await waitFor(() => again.status === "done", 3000, "already gone counts as done");
  } finally {
    await h.cleanup();
  }
});

test("typing shows 'typing…' in Telegram; actions on chats that are not shared are refused", async () => {
  const h = makeHarness();
  try {
    const id = await chatWithMessages(h);
    const typing = h.store.enqueueAction(id, "typing", { chat_id: "5001" });
    await waitFor(() => typing.status === "done", 3000, "typing");
    assert.deepEqual(h.telegram.chatActions, [{ chatId: 5001, action: "chatActionTyping" }]);
    const foreign = h.store.enqueueAction(id, "delete_messages", { chat_id: "5002", message_ids: [1] });
    await waitFor(() => foreign.status === "failed", 3000, "refused");
    assert.equal(foreign.errorCode, "CHAT_NOT_SHARED");
    assert.equal(h.telegram.deletions.length, 0);
  } finally {
    await h.cleanup();
  }
});
