const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");
const ts = require("typescript");

const { loader } = require("./tenh-seven/harness.cjs");

/*
 * Quick reply with images, video, voice and text.
 *
 * The functions under test are the real ones, pulled out of the component
 * source by name and run with their I/O stubbed: handleSendAttachments from
 * inbox-view, sendAttachments and loadSavedReplyAttachments from reply-box.
 * An event log records when each bubble appears and when each request
 * starts and settles, which is what "shown immediately", order, partial
 * failure and duplicates are about.
 */

function extract(file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = {};
  (function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found[node.name.text] = node.getText(source);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (names.includes(declaration.name.getText(source))) found[declaration.name.getText(source)] = node.getText(source);
      }
    }
    ts.forEachChild(node, visit);
  })(source);
  for (const name of names) assert.ok(found[name], `${name} not found in ${file}`);
  return names.map((name) => found[name]).join("\n");
}

function compile(code) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

// Telegram's documented caption limit; the component must agree (checked below).
const sendAttachmentsSource = `const TELEGRAM_CAPTION_LIMIT = 1024;
${compile(extract("components/inbox/inbox-view.tsx", ["handleSendAttachments"]))}`;

test("the component's Telegram caption limit is Telegram's 1024", () => {
  assert.match(fs.readFileSync("components/inbox/inbox-view.tsx", "utf8"), /const TELEGRAM_CAPTION_LIMIT = 1024;/);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function file(name, type, size = 1000) {
  const value = new File(["x".repeat(Math.min(size, 10))], name, { type });
  Object.defineProperty(value, "size", { value: size });
  return value;
}

/*
 * Run the real handleSendAttachments.
 *
 * `results` decides each media request's outcome by file name; a request
 * stays pending until `release()` so ordering can be observed mid-flight.
 */
function harness({ platform = "facebook", results = {}, hold = false } = {}) {
  const log = [];
  const bubbles = [];
  const releases = [];
  let sequence = 0;
  const settle = (result) => hold ? new Promise((resolve) => releases.push(() => resolve(result))) : Promise.resolve(result);

  const context = {
    console, URL: { createObjectURL: () => `blob:${++sequence}` }, crypto: { randomUUID: () => `id-${++sequence}` },
    Promise, setTimeout,
    captureComposerSubmissionOwner: () => ({ owner: true }),
    isComposerSubmissionCurrent: () => true,
    activeConversationRef: { current: { social_account: { platform } } },
    activeConversation: { id: "conversation-1", contact: { platform_user_id: "customer-1" } },
    editingTelegramMessageId: null,
    replyingToTelegramMessageId: null,
    replyingToFacebookMessageId: null,
    replyingToCommentId: null,
    resolveConversationPlatform: async () => platform,
    resolvePhotoReplyTarget: () => null,
    getMessageActions: () => ({ reply: true }),
    setSendError: (message) => log.push(["error", message]),
    prepareFacebookVoice: async (input) => input,
    isTelegramGifFile: (input) => /\.gif$/i.test(input.name),
    telegramOptimisticAttachmentKind: ({ requestedKind }) => requestedKind,
    getAttachmentMessageText: (kind) => `Sent ${kind}`,
    pendingAttachmentSendsRef: { current: {} },
    createOptimisticAttachmentMessage: ({ tempId, kind, messageText }) => ({ id: tempId, kind, message_text: messageText, raw_payload: {} }),
    createReplyContext: () => null,
    setLiveMessages: (update) => {
      const next = update([]);
      for (const bubble of next) {
        bubbles.push(bubble);
        log.push(["bubble", bubble.kind, bubble.message_text]);
      }
    },
    updateConversationPreviewOptimistically: () => {},
    setReplyingToFacebookMessageId: () => {},
    sendPersonalItems: async (items) => { log.push(["personal", items.map((item) => item.text ?? "")]); return true; },
    performOptimisticAttachmentSend: async (pending, caption) => {
      log.push(["send", pending.file.name, caption ?? null]);
      const ok = results[pending.file.name] !== false;
      const result = await settle(ok);
      log.push(["settled", pending.file.name, result]);
      return result;
    },
    performOptimisticAlbumSend: async (chunk, caption) => {
      const names = chunk.map((pending) => pending.file.name);
      log.push(["album", names, caption ?? null]);
      const ok = names.every((name) => results[name] !== false);
      const result = await settle(ok);
      log.push(["settled", names.join("+"), result]);
      return result;
    },
    handleSendMessage: async (_event, text, options) => {
      // The real handleSendMessage shows its bubble, then waits on startAfter.
      log.push(["bubble", "text", text]);
      if (options?.startAfter) await options.startAfter;
      log.push(["send", "text", text, options?.withoutReply === true]);
    },
  };
  vm.createContext(context);
  vm.runInContext(`${sendAttachmentsSource}; globalThis.run = handleSendAttachments;`, context);

  return {
    log,
    bubbles,
    release: async () => { while (releases.length) { releases.shift()(); await tick(); } },
    send: (attachments, text, options) => context.run(attachments, text, options),
  };
}

const image = (name) => ({ id: name, kind: "image", file: file(name, "image/jpeg"), previewUrl: `blob:${name}` });
const video = (name) => ({ id: name, kind: "video", file: file(name, "video/mp4"), previewUrl: `blob:${name}` });
const voice = (name) => ({ id: name, kind: "audio", file: file(name, "audio/mpeg"), previewUrl: `blob:${name}` });

/* ---------------------------------------------- 1. everything shown immediately */

test("Messenger: every image, the voice clip and the text show as Sending before any upload settles", async () => {
  const run = harness({ platform: "facebook", hold: true });
  let queued = 0;

  const done = run.send([image("a.jpg"), image("b.jpg"), voice("voice-message-1.mp3")], "Price list attached", { onQueued: () => queued++ });
  await tick(); await tick();

  const shown = run.log.filter((entry) => entry[0] === "bubble").map((entry) => entry[1]);
  // Messenger sends the two photos as one album; that one bubble shows both.
  assert.equal(JSON.stringify(shown), JSON.stringify(["image", "audio", "text"]), "every item on screen, in order");
  const album = run.bubbles.find((bubble) => bubble.kind === "image");
  assert.equal(album.raw_payload.message.attachments.length, 2, "both photos in the album bubble");
  assert.equal(queued, 1, "the composer is told exactly once that everything is queued");
  assert.equal(run.log.some((entry) => entry[0] === "settled"), false, "nothing has finished uploading yet");

  await run.release();
  await done;
});

test("the text request starts only after the media settle, so delivery order matches the screen", async () => {
  const run = harness({ platform: "facebook", hold: true });
  const done = run.send([image("a.jpg"), voice("voice-message-1.mp3")], "Hello");
  await tick(); await tick();
  assert.equal(run.log.some((entry) => entry[0] === "send" && entry[1] === "text"), false);

  await run.release();
  await done;

  const order = run.log.filter((entry) => entry[0] === "send" || entry[0] === "album").map((entry) => entry[1]);
  assert.deepEqual(order.slice(-1), ["text"], "text goes last");
});

/* ---------------------------------------------- 1. partial failure, per item */

test("partial failure: the failed image does not stop the next item or the text", async () => {
  const run = harness({ platform: "facebook", results: { "a.jpg": false } });

  const allSucceeded = await run.send([image("a.jpg"), voice("voice-message-1.mp3")], "Follow-up");

  assert.equal(allSucceeded, false, "the overall result reports the failure");
  const settled = Object.fromEntries(run.log.filter((entry) => entry[0] === "settled").map((entry) => [entry[1], entry[2]]));
  assert.equal(settled["voice-message-1.mp3"], true, "the voice clip still went");
  assert.ok(run.log.some((entry) => entry[0] === "send" && entry[1] === "text"), "the text still went");
});

test("no duplicates: one request per item and one bubble per item", async () => {
  const run = harness({ platform: "facebook" });
  await run.send([image("a.jpg"), image("b.jpg"), voice("voice-message-1.mp3")], "Once");

  const bubbles = run.log.filter((entry) => entry[0] === "bubble");
  assert.equal(bubbles.length, 3, "album, voice, text");
  const mediaRequests = run.log.filter((entry) => entry[0] === "send" && entry[1] !== "text");
  assert.equal(mediaRequests.length, 2, "one album request, one voice request");
  const textSends = run.log.filter((entry) => entry[0] === "send" && entry[1] === "text");
  assert.equal(textSends.length, 1);
});

test("a Facebook Reply quote stays on the media and is not repeated on the follow-up text", async () => {
  const run = harness({ platform: "facebook" });
  await run.send([image("a.jpg")], "With quote");
  const textSend = run.log.find((entry) => entry[0] === "send" && entry[1] === "text");
  assert.equal(textSend[3], true, "withoutReply");
});

/* ---------------------------------------------- 2. Telegram keeps the text */

test("Telegram, one image + text: the text rides as the photo's caption (it used to be dropped)", async () => {
  const run = harness({ platform: "telegram" });
  await run.send([image("a.jpg")], "Only 5 left");

  const photo = run.log.find((entry) => entry[0] === "send" && entry[1] === "a.jpg");
  assert.equal(photo[2], "Only 5 left");
  assert.equal(run.log.some((entry) => entry[0] === "send" && entry[1] === "text"), false, "not sent twice");
  const bubble = run.log.find((entry) => entry[0] === "bubble" && entry[1] === "image");
  assert.equal(bubble[2], "Only 5 left", "the bubble shows the caption from the start");
});

test("Telegram, several images + text: caption on the album, once", async () => {
  const run = harness({ platform: "telegram" });
  await run.send([image("a.jpg"), image("b.jpg"), image("c.jpg")], "New stock");

  const album = run.log.find((entry) => entry[0] === "album");
  assert.equal(album[2], "New stock");
  assert.equal(run.log.filter((entry) => entry[0] === "bubble" && entry[2] === "New stock").length, 1);
});

test("Telegram, text over the 1024-character caption limit: media first, then the full text as its own message", async () => {
  const run = harness({ platform: "telegram" });
  const long = "ក".repeat(1100);
  await run.send([image("a.jpg")], long);

  const photo = run.log.find((entry) => entry[0] === "send" && entry[1] === "a.jpg");
  assert.equal(photo[2], null, "no truncated caption");
  const textSend = run.log.find((entry) => entry[0] === "send" && entry[1] === "text");
  assert.equal(textSend[2].length, 1100, "nothing cut");
});

test("Telegram, text exactly at the 1024 limit still goes as the caption", async () => {
  const run = harness({ platform: "telegram" });
  const exact = "a".repeat(1024);
  await run.send([image("a.jpg")], exact);
  assert.equal(run.log.find((entry) => entry[0] === "send" && entry[1] === "a.jpg")[2], exact);
});

test("Telegram, voice clip + text: a voice note takes no caption here, so the text follows as its own message", async () => {
  const run = harness({ platform: "telegram" });
  await run.send([voice("voice-message-1.mp3")], "Listen to this");

  assert.equal(run.log.find((entry) => entry[0] === "send" && entry[1] === "voice-message-1.mp3")[2], null);
  assert.ok(run.log.some((entry) => entry[0] === "send" && entry[1] === "text" && entry[2] === "Listen to this"));
});

test("Telegram, MP4 video + text: caption on the video", async () => {
  const run = harness({ platform: "telegram" });
  await run.send([video("clip.mp4")], "How to use");
  assert.equal(run.log.find((entry) => entry[0] === "send" && entry[1] === "clip.mp4")[2], "How to use");
});

test("Telegram Personal: long text is not cut into the caption, it follows as its own item", async () => {
  const run = harness({ platform: "telegram_personal" });
  run.send.bind(null);
  const context = run;
  // The personal path branches on activeConversationRef, set by platform above.
  await context.send([image("a.jpg")], "b".repeat(1500));
  const personal = run.log.find((entry) => entry[0] === "personal");
  assert.equal(JSON.stringify(personal[1]), JSON.stringify(["", "b".repeat(1500)]));
});

/* ---------------------------------------------- reply-box: composer ownership */

const replyBoxSource = compile(extract("components/inbox/reply-box.tsx", ["sendAttachments"]));

function composer(onSendAttachments) {
  const state = { attachments: [], reply: "", alerts: [], status: [] };
  const context = {
    console,
    URL: { revokeObjectURL: () => {} },
    window: { alert: (message) => state.alerts.push(message) },
    isComposerDisabled: false,
    attachments: [{ id: "a", kind: "image", previewUrl: "blob:a" }],
    reply: "Hello",
    onSendAttachments,
    setSendingContent: () => {},
    setAttachments: (value) => { state.attachments = value; },
    onReplyChange: (value) => { state.reply = value; },
    pendingPostSendStatusRef: { current: null },
    onStatusChange: (value) => state.status.push(value),
    setSendMode: () => {},
  };
  vm.createContext(context);
  vm.runInContext(`${replyBoxSource}; globalThis.run = sendAttachments;`, context);
  return { state, run: (status) => context.run(status) };
}

test("composer: once items are queued, a partial failure does not refill the composer (no second copy)", async () => {
  const box = composer(async (_attachments, _text, options) => { options.onQueued(); return false; });
  await box.run(null);
  assert.equal(box.state.attachments.length, 0);
  assert.equal(box.state.reply, "");
});

test("composer: refused before anything was queued, the draft comes back intact", async () => {
  const box = composer(async () => false);
  await box.run(null);
  assert.equal(box.state.attachments.length, 1);
  assert.equal(box.state.reply, "Hello");
});

test("composer: the typed text is handed to the parent, not sent a second time by the composer", async () => {
  const calls = [];
  const box = composer(async (attachments, text, options) => { calls.push(text); options.onQueued(); return true; });
  await box.run("closed");
  assert.deepEqual(calls, ["Hello"]);
  assert.deepEqual(box.state.status, ["closed"], "Send & close still applies");
});

/* ---------------------------------------------- 3. voice quick replies */

const loadSource = compile(extract("components/inbox/reply-box.tsx", ["loadSavedReplyAttachments"]));

test("a saved voice clip is loaded as a voice message, keeping its format", async () => {
  const added = [];
  const context = {
    console, File, Blob, Response, Promise,
    URL: { createObjectURL: () => "blob:voice" },
    composerReady: true,
    composerMountedRef: { current: true },
    setLoadingQuickReplyMedia: () => {},
    setAttachments: (update) => added.push(...update([])),
    createId: () => "attachment",
    fetch: async () => new Response(new Blob(["mp3"], { type: "audio/mpeg" })),
    window: { alert: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(`${loadSource}; globalThis.run = loadSavedReplyAttachments;`, context);
  await context.run([{ url: "https://fixture.invalid/v.mp3", path: "p", name: "Greeting.mp3", mimeType: "audio/mpeg", kind: "audio" }]);

  assert.equal(added.length, 1);
  assert.equal(added[0].kind, "audio");
  assert.match(added[0].file.name, /^voice-message-\d+\.mp3$/);
  assert.equal(added[0].file.type, "audio/mpeg");
});

test("Telegram's optimistic bubble treats a quick-reply voice clip as audio, not a file", () => {
  const { telegramOptimisticAttachmentKind } = loader({}, { File })("lib/telegram/telegram-optimistic-media.ts");
  assert.equal(telegramOptimisticAttachmentKind({ file: new File(["x"], "voice-message-1.mp3", { type: "audio/mpeg" }), requestedKind: "audio" }), "audio");
  assert.equal(telegramOptimisticAttachmentKind({ file: new File(["x"], "voice-message-1.m4a", { type: "audio/mp4" }), requestedKind: "audio" }), "audio");
});

/* ---------------------------------------------- 3. saving voice quick replies */

const attachments = loader({ "@/lib/supabase/admin": { supabaseAdmin: {} } })("lib/settings/saved-reply-attachments.ts");
const BUSINESS = "11111111-1111-4111-8111-111111111111";
const stored = (kind, extra = {}) => ({ path: `saved-replies/${BUSINESS}/${kind}-${Math.random()}`, kind, name: kind, size: 1, mimeType: "x", ...extra });

test("saving: MP3, M4A and OGG/Opus are accepted as voice; WAV and WebM are refused with a clear reason", () => {
  for (const type of ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg", "audio/opus"]) {
    assert.equal(attachments.attachmentKindFor(type), "audio", type);
  }
  for (const type of ["audio/wav", "audio/webm", "audio/x-wav"]) {
    assert.equal(attachments.attachmentKindFor(type), null, type);
  }
  assert.match(attachments.SAVED_REPLY_AUDIO_UNSUPPORTED, /MP3, M4A or OGG\/Opus/);
});

test("saving: a file with no reported type is recognized by its audio extension only", () => {
  assert.equal(attachments.savedReplyMimeType({ type: "", name: "clip.m4a" }), "audio/mp4");
  assert.equal(attachments.savedReplyMimeType({ type: "", name: "clip.opus" }), "audio/ogg");
  assert.equal(attachments.savedReplyMimeType({ type: "", name: "photo.png" }), "");
  assert.equal(attachments.savedReplyMimeType({ type: "audio/mpeg; codecs=mp3", name: "x" }), "audio/mpeg");
});

test("saving: one voice clip, alongside text and images, never with a video", () => {
  assert.equal(attachments.validateAttachments([stored("audio"), stored("image"), stored("image")], BUSINESS), null);
  assert.match(attachments.validateAttachments([stored("audio"), stored("audio")], BUSINESS), /one voice message/);
  assert.match(attachments.validateAttachments([stored("audio"), stored("video")], BUSINESS), /voice message or a video/);
});

test("reading: stored voice clips survive parsing with a sensible default type", () => {
  const parsed = attachments.parseAttachments([{ path: "p", kind: "audio", name: "v.mp3" }, { path: "q", kind: "bogus" }]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].kind, "audio");
  assert.equal(parsed[0].mimeType, "audio/mpeg");
});
