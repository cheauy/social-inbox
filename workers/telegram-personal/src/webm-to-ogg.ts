/*
 * Browser voice recordings are Opus audio inside WebM. Telegram voice messages
 * must be Opus inside OGG. The audio itself is the same, so this only moves the
 * Opus packets from one container to the other: no re-encoding, no ffmpeg.
 * Throws on anything it does not understand; the caller then sends the
 * recording as an ordinary audio file instead.
 */

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  BlockGroup: 0xa0,
  Block: 0xa1,
  SimpleBlock: 0xa3,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
} as const;

const MASTERS = new Set<number>([ID.Segment, ID.Cluster, ID.BlockGroup, ID.Tracks, ID.TrackEntry]);

function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean) {
  const first = bytes[offset];
  if (first === undefined || first === 0) throw new Error("Invalid WebM data.");
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || offset + length > bytes.length) throw new Error("Invalid WebM data.");
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + bytes[offset + i];
    if (bytes[offset + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/** Opus packets of the (first) Opus track and its OpusHead, from a WebM file. */
export function extractOpusFromWebm(input: Uint8Array) {
  let offset = 0;
  let opusTrack: number | null = null;
  let currentTrack: { number: number | null; codec: string | null; priv: Uint8Array | null } | null = null;
  let head: Uint8Array | null = null;
  const packets: Uint8Array[] = [];
  const pendingBlocks: Array<{ track: number; data: Uint8Array }> = [];
  const finishTrack = () => {
    if (currentTrack?.codec === "A_OPUS" && currentTrack.number !== null && opusTrack === null) {
      opusTrack = currentTrack.number;
      head = currentTrack.priv;
    }
  };

  while (offset < input.length) {
    const id = readVint(input, offset, true);
    offset += id.length;
    const size = readVint(input, offset, false);
    offset += size.length;
    if (id.value === ID.TrackEntry) {
      finishTrack();
      currentTrack = { number: null, codec: null, priv: null };
    }
    if (MASTERS.has(id.value)) {
      if (id.value === ID.Cluster) finishTrack();
      continue; // descend: children follow directly in the stream
    }
    if (size.unknown) throw new Error("Unsupported WebM layout.");
    const end = offset + size.value;
    if (end > input.length) break; // truncated tail of a recording: keep what we have
    const body = input.subarray(offset, end);
    if (id.value === ID.TrackNumber && currentTrack) currentTrack.number = body.reduce((n, b) => n * 256 + b, 0);
    else if (id.value === ID.CodecID && currentTrack) currentTrack.codec = new TextDecoder().decode(body);
    else if (id.value === ID.CodecPrivate && currentTrack) currentTrack.priv = body.slice();
    else if (id.value === ID.SimpleBlock || id.value === ID.Block) {
      const track = readVint(body, 0, false);
      const flags = body[track.length + 2];
      if ((flags & 0x06) !== 0) throw new Error("Laced WebM blocks are not supported.");
      pendingBlocks.push({ track: track.value, data: body.slice(track.length + 3) });
    }
    offset = end;
  }
  finishTrack();
  if (opusTrack === null) throw new Error("No Opus audio in this recording.");
  for (const block of pendingBlocks) if (block.track === opusTrack && block.data.length) packets.push(block.data);
  if (!packets.length) throw new Error("The recording is empty.");
  return { head: head as Uint8Array | null, packets };
}

/** Samples (at 48 kHz) in one Opus packet, from its TOC byte (RFC 6716 3.1). */
export function opusPacketSamples(packet: Uint8Array) {
  const toc = packet[0];
  const config = toc >> 3;
  const frameSamples =
    config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1]
    : [120, 240, 480, 960][config & 3];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return frameSamples * frames;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let r = i << 24;
    for (let j = 0; j < 8; j += 1) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(data: Uint8Array) {
  let crc = 0;
  for (const byte of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc >>> 0;
}

function oggPage(serial: number, sequence: number, granule: bigint, headerType: number, packets: Uint8Array[]) {
  const lacing: number[] = [];
  for (const packet of packets) {
    let left = packet.length;
    while (left >= 255) { lacing.push(255); left -= 255; }
    lacing.push(left);
  }
  if (lacing.length > 255) throw new Error("Ogg page too large.");
  const bodyLength = packets.reduce((n, p) => n + p.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLength);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  page[4] = 0;
  page[5] = headerType;
  view.setBigUint64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let at = 27 + lacing.length;
  for (const packet of packets) { page.set(packet, at); at += packet.length; }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

function defaultOpusHead() {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1; // version
  head[9] = 1; // mono
  new DataView(head.buffer).setUint32(12, 48000, true);
  return head;
}

/** WebM/Opus recording -> Ogg/Opus voice note bytes. */
export function webmToOggOpus(input: Uint8Array): Uint8Array {
  const { head, packets } = extractOpusFromWebm(input);
  const opusHead = head && new TextDecoder().decode(head.subarray(0, 8)) === "OpusHead" ? head : defaultOpusHead();
  const preSkip = new DataView(opusHead.buffer, opusHead.byteOffset).getUint16(10, true);
  const vendor = new TextEncoder().encode("TENH");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(new TextEncoder().encode("OpusTags"), 0);
  new DataView(tags.buffer).setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  const serial = 0x54454e48; // "TENH"
  const pages: Uint8Array[] = [oggPage(serial, 0, 0n, 0x02, [opusHead]), oggPage(serial, 1, 0n, 0x00, [tags])];
  let granule = BigInt(preSkip);
  let sequence = 2;
  let batch: Uint8Array[] = [];
  let lacing = 0;
  const flush = (last: boolean) => {
    if (!batch.length) return;
    pages.push(oggPage(serial, sequence, granule, last ? 0x04 : 0x00, batch));
    sequence += 1;
    batch = [];
    lacing = 0;
  };
  for (const [index, packet] of packets.entries()) {
    const segments = Math.floor(packet.length / 255) + 1;
    if (lacing + segments > 255 || batch.length >= 50) flush(false);
    batch.push(packet);
    lacing += segments;
    granule += BigInt(opusPacketSamples(packet));
    if (index === packets.length - 1) flush(true);
  }
  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const page of pages) { out.set(page, at); at += page.length; }
  return out;
}
