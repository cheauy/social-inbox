import { Directory, File, Paths } from "expo-file-system";
import { fetch as fetchTile } from "expo/fetch";

export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? OSM_TILE_URL;
export const MAP_USER_AGENT = "TENHCHAT/1.0 (+https://app.tenhchat.com)";
export const MAP_TILE_TTL = 7 * 24 * 60 * 60 * 1000;
export const MAX_MAP_TILE_BYTES = 256 * 1024;
export const MAX_MAP_CACHE_BYTES = 32 * 1024 * 1024;
export const MAX_MAP_CACHE_ENTRIES = 1024;
const MAX_META_BYTES = 8 * 1024;
const RESERVATION_BYTES = MAX_MAP_TILE_BYTES + MAX_META_BYTES;
const FOLDER = "tenh-map-tiles-v1";
let sequence = 0;
const activeParts = new Set<string>();
let reservedBytes = 0;

function entry(url: string) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < url.length; i++) {
    a = Math.imul(a ^ url.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ url.charCodeAt(i);
  }
  const folder = new Directory(Paths.cache, FOLDER);
  const file = new File(folder, `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}.png`);
  return { folder, file, meta: new File(`${file.uri}.json`) };
}

export function cachedMapTile(url: string): string | null {
  try {
    const { file, meta } = entry(url);
    // This disk cache uses OSM's minimum seven-day retention strategy.
    if (file.exists && file.size > 0 && file.size <= MAX_MAP_TILE_BYTES && meta.exists && meta.size <= MAX_META_BYTES &&
        meta.textSync() === url && Date.now() - (file.modificationTime ?? 0) < MAP_TILE_TTL) return file.uri;
  } catch { /* The OS may have evicted the cache. */ }
  return null;
}

// This folder contains only map cache files. Keep valid fresh pairs, remove
// expired entries and incomplete/orphaned files, and count all retained bytes.
export function pruneMapTileCache(): { bytes: number; entries: number } {
  const folder = new Directory(Paths.cache, FOLDER);
  if (!folder.exists) return { bytes: 0, entries: 0 };
  const items = folder.list();
  for (const item of items) {
    if (!item.exists || activeParts.has(item.uri)) continue;
    if (!(item instanceof File)) { item.delete(); continue; }
    if (item.name.endsWith(".png")) {
      const meta = new File(`${item.uri}.json`);
      if (!meta.exists || meta.size > MAX_META_BYTES ||
          Date.now() - (item.modificationTime ?? 0) >= MAP_TILE_TTL) {
        item.delete(); if (meta.exists) meta.delete();
      }
    } else if (item.name.endsWith(".png.json")) {
      if (!new File(item.uri.slice(0, -5)).exists) item.delete();
    } else {
      // Stale .part files from a crash have no active reservation.
      item.delete();
    }
  }
  let bytes = 0, entries = 0;
  for (const item of folder.list()) {
    if (activeParts.has(item.uri)) continue; // covered by the reservation
    bytes += item.size ?? 0;
    if (item instanceof File && item.name.endsWith(".png")) entries++;
  }
  return { bytes, entries };
}

export function discardInvalidMapTile(url: string, uri: string) {
  try {
    const { file, meta } = entry(url);
    if (file.uri === uri && meta.exists && meta.size <= MAX_META_BYTES && meta.textSync() === url) {
      if (file.exists) file.delete();
      meta.delete();
    }
  } catch { /* The OS may already have removed the unreadable file. */ }
}

// Called only by the visible picker, never a background/preload/offline job.
export async function loadMapTile(url: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error("Map view closed");
  const parsed = new URL(url);
  if (url.length > 2048 || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid map tile URL");
  const hit = cachedMapTile(url);
  if (hit) return hit;
  const { folder, file, meta } = entry(url);
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  const retained = pruneMapTileCache();
  // Never replace a fresh oversized legacy entry or a hash collision merely
  // to fetch it again. Existing fresh tiles remain until their TTL expires.
  if (file.exists && meta.exists) throw new Error("Cached map tile unavailable");
  if (activeParts.size >= 3 || retained.entries + activeParts.size >= MAX_MAP_CACHE_ENTRIES ||
      retained.bytes + reservedBytes + RESERVATION_BYTES > MAX_MAP_CACHE_BYTES) throw new Error("Map cache is full");
  const partial = new File(folder, `${file.name}.${++sequence}.part`);
  const partialURI = partial.uri;
  activeParts.add(partialURI);
  reservedBytes += RESERVATION_BYTES;
  const download = new AbortController();
  const abort = () => download.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  let committed = false;
  let handle: ReturnType<File["open"]> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await fetchTile(url, {
      headers: { "User-Agent": MAP_USER_AGENT },
      signal: download.signal,
      credentials: "omit",
      redirect: "error",
    });
    const declared = Number(response.headers.get("content-length"));
    if (!response.ok || !response.body || declared > MAX_MAP_TILE_BYTES) throw new Error("Map tile unavailable");
    reader = response.body.getReader();
    partial.create();
    handle = partial.open();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted || download.signal.aborted) throw new Error("Map view closed");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_MAP_TILE_BYTES) throw new Error("Map tile too large");
      handle.writeBytes(value);
    }
    if (!bytes) throw new Error("Map tile unavailable");
    handle.close(); handle = null;
    partial.move(file);
    committed = true;
    meta.write(url);
    return file.uri;
  } finally {
    // Also cancels a rejected response with a huge advertised body, without
    // consuming it. Network chunks already in flight are platform-dependent.
    download.abort();
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    try { handle?.close(); } catch { /* Native handle already closed. */ }
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    activeParts.delete(partialURI);
    reservedBytes -= RESERVATION_BYTES;
    try { if (!committed && partial.exists) partial.delete(); } catch { /* OS eviction. */ }
  }
}
