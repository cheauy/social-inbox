import assert from "node:assert/strict";
import test from "node:test";
import { listPrivateChats, loadHistory, mapMessage } from "../src/chats.ts";
import { sessionDirectory } from "../src/local-data.ts";
import { Supervisor } from "../src/supervisor.ts";
import type { TdObject } from "../src/tdlib-port.ts";
import { FakeTelegram, type FakeUser } from "./helpers/fake-telegram.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";
import type { MemoryStore } from "./helpers/memory-store.ts";

const OWNER: FakeUser = { id: 5550001, firstName: "Fake Owner", phone: "85512345678" };
type H = ReturnType<typeof makeHarness<MemoryStore>>;

const client = (h: H, id: string) => h.telegram.clientFor(sessionDirectory(h.dataDir, id).database)!;

async function connected(h: H) {
  const id = h.store.beginLogin("biz-1", "qr");
  await h.supervisor.tick();
  await waitFor(() => h.store.logins.get(id)?.qrLink != null);
  client(h, id).approveQr(OWNER);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  return id;
}

const messagesOf = (h: H, chatId: string) => h.store.messages.filter((m) => m.chatId === chatId);

test("mapMessage: text, placeholders with caption, skips pending sends and service notices", () => {
  const now = 1_790_000_000;
  assert.deepEqual(mapMessage(FakeTelegram.textMessage(5001, 7, "hi", { date: now })), {
    chatId: "5001", messageId: 7, direction: "incoming", type: "text", body: "hi", placeholder: null, sentAt: new Date(now * 1000).toISOString(),
  });
  const photo = mapMessage({ _: "message", id: 8, chat_id: 5001, is_outgoing: true, date: now, content: { _: "messagePhoto", caption: { text: "look" } } });
  assert.equal(photo?.type, "placeholder");
  assert.equal(photo?.placeholder, "photo");
  assert.equal(photo?.body, "look");
  assert.equal(photo?.direction, "outgoing");
  assert.equal(mapMessage({ _: "message", id: 9, chat_id: 5001, date: now, content: { _: "messageDice" } })?.placeholder, "other");
  assert.equal(mapMessage({ ...FakeTelegram.textMessage(5001, 10, "x"), sending_state: { _: "messageSendingStatePending" } }), null);
  assert.equal(mapMessage({ _: "message", id: 11, chat_id: 5001, date: now, content: { _: "messageContactRegistered" } }), null);
  assert.equal(mapMessage({ _: "message", id: 12, chat_id: 5001, date: now, content: { _: "messageText", text: { text: "" } } }), null);
});

test("listPrivateChats: only one-to-one chats with real users, no bots, groups, service or Saved Messages", async () => {
  const telegram = new FakeTelegram();
  telegram.history.set(5002, [FakeTelegram.textMessage(5002, 1, "newer", { date: 1_790_000_100 })]);
  telegram.history.set(5001, [FakeTelegram.textMessage(5001, 1, "older", { date: 1_790_000_000 })]);
  telegram.authorized.set("/db", OWNER);
  const fake = telegram.create({ databaseDirectory: "/db", filesDirectory: "/f", databaseEncryptionKey: "k" });
  const chats = await listPrivateChats((request) => fake.invoke(request), OWNER.id);
  assert.deepEqual(chats.map((c) => c.chat_id), ["5002", "5001"], "newest first");
  assert.equal(chats[1].username, "cust_a");
  await fake.close();
});

test("loadHistory pages through TDLib's inclusive pages without repeats", async () => {
  const telegram = new FakeTelegram();
  telegram.history.set(5001, Array.from({ length: 130 }, (_, i) => FakeTelegram.textMessage(5001, 1000 - i, `m${i}`)));
  telegram.authorized.set("/db", OWNER);
  const fake = telegram.create({ databaseDirectory: "/db", filesDirectory: "/f", databaseEncryptionKey: "k" });
  const invoke = (request: TdObject) => fake.invoke(request);
  const fifty = await loadHistory(invoke, "5001", 50);
  assert.equal(fifty.length, 50);
  assert.equal(new Set(fifty.map((m) => m.id)).size, 50);
  const all = await loadHistory(invoke, "5001", 120);
  assert.equal(all.length, 120);
  assert.equal(new Set(all.map((m) => m.id)).size, 120, "no duplicates across pages");
  assert.equal(all[0].id, 1000);
  await fake.close();
});

