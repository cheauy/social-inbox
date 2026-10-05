import assert from "node:assert/strict";
import test from "node:test";
import { sessionDirectory } from "../src/local-data.ts";
import { MESSAGE_MEDIA_BUCKET, CONTACT_AVATAR_BUCKET } from "../src/media-storage.ts";
import { mapMessage } from "../src/chats.ts";
import { FakeTelegram, type FakeUser } from "./helpers/fake-telegram.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";
import type { MemoryStore } from "./helpers/memory-store.ts";

/* Real media, profile photos, edits, deletions, replies and sending files. */

const OWNER: FakeUser = { id: 5550001, firstName: "Fake Owner", phone: "85512345678" };
type H = ReturnType<typeof makeHarness<MemoryStore>>;
const client = (h: H, id: string) => h.telegram.clientFor(sessionDirectory(h.dataDir, id).database)!;
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

async function sharedChat(h: H, chatId = "5001") {
  const id = h.store.beginLogin("biz-1", "qr");
  await h.supervisor.tick();
  await waitFor(() => h.store.logins.get(id)?.qrLink != null);
  client(h, id).approveQr(OWNER);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  h.store.shareChat(id, chatId);
  await waitFor(() => client(h, id).requests.some((r) => r._ === "getChatHistory"));
  return id;
}

test("mapMessage: picks the largest photo, document details and same-chat reply target", () => {
  const photo = mapMessage({ ...FakeTelegram.photoMessage(5001, 7, 900, 1234, "nice"), reply_to: { _: "messageReplyToMessage", chat_id: 5001, message_id: 3 } });
  assert.equal(photo?.media?.fileId, 900);
  assert.equal(photo?.media?.messageType, "image");
  assert.equal(photo?.media?.pathKind, "photo");
  assert.equal(photo?.body, "nice");
  assert.equal(photo?.replyTo, 3);
  const doc = mapMessage(FakeTelegram.documentMessage(5001, 8, 901, 50, "invoice.pdf"));
  assert.deepEqual([doc?.media?.name, doc?.media?.mimeType, doc?.media?.messageType], ["invoice.pdf", "application/pdf", "file"]);
  const otherChatReply = mapMessage({ ...FakeTelegram.textMessage(5001, 9, "x"), reply_to: { _: "messageReplyToMessage", chat_id: 42, message_id: 3 } });
  assert.equal(otherChatReply?.replyTo, undefined);
  const animated = mapMessage({ _: "message", id: 10, chat_id: 5001, date: now(), content: { _: "messageSticker", sticker: { format: { _: "stickerFormatTgs" }, sticker: { id: 5, size: 9 } } } });
  assert.equal(animated?.media, undefined, "animated stickers stay placeholders");
});

test("a received photo is copied to TENH storage and the message shows it; the Telegram copy is freed", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    const fileId = h.telegram.addFile(bytes(2000));
    client(h, id).receive(FakeTelegram.photoMessage(5001, 60, fileId, 2000, "look at this"));
    await waitFor(() => h.store.messages.some((m) => m.messageId === 60 && m.savedType === "image"), 3000, "media saved");
    const m = h.store.messages.find((x) => x.messageId === 60)!;
    const object = h.media.objects.get(`${MESSAGE_MEDIA_BUCKET}/biz-1/${m.id}/photo`);
    assert.equal(object?.bytes.byteLength, 2000);
    assert.equal(object?.contentType, "image/jpeg");
    assert.equal(m.body, "look at this");
    assert.equal(m.attachment?.size, 2000);
    assert.ok(h.telegram.deletedFiles.includes(fileId));
  } finally {
    await h.cleanup();
  }
});

test("files over the size limit stay placeholders; a storage failure never loses the message", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    const big = h.telegram.addFile(bytes(2 * 1024 * 1024));
    client(h, id).receive(FakeTelegram.documentMessage(5001, 61, big, 2 * 1024 * 1024, "huge.pdf"));
    h.media.failUploads = true;
    const small = h.telegram.addFile(bytes(100));
    client(h, id).receive(FakeTelegram.documentMessage(5001, 62, small, 100, "small.pdf"));
    await waitFor(() => h.store.messages.filter((m) => m.messageId === 61 || m.messageId === 62).length === 2, 3000, "both stored");
    await sleep(200);
    assert.ok(h.store.messages.every((m) => !m.savedType), "both remain placeholders");
    assert.equal([...h.media.objects.keys()].filter((k) => k.startsWith(MESSAGE_MEDIA_BUCKET)).length, 0);
  } finally {
    await h.cleanup();
  }
});

test("the contact gets the Telegram profile photo once its chat has a message", async () => {
  const h = makeHarness();
  try {
    h.telegram.chats.get(5001)!.photoFileId = h.telegram.addFile(bytes(300, 9));
    const id = await sharedChat(h);
    client(h, id).receive(FakeTelegram.textMessage(5001, 70, "hello", { date: now() }));
    await waitFor(() => h.store.contactPhotos.get("5001") === true, 3000, "photo set");
    assert.equal(h.media.objects.get(`${CONTACT_AVATAR_BUCKET}/biz-1/contact-5001/telegram-avatar`)?.bytes.byteLength, 300);
  } finally {
    await h.cleanup();
  }
});

