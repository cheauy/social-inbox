import type { MetaStickerChoice, MetaStickerPack } from "./catalog";

const PREFIX = "tenh:messenger-sticker-catalog:v1:";
const FRESH_MS = 6 * 60 * 60_000;
const SEARCH_FRESH_MS = 5 * 60_000;
const KEEP_MS = 7 * 24 * 60 * 60_000;
const MAX_ENTRIES = 256;
const MAX_STORAGE_CHARS = 1_000_000;
type Value = MetaStickerPack[] | MetaStickerChoice[] | MetaStickerChoice | null;
type Entry = { value: Value; at: number };
const workspaces = new Map<string, Map<string, Entry>>();
const inFlight = new Map<string, Promise<unknown>>();

const isSticker = (value: any): value is MetaStickerChoice => value?.provider === "meta" &&
  typeof value.stickerId === "string" && /^\d{1,40}$/.test(value.stickerId) && typeof value.label === "string";
function valid(key: string, value: unknown): value is Value {
  if (key.startsWith("preview:")) return value === null || isSticker(value);
  if (!Array.isArray(value) || value.length > 2000) return false;
  if (key === "packs") return value.every(pack => typeof pack?.packId === "string" && typeof pack?.name === "string");
  return (key.startsWith("pack:") || key.startsWith("search:")) && value.every(isSticker);
}
function entries(businessId: string) {
  const existing = workspaces.get(businessId);
  if (existing) return existing;
  const result = new Map<string, Entry>();
  // This module is also compiled on the server; never share browser state there.
  if (typeof window === "undefined" || !businessId) return result;
  try {
    const stored = localStorage.getItem(PREFIX + businessId);
    const rows = stored && stored.length <= MAX_STORAGE_CHARS ? JSON.parse(stored) : [];
    if (Array.isArray(rows)) for (const row of rows.slice(-MAX_ENTRIES)) {
      if (!Array.isArray(row) || row.length !== 2) continue;
      const [key, entry] = row;
      if (typeof key === "string" && entry && Number.isFinite(entry.at) && entry.at <= Date.now() &&
          Date.now() - entry.at < KEEP_MS && valid(key, entry.value)) result.set(key, entry);
    }
  } catch { /* Corrupt/blocked storage falls back to this browser session. */ }
  if (workspaces.size >= 3) workspaces.delete(workspaces.keys().next().value!);
  workspaces.set(businessId, result);
  return result;
}
function persist(businessId: string, cache: Map<string, Entry>) {
  for (const [key, entry] of cache) if (Date.now() - entry.at >= KEEP_MS) cache.delete(key);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  // Search text/results are session-only. Store catalog metadata, never tokens,
  // customer messages or image bytes; media continues to load directly from Meta.
  const rows = [...cache].filter(([key]) => !key.startsWith("search:"));
  let serialized = JSON.stringify(rows);
  while (serialized.length > MAX_STORAGE_CHARS && rows.length) {
    cache.delete(rows.shift()![0]); serialized = JSON.stringify(rows);
  }
  try { localStorage.setItem(PREFIX + businessId, serialized); } catch { /* memory cache remains available */ }
}
function write(businessId: string, values: Record<string, Value>) {
  const cache = entries(businessId);
  for (const [key, value] of Object.entries(values)) if (valid(key, value)) {
    cache.delete(key); cache.set(key, { value, at: Date.now() });
  }
  persist(businessId, cache);
}
export function readMetaStickerCache<T extends Value>(businessId: string, key: string): { value: T; fresh: boolean } | null {
  const cache = entries(businessId), entry = cache.get(key);
  if (!entry || Date.now() - entry.at >= KEEP_MS) return null;
  cache.delete(key); cache.set(key, entry);
  const ttl = key.startsWith("search:") ? SEARCH_FRESH_MS : FRESH_MS;
  return { value: entry.value as T, fresh: Date.now() - entry.at < ttl };
}
export function invalidateMetaStickerCache(businessId: string, keys: string[]) {
  const cache = entries(businessId);
  keys.forEach(key => cache.delete(key)); persist(businessId, cache);
}
function shareRequest<T>(businessId: string, key: string, request: () => Promise<T>): Promise<T> {
  const identity = JSON.stringify([businessId, key]);
  const pending = inFlight.get(identity);
  if (pending) return pending as Promise<T>;
  // The request belongs to the cache, not the mounted picker. Closing the picker
  // lets it finish warming the cache; UI consumers guard their own stale updates.
  const result = request().finally(() => { if (inFlight.get(identity) === result) inFlight.delete(identity); });
  inFlight.set(identity, result);
  return result;
}
async function get(path: string, params: Record<string, string>) {
  const response = await fetch(`/api/facebook/stickers/${path}?${new URLSearchParams(params)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const data = await response.json();
  if (!response.ok || !data?.success) throw new Error(data?.error || "Unable to load Messenger stickers.");
  return data;
}
export function loadMetaStickerPacks(businessId: string, conversationId: string): Promise<MetaStickerPack[]> {
  const cached = readMetaStickerCache<MetaStickerPack[]>(businessId, "packs");
  if (cached?.fresh) return Promise.resolve(cached.value);
  return shareRequest(businessId, "packs", async () => {
    const data = await get("packs", { conversationId });
    if (!valid("packs", data.packs)) throw new Error("Unable to load Messenger sticker packs.");
    write(businessId, { packs: data.packs }); return data.packs as MetaStickerPack[];
  });
}
export function metaStickerItemsKey(packId: string, query: string) {
  return query.trim().length >= 2 ? `search:${query.trim()}` : `pack:${packId}`;
}
export function loadMetaStickerItems(businessId: string, conversationId: string, packId: string, query: string): Promise<MetaStickerChoice[]> {
  const key = metaStickerItemsKey(packId, query), cached = readMetaStickerCache<MetaStickerChoice[]>(businessId, key);
  if (cached?.fresh) return Promise.resolve(cached.value);
  return shareRequest(businessId, key, async () => {
    const search = query.trim().length >= 2;
    const data = await get(search ? "search" : "pack", search ? { conversationId, q: query.trim() } : { conversationId, packId });
    if (!valid(key, data.stickers)) throw new Error("Unable to load Messenger stickers.");
    const values: Record<string, Value> = { [key]: data.stickers };
    if (!search) values[`preview:${packId}`] = data.stickers.find((sticker: MetaStickerChoice) => sticker.previewUrl) || null;
    write(businessId, values); return data.stickers as MetaStickerChoice[];
  });
}
export function loadMetaStickerPreviews(businessId: string, conversationId: string, packIds: string[]): Promise<Record<string, MetaStickerChoice | null>> {
  const result: Record<string, MetaStickerChoice | null> = {}, missing: string[] = [];
  for (const id of packIds) {
    const cached = readMetaStickerCache<MetaStickerChoice | null>(businessId, `preview:${id}`);
    if (cached?.fresh) result[id] = cached.value; else missing.push(id);
  }
  if (!missing.length) return Promise.resolve(result);
  return shareRequest(businessId, `previews:${missing.sort().join(",")}`, async () => {
    const data = await get("previews", { conversationId, packIds: missing.join(",") });
    if (!Array.isArray(data.previews)) throw new Error("Unable to load sticker previews.");
    const values: Record<string, Value> = {}, fetched: Record<string, MetaStickerChoice | null> = {};
    for (const preview of data.previews) if (missing.includes(preview.packId) && valid(`preview:${preview.packId}`, preview.sticker)) {
      values[`preview:${preview.packId}`] = preview.sticker; fetched[preview.packId] = preview.sticker;
    }
    write(businessId, values); return fetched;
  }).then(fetched => ({ ...result, ...fetched }));
}
