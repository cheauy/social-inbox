const test = require("node:test");
const assert = require("node:assert/strict");

const { loader } = require("./tenh-seven/harness.cjs");

const { telegramOptimisticAttachmentKind } = loader({}, { File })(
  "lib/telegram/telegram-optimistic-media.ts",
);

const kindFor = (name, type, requestedKind = "audio") =>
  telegramOptimisticAttachmentKind({
    file: new File(["fixture"], name, { type }),
    requestedKind,
  });

test("imported Telegram WAV is optimistic file just like its confirmed document", () => {
  assert.equal(kindFor("sample.wav", "audio/wav"), "file");
});

test("Telegram recorder voice and supported audio remain optimistic audio", () => {
  assert.equal(kindFor("voice-message-1.ogg", "audio/ogg"), "audio");
  assert.equal(kindFor("song.mp3", "audio/mpeg"), "audio");
  assert.equal(kindFor("song.m4a", "audio/mp4"), "audio");
});

test("non-audio attachment kinds are unchanged", () => {
  assert.equal(kindFor("clip.mp4", "video/mp4", "video"), "video");
  assert.equal(kindFor("photo.png", "image/png", "image"), "image");
  assert.equal(kindFor("invoice.pdf", "application/pdf", "file"), "file");
});
