import test from "node:test";
import assert from "node:assert/strict";
import { facebookMediaMessage } from "./media-message.ts";
import { prepareFacebookVoice } from "./prepare-voice.ts";

test("multiple photos form one ordered Messenger message", () => {
  assert.deepEqual(facebookMediaMessage("image", ["photo1", "photo2"]), {
    attachments: [
      { type: "image", payload: { attachment_id: "photo1" } },
      { type: "image", payload: { attachment_id: "photo2" } },
    ],
  });
});
for (const kind of ["image", "audio", "video", "file"]) {
  test(`single ${kind} keeps the existing request format`, () => {
    assert.deepEqual(facebookMediaMessage(kind, ["id"]), {
      attachment: { type: kind, payload: { attachment_id: "id" } },
    });
  });
}
test("album limits reject empty, oversized and non-photo batches", () => {
  assert.throws(() => facebookMediaMessage("image", []));
  assert.throws(() => facebookMediaMessage("image", Array(31).fill("id")));
  for (const kind of ["audio", "video", "file"]) {
    assert.throws(() => facebookMediaMessage(kind, ["a", "b"]));
  }
  assert.equal(facebookMediaMessage("image", Array(30).fill("id")).attachments.length, 30);
});
test("supported audio files are preserved without decoding", async () => {
  const file = new File(["audio"], "voice.m4a", { type: "audio/mp4" });
  assert.equal(await prepareFacebookVoice(file), file);
});
test("Opus recording becomes real mono PCM WAV with a closed context", async () => {
  let closed = false;
  const original = globalThis.AudioContext;
  globalThis.AudioContext = class {
    async decodeAudioData() {
      return { length: 3, sampleRate: 48000, numberOfChannels: 1,
        getChannelData: () => new Float32Array([-1, 0, 1]) };
    }
    async close() { closed = true; }
  };
  try {
    const file = await prepareFacebookVoice(new File(["opus"], "voice.webm", { type: "audio/webm;codecs=opus" }));
    const data = await file.arrayBuffer();
    const view = new DataView(data);
    assert.equal(file.type, "audio/wav");
    assert.equal(file.name, "voice.wav");
    assert.equal(new TextDecoder().decode(data.slice(0, 4)), "RIFF");
    assert.equal(new TextDecoder().decode(data.slice(8, 12)), "WAVE");
    assert.equal(view.getUint32(24, true), 48000);
    assert.equal(view.getUint32(40, true), 6);
    assert.equal(view.getInt16(44, true), -32768);
    assert.equal(view.getInt16(48, true), 32767);
    assert.equal(closed, true);
  } finally { globalThis.AudioContext = original; }
});
test("decode failure closes context and rejects instead of sending corrupt audio", async () => {
  let closed = false;
  const original = globalThis.AudioContext;
  globalThis.AudioContext = class {
    async decodeAudioData() { throw new Error("Invalid recording"); }
    async close() { closed = true; }
  };
  try {
    await assert.rejects(prepareFacebookVoice(new File(["bad"], "voice.webm", { type: "audio/webm" })));
    assert.equal(closed, true);
  } finally { globalThis.AudioContext = original; }
});
