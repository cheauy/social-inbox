import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { opusPacketSamples, webmToOggOpus } from "../src/webm-to-ogg.ts";

/* Fixtures were recorded with ffmpeg (libopus): one with sizes, one written live like a browser. */
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function oggPages(bytes: Uint8Array) {
  const pages: Array<{ granule: bigint; type: number; sequence: number }> = [];
  let at = 0;
  while (at < bytes.length) {
    assert.equal(new TextDecoder().decode(bytes.subarray(at, at + 4)), "OggS");
    const view = new DataView(bytes.buffer, bytes.byteOffset + at);
    const segments = bytes[at + 26];
    let body = 0;
    for (let i = 0; i < segments; i += 1) body += bytes[at + 27 + i];
    pages.push({ granule: view.getBigUint64(6, true), type: bytes[at + 5], sequence: view.getUint32(18, true) });
    at += 27 + segments + body;
  }
  return pages;
}

for (const [name, seconds] of [["voice-known-size.webm", 3], ["voice-live.webm", 2]] as const) {
  test(`webm -> ogg voice: ${name} becomes a valid Opus/OGG stream of the same length`, () => {
    const ogg = webmToOggOpus(fixture(name));
    const pages = oggPages(ogg);
    assert.equal(new TextDecoder().decode(ogg.subarray(28, 36)), "OpusHead");
    assert.equal(pages[0].type, 0x02, "first page starts the stream");
    assert.equal(pages[pages.length - 1].type, 0x04, "last page ends the stream");
    assert.deepEqual(pages.map((p) => p.sequence), pages.map((_, i) => i));
    const duration = Number(pages[pages.length - 1].granule) / 48000;
    assert.ok(Math.abs(duration - seconds) < 0.1, `duration ${duration}`);
  });
}

test("webm -> ogg refuses data that is not an Opus recording", () => {
  assert.throws(() => webmToOggOpus(new Uint8Array([1, 2, 3, 4])));
  assert.throws(() => webmToOggOpus(new TextEncoder().encode("not a recording at all")));
});

test("opus packet duration from the TOC byte", () => {
  assert.equal(opusPacketSamples(new Uint8Array([0b11111000])), 960); // CELT 20 ms, one frame
  assert.equal(opusPacketSamples(new Uint8Array([0b11111001])), 1920); // two frames
  assert.equal(opusPacketSamples(new Uint8Array([0b11111011, 3])), 2880); // three frames (code 3)
  assert.equal(opusPacketSamples(new Uint8Array([0b00011000])), 2880); // SILK 60 ms
});
