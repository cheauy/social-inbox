import { Directory, File, Paths } from "expo-file-system";

// Only opened media is persisted. Scope is account + workspace, never a token.
const FOLDER = "tenh-media-v2";
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const TTL = 7 * 24 * 60 * 60 * 1000;
const pending = new Map<string, Promise<string | null>>();
let generation = 0;
let retiredCacheRemoved = false;
let active = 0;
const waiting: (() => void)[] = [];
export function cacheNameFor(key: string) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < key.length; i++) {
    a = Math.imul(a ^ key.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ key.charCodeAt(i);
  }
  return `m${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
function prune(folder: Directory) {
  const files = folder.list().filter((item): item is File => item instanceof File && !item.name.endsWith(".json") && new File(`${item.uri}.json`).exists);
  files.sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0));
  let total = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  for (const file of files) {
    if (total <= MAX_BYTES && Date.now() - (file.modificationTime ?? 0) < TTL) continue;
    total -= file.size ?? 0;
    file.delete();
    const meta = new File(`${file.uri}.json`);
    if (meta.exists) meta.delete();
  }
}
export function clearMediaCache() {
  generation++;
  pending.clear();
  // Fixed cache directories only; never remove user documents.
  for (const name of [FOLDER, "tenh-media"]) {
    try { const folder = new Directory(Paths.cache, name); if (folder.exists) folder.delete(); } catch { /* OS may already have evicted it. */ }
  }
}
export function removeCachedMedia(key: string, scope?: string) {
  if (!scope) return;
  try {
    const folder = new Directory(Paths.cache, FOLDER);
    const file = new File(folder, cacheNameFor(JSON.stringify([scope, key])));
    const meta = new File(`${file.uri}.json`);
    if (file.exists) file.delete();
    if (meta.exists) meta.delete();
  } catch { /* The OS may already have evicted this entry. */ }
}
export function getCachedMedia(key: string, scope?: string): string | null {
  if (!scope) return null;
  try {
    const identity = JSON.stringify([scope, key]);
    const file = new File(new Directory(Paths.cache, FOLDER), cacheNameFor(identity));
    const meta = new File(`${file.uri}.json`);
    // Profile pictures can change at the same URL. Immutable attachments live longer.
    const ageLimit = /\/(facebook|telegram)-avatar|graph\.facebook\.com\/\d+\/picture/.test(key) ? 24 * 60 * 60 * 1000 : TTL;
    if (file.exists && meta.exists && file.size > 0 && Date.now() - (file.modificationTime ?? 0) < ageLimit && meta.textSync() === identity) return file.uri;
  } catch { /* Cache is optional, including when the OS evicts it. */ }
  return null;
}
export async function cacheMedia(uri: string, key: string, headers?: Record<string, string>, scope?: string, checkSize = false): Promise<string | null> {
  if (!/^https?:\/\//.test(uri)) return uri;
  if (!scope) return null;
  // Disk hits must not wait behind up to three slow network downloads.
  const cached = getCachedMedia(key, scope);
  if (cached) return cached;
  const identity = JSON.stringify([scope, key]);
  const existing = pending.get(identity);
  if (existing) return existing;
  const epoch = generation;
  const work = (async () => {
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    let partial: File | null = null;
    try {
      if (epoch !== generation) return null;
      if (!retiredCacheRemoved) {
        const retired = new Directory(Paths.cache, "tenh-media");
        if (retired.exists) retired.delete();
        retiredCacheRemoved = true;
      }
      const folder = new Directory(Paths.cache, FOLDER);
      if (!folder.exists) folder.create({ intermediates: true });
      const file = new File(folder, cacheNameFor(identity));
      const meta = new File(`${file.uri}.json`);
      const cached = getCachedMedia(key, scope);
      if (cached) return cached;
      if (checkSize) {
        // Stream large/unknown-size videos rather than downloading twice or
        // filling the phone. HEAD transfers no media body.
        const response = await fetch(uri, { method: "HEAD", headers, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(5000) });
        const size = Number(response.headers.get("content-length"));
        if (!response.ok || !size || size > MAX_FILE_BYTES) return null;
        if (epoch !== generation) return null;
      }
      if (file.exists) file.delete();
      if (meta.exists) meta.delete();
      prune(folder);
      partial = new File(folder, `${cacheNameFor(identity)}.${epoch}.part`);
      const saved = await File.downloadFileAsync(uri, partial, { ...(headers ? { headers } : {}), idempotent: true });
      if (epoch !== generation || saved.size === 0 || saved.size > MAX_FILE_BYTES) {
        if (saved.exists) saved.delete();
        return null;
      }
      saved.move(file);
      partial = null;
      meta.write(identity);
      prune(folder);
      return file.exists ? file.uri : null;
    } catch {
      try { if (partial?.exists) partial.delete(); } catch { /* Evicted by the OS. */ }
      return null;
    }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  })().finally(() => { if (pending.get(identity) === work) pending.delete(identity); });
  pending.set(identity, work);
  return work;
}