test("chat list request returns the holder's private chats to the command result", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    const command = h.store.requestChatList(id);
    await waitFor(() => command.status === "done", 3000, "chat list");
    const chats = (command.result as { chats: Array<{ chat_id: string }> }).chats.map((c) => c.chat_id).sort();
    assert.deepEqual(chats, ["5001", "5002"]);
    assert.ok(!h.logs.join("\n").includes("Customer A"), "chat names never logged");
  } finally {
    await h.cleanup();
  }
});

test("live messages: shared chat stored once, unshared counted only, groups and outgoing-unshared ignored", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    h.store.shareChat(id, "5001");
    await waitFor(() => h.store.ingestCalls >= 0 && client(h, id).requests.some((r) => r._ === "getChatHistory"), 3000, "catch-up ran");
    const c = client(h, id);
    const first = FakeTelegram.textMessage(5001, 101, "hello", { date: Math.floor(Date.now() / 1000) + 5 });
    c.receive(first);
    c.emit({ _: "updateNewMessage", message: first }); // repeated update
    await waitFor(() => messagesOf(h, "5001").length === 1);
    c.receive(FakeTelegram.textMessage(5002, 201, "not shared"));
    c.receive(FakeTelegram.textMessage(5002, 202, "mine", { outgoing: true }));
    c.receive(FakeTelegram.textMessage(-100123, 301, "group chatter"));
    c.receive(FakeTelegram.textMessage(OWNER.id, 401, "note to self"));
    await waitFor(() => h.store.unshared.get(id)?.has("5002") === true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(h.store.messages.length, 1, "only the shared chat message is stored");
    assert.equal(h.store.unshared.get(id)?.size, 1);
    assert.equal(h.store.shares.get(id)?.get("5001")?.unread, 1);
    assert.ok(!h.logs.join("\n").includes("hello"), "message text never logged");
  } finally {
    await h.cleanup();
  }
});

test("out-of-order delivery keeps the newest preview", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    h.store.shareChat(id, "5001");
    await waitFor(() => client(h, id).requests.some((r) => r._ === "getChatHistory"));
    const now = Math.floor(Date.now() / 1000) + 10;
    client(h, id).emit({ _: "updateNewMessage", message: FakeTelegram.textMessage(5001, 20, "newer", { date: now + 5 }) });
    client(h, id).emit({ _: "updateNewMessage", message: FakeTelegram.textMessage(5001, 19, "older", { date: now }) });
    await waitFor(() => messagesOf(h, "5001").length === 2);
    assert.equal(h.store.shares.get(id)?.get("5001")?.preview, "newer");
  } finally {
    await h.cleanup();
  }
});

test("sharing with last 50 imports history without inflating unread", async () => {
  const h = makeHarness();
  try {
    h.telegram.history.set(5002, Array.from({ length: 70 }, (_, i) => FakeTelegram.textMessage(5002, 500 - i, `old ${i}`, { date: 1_700_000_000 - i })));
    const id = await connected(h);
    h.store.shareChat(id, "5002", "last_50");
    await waitFor(() => h.store.commands.some((c) => c.kind === "import_history" && c.status === "done"), 3000, "import done");
    assert.equal(messagesOf(h, "5002").length, 50);
    assert.equal(h.store.shares.get(id)?.get("5002")?.unread, 0);
  } finally {
    await h.cleanup();
  }
});

test("messages received while the worker was stopped are caught up after restart", async () => {
  const h = makeHarness();
  const id = await connected(h);
  h.store.shareChat(id, "5001");
  await waitFor(() => client(h, id).requests.some((r) => r._ === "getChatHistory"));
  await h.supervisor.shutdown();
  // Arrives on Telegram while TENH is offline: no update reaches the worker.
  h.telegram.history.set(5001, [FakeTelegram.textMessage(5001, 900, "while offline", { date: Math.floor(Date.now() / 1000) + 30 })]);
  const restarted = new Supervisor({ store: h.store, factory: h.telegram, config: h.config, log: () => undefined });
  try {
    await restarted.tick();
    await waitFor(() => messagesOf(h, "5001").some((m) => m.messageId === 900), 3000, "caught up");
    assert.equal(h.store.shares.get(id)?.get("5001")?.unread, 1, "missed incoming counts as unread");
  } finally {
    await restarted.shutdown();
    await h.cleanup();
  }
});

test("unsharing stops storing new messages", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    h.store.shareChat(id, "5001");
    await waitFor(() => client(h, id).requests.some((r) => r._ === "getChatHistory"));
    h.store.unshareChat(id, "5001");
    client(h, id).receive(FakeTelegram.textMessage(5001, 700, "after unshare"));
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(messagesOf(h, "5001").length, 0);
  } finally {
    await h.cleanup();
  }
});
