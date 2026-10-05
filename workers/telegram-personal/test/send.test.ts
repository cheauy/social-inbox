import assert from "node:assert/strict";
import test from "node:test";
import { sessionDirectory } from "../src/local-data.ts";
import { Supervisor } from "../src/supervisor.ts";
import { FakeTelegram, type FakeUser } from "./helpers/fake-telegram.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";
import type { MemoryStore } from "./helpers/memory-store.ts";

/*
 * D2: replies from TENH through the holder's own Telegram account.
 * The rule under test everywhere: a send reaches Telegram at most once, and a
 * send without a confirmed outcome is never retried by the worker.
 */

const OWNER: FakeUser = { id: 5550001, firstName: "Fake Owner", phone: "85512345678" };
type H = ReturnType<typeof makeHarness<MemoryStore>>;

const client = (h: H, id: string) => h.telegram.clientFor(sessionDirectory(h.dataDir, id).database)!;
const sendRequests = (h: H) => h.telegram.clients.flatMap((c) => c.requests).filter((r) => r._ === "sendMessage").length;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectedWithShare(h: H, chatId = "5001") {
  const id = h.store.beginLogin("biz-1", "qr");
  await h.supervisor.tick();
  await waitFor(() => h.store.logins.get(id)?.qrLink != null);
  client(h, id).approveQr(OWNER);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  h.store.shareChat(id, chatId);
  await waitFor(() => client(h, id).requests.some((r) => r._ === "getChatHistory"));
  return id;
}

test("a confirmed send is stored once as an outgoing inbox message linked to the request", async () => {
  const h = makeHarness();
  try {
    const id = await connectedWithShare(h);
    const command = h.store.enqueueSend(id, "5001", "Hello from TENH", "req-1", "member-7");
    await waitFor(() => command.status === "done", 3000, "send done");
    assert.deepEqual(h.telegram.delivered, [{ chatId: 5001, text: "Hello from TENH" }]);
    const stored = h.store.messages.filter((m) => m.chatId === "5001" && m.direction === "outgoing");
    assert.equal(stored.length, 1, "the temporary message is never stored, only the final one");
    assert.equal(stored[0].body, "Hello from TENH");
    assert.equal(stored[0].clientRequestId, "req-1");
    assert.equal(stored[0].sentByMember, "member-7");
    assert.equal(stored[0].countUnread, false);
    assert.equal(command.messageId, stored[0].id);
    assert.ok(stored[0].messageId < 1_000_000, "stored under Telegram's final id, not the temporary one");
    assert.ok(!h.logs.join("\n").includes("Hello from TENH"), "message text never logged");
  } finally {
    await h.cleanup();
  }
});

test("Telegram refusing the send marks it failed and stores nothing", async () => {
  for (const outcome of ["fail", "reject"] as const) {
    const h = makeHarness();
    try {
      const id = await connectedWithShare(h);
      h.telegram.sendOutcome = outcome;
      const command = h.store.enqueueSend(id, "5001", "blocked");
      await waitFor(() => command.status === "failed", 3000, `${outcome} -> failed`);
      assert.match(String(command.errorCode), /^TELEGRAM_(403|400)$/);
      assert.equal(h.telegram.delivered.length, 0);
      assert.equal(h.store.messages.filter((m) => m.direction === "outgoing").length, 0);
      assert.equal(sendRequests(h), 1);
    } finally {
      await h.cleanup();
    }
  }
});

test("a send whose outcome never arrives is not retried, also not after a restart", async () => {
  const h = makeHarness();
  try {
    const id = await connectedWithShare(h);
    h.telegram.sendOutcome = "silent";
    const command = h.store.enqueueSend(id, "5001", "lost in transit");
    await waitFor(() => command.status === "sending" && command.tempMessageId !== undefined, 3000, "in flight");
    await sleep(200);
    assert.equal(sendRequests(h), 1);

    await h.supervisor.shutdown();
    const restarted = new Supervisor({ store: h.store, factory: h.telegram, config: h.config, log: () => undefined });
    try {
      await restarted.tick();
      await waitFor(() => h.store.rows.get(id)?.leaseOwner === h.config.workerId && h.telegram.clients.length >= 2, 3000, "reclaimed");
      await sleep(300);
      assert.equal(command.status, "sending", "left for the stale sweep, which marks it uncertain");
      assert.equal(sendRequests(h), 1, "never sent a second time");
      assert.ok(h.store.staleSweeps >= 1, "the stale sweep runs");
    } finally {
      await restarted.shutdown();
    }
  } finally {
    await h.cleanup();
  }
});

test("a send that times out locally becomes uncertain and is not retried", async () => {
  const h = makeHarness();
  try {
    const id = await connectedWithShare(h);
    h.telegram.invokeHangs.add("sendMessage");
    const command = h.store.enqueueSend(id, "5001", "maybe sent");
    await waitFor(() => command.status === "uncertain", 3000, "uncertain");
    assert.equal(command.errorCode, "TELEGRAM_TIMEOUT");
    h.telegram.invokeHangs.delete("sendMessage");
    h.supervisor.wake(id);
    await sleep(300);
    assert.equal(sendRequests(h), 1);
  } finally {
    await h.cleanup();
  }
});

test("an uncertain send that Telegram later confirms is resolved and stored", async () => {
  const h = makeHarness();
  try {
    const id = await connectedWithShare(h);
    h.telegram.sendOutcome = "silent";
    const command = h.store.enqueueSend(id, "5001", "late", "req-late", "member-1");
    await waitFor(() => command.tempMessageId !== undefined, 3000, "accepted");
    command.status = "uncertain"; // what tgp_send_mark_stale does after two minutes
    const final = FakeTelegram.textMessage(5001, 4242, "late", { outgoing: true });
    client(h, id).emit({ _: "updateMessageSendSucceeded", message: final, old_message_id: command.tempMessageId });
    await waitFor(() => command.status === "done", 3000, "resolved");
    const stored = h.store.messages.find((m) => m.messageId === 4242);
    assert.equal(stored?.clientRequestId, "req-late");
  } finally {
    await h.cleanup();
  }
});

test("sends to chats that are not shared are refused without calling Telegram", async () => {
  const h = makeHarness();
  try {
    const id = await connectedWithShare(h);
    const command = h.store.enqueueSend(id, "5002", "not shared");
    await waitFor(() => command.status === "failed", 3000, "refused");
    assert.equal(command.errorCode, "CHAT_NOT_SHARED");
    assert.equal(sendRequests(h), 0);
  } finally {
    await h.cleanup();
  }
});

test("sharing with history none imports nothing older than the share", async () => {
  const h = makeHarness();
  try {
    const old = Math.floor(Date.now() / 1000) - 3600;
    h.telegram.history.set(5001, [FakeTelegram.textMessage(5001, 300, "before sharing", { date: old })]);
    await connectedWithShare(h);
    await sleep(100);
    assert.equal(h.store.messages.filter((m) => m.chatId === "5001").length, 0);
  } finally {
    await h.cleanup();
  }
});
