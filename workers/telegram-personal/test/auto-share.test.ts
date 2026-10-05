import assert from "node:assert/strict";
import test from "node:test";
import { sessionDirectory } from "../src/local-data.ts";
import { FakeTelegram, type FakeUser } from "./helpers/fake-telegram.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";
import type { MemoryStore } from "./helpers/memory-store.ts";

/* Automatic sharing: every one-to-one chat with a real person, new messages only. */

const OWNER: FakeUser = { id: 5550001, firstName: "Fake Owner", phone: "85512345678" };
type H = ReturnType<typeof makeHarness<MemoryStore>>;
const client = (h: H, id: string) => h.telegram.clientFor(sessionDirectory(h.dataDir, id).database)!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Math.floor(Date.now() / 1000);

async function connected(h: H) {
  const id = h.store.beginLogin("biz-1", "qr");
  await h.supervisor.tick();
  await waitFor(() => h.store.logins.get(id)?.qrLink != null);
  client(h, id).approveQr(OWNER);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  return id;
}

test("with automatic sharing on, a message from a new person shares the chat and is stored; older history is not", async () => {
  const h = makeHarness();
  try {
    h.telegram.history.set(5001, [FakeTelegram.textMessage(5001, 50, "old message", { date: now() - 3600 })]);
    const id = await connected(h);
    h.store.setAutoShare(id, true);
    client(h, id).receive(FakeTelegram.textMessage(5001, 51, "hi there", { date: now() }));
    await waitFor(() => h.store.messages.some((m) => m.messageId === 51), 3000, "stored");
    assert.equal(h.store.shares.get(id)?.get("5001")?.title, "Customer A");
    assert.equal(h.store.shares.get(id)?.get("5001")?.unread, 1);
    await sleep(100);
    assert.ok(!h.store.messages.some((m) => m.messageId === 50), "older history never copied");
    assert.ok(!h.logs.join("\n").includes("hi there"));
  } finally {
    await h.cleanup();
  }
});

test("automatic sharing never brings in bots, the Telegram service account or groups", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    h.store.setAutoShare(id, true);
    const tg = client(h, id);
    tg.receive(FakeTelegram.textMessage(6001, 1, "bot says", { date: now() }));
    tg.receive(FakeTelegram.textMessage(777000, 2, "login code", { date: now() }));
    tg.receive(FakeTelegram.textMessage(-100123, 3, "group chatter", { date: now() }));
    tg.receive(FakeTelegram.textMessage(5002, 4, "real person", { date: now() }));
    await waitFor(() => h.store.messages.some((m) => m.messageId === 4), 3000, "person stored");
    await sleep(100);
    assert.deepEqual(h.store.messages.map((m) => m.chatId), ["5002"]);
    assert.deepEqual([...(h.store.shares.get(id)?.keys() ?? [])], ["5002"]);
  } finally {
    await h.cleanup();
  }
});

test("switched off, or a chat the holder stopped sharing: nothing is stored", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    client(h, id).receive(FakeTelegram.textMessage(5001, 1, "while off", { date: now() }));
    await waitFor(() => (h.store.unshared.get(id)?.size ?? 0) === 1, 3000, "only counted as waiting");
    assert.equal(h.store.messages.length, 0);

    h.store.shareChat(id, "5002");
    h.store.unshareChat(id, "5002");
    h.store.setAutoShare(id, true);
    await sleep(50);
    client(h, id).receive(FakeTelegram.textMessage(5002, 2, "stopped chat", { date: now() }));
    await sleep(200);
    assert.equal(h.store.messages.length, 0, "a stopped chat stays stopped");
  } finally {
    await h.cleanup();
  }
});

test("a message the holder sends to a new person also starts sharing when switched on", async () => {
  const h = makeHarness();
  try {
    const id = await connected(h);
    h.store.setAutoShare(id, true);
    client(h, id).receive(FakeTelegram.textMessage(5001, 9, "hello from my phone", { outgoing: true, date: now() }));
    await waitFor(() => h.store.messages.some((m) => m.messageId === 9 && m.direction === "outgoing"), 3000, "stored");
  } finally {
    await h.cleanup();
  }
});