test("edits and deletions for everyone in Telegram are reflected; cache drops are ignored", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    const tg = client(h, id);
    tg.receive(FakeTelegram.textMessage(5001, 80, "original", { date: now() }));
    tg.receive(FakeTelegram.textMessage(5001, 81, "to delete", { date: now() }));
    await waitFor(() => h.store.messages.filter((m) => m.chatId === "5001").length === 2, 3000, "stored");
    tg.emit({ _: "updateMessageContent", chat_id: 5001, message_id: 80, new_content: { _: "messageText", text: { _: "formattedText", text: "edited text" } } });
    tg.emit({ _: "updateDeleteMessages", chat_id: 5001, message_ids: [81], is_permanent: false, from_cache: true });
    await sleep(100);
    assert.ok(!h.store.messages.find((m) => m.messageId === 81)?.deleted, "cache drop ignored");
    tg.emit({ _: "updateDeleteMessages", chat_id: 5001, message_ids: [81], is_permanent: true, from_cache: false });
    await waitFor(() => h.store.messages.find((m) => m.messageId === 81)?.deleted === true, 3000, "deleted");
    assert.equal(h.store.messages.find((m) => m.messageId === 80)?.body, "edited text");
    assert.ok(!h.logs.join("\n").includes("edited text"));
  } finally {
    await h.cleanup();
  }
});

test("an incoming reply records which message it quotes", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    client(h, id).receive({ ...FakeTelegram.textMessage(5001, 91, "answer", { date: now() }), reply_to: { _: "messageReplyToMessage", chat_id: 5001, message_id: 90 } });
    await waitFor(() => h.store.messages.find((m) => m.messageId === 91)?.quoted === 90, 3000, "quoted");
  } finally {
    await h.cleanup();
  }
});

test("sending a photo with a caption and a quote: fetched from storage, sent once, stored, staging removed", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    const staging = "biz-1/tgp-outbox/req-photo/cat.jpg";
    await h.media.upload(MESSAGE_MEDIA_BUCKET, staging, bytes(1500, 3), "image/jpeg");
    const command = h.store.enqueueSend(id, "5001", "my cat", "req-photo");
    command.kind = "send_media";
    command.payload = { ...command.payload, reply_to_message_id: 40, media: { kind: "photo", storage_path: staging, size: 1500, mime_type: "image/jpeg", name: "cat.jpg" } };
    await waitFor(() => command.status === "done", 3000, "sent").catch((e) => { throw new Error(`${e.message}: ${command.status} ${command.errorCode} ${h.logs.slice(-5).join(" | ")}`); });
    assert.equal(h.telegram.delivered.length, 1);
    assert.deepEqual(h.telegram.delivered[0], { chatId: 5001, text: "my cat", kind: "inputMessagePhoto", bytes: 1500, replyTo: 40 });
    const stored = h.store.messages.find((m) => m.direction === "outgoing" && m.chatId === "5001");
    assert.equal(stored?.clientRequestId, "req-photo");
    assert.equal(stored?.quoted, 40);
    await waitFor(() => h.store.messages.some((m) => m.direction === "outgoing" && m.savedType === "image"), 3000, "outgoing media saved");
    assert.ok(!h.media.objects.has(`${MESSAGE_MEDIA_BUCKET}/${staging}`), "staging copy removed");
    const outbox = sessionDirectory(h.dataDir, id).dir + "/outbox";
    const { readdirSync, existsSync } = await import("node:fs");
    assert.deepEqual(existsSync(outbox) ? readdirSync(outbox) : [], [], "local copy removed");
  } finally {
    await h.cleanup();
  }
});

test("a file that cannot be fetched from storage fails before anything is sent", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    const command = h.store.enqueueSend(id, "5001", "", "req-missing");
    command.kind = "send_media";
    command.payload = { ...command.payload, media: { kind: "document", storage_path: "biz-1/tgp-outbox/req-missing/a.pdf", size: 10, mime_type: "application/pdf", name: "a.pdf" } };
    await waitFor(() => command.status === "failed", 3000, "failed");
    assert.equal(command.errorCode, "MEDIA_DOWNLOAD_FAILED");
    assert.equal(h.telegram.delivered.length, 0);
    assert.equal(client(h, id).requests.filter((r) => r._ === "sendMessage").length, 0);
  } finally {
    await h.cleanup();
  }
});

test("a file outside this workspace outbox is refused", async () => {
  const h = makeHarness();
  try {
    const id = await sharedChat(h);
    await h.media.upload(MESSAGE_MEDIA_BUCKET, "other-biz/tgp-outbox/x/a.pdf", bytes(10), "application/pdf");
    const command = h.store.enqueueSend(id, "5001", "", "req-foreign");
    command.kind = "send_media";
    command.payload = { ...command.payload, media: { kind: "document", storage_path: "other-biz/tgp-outbox/x/a.pdf", size: 10, mime_type: "application/pdf", name: "a.pdf" } };
    await waitFor(() => command.status === "failed", 3000, "failed");
    assert.equal(command.errorCode, "INVALID_MEDIA");
    assert.equal(h.telegram.delivered.length, 0);
  } finally {
    await h.cleanup();
  }
});
