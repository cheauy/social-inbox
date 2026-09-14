import type { MetaStickerChoice } from "../../lib/stickers/catalog";
import { telegramStickerPreviewUrl, type TelegramStickerChoice } from "../../lib/telegram/sticker-catalog";
import { sessionStorage } from "./auth/secure-storage";

type Choice = MetaStickerChoice | TelegramStickerChoice;
type Entry = { scope: string; at: number; items: Choice[] };
const KEY = "sticker-recents-v1";
const LIMIT = 24;
const TTL = 30 * 24 * 60 * 60_000;
let epoch = 0;
let queue: Promise<unknown> = Promise.resolve();
export const stickerRecentGeneration = () => epoch;
const scopeKey = (user: string, workspace: string, platform: string) => JSON.stringify([user, workspace, platform]);
const identity = (item: Choice) => `${"setName" in item ? item.setName : "meta"}:${item.stickerId}`;
function valid(item: Choice) {
  return item && typeof item.stickerId === "string" && item.stickerId.length <= 200 && typeof item.label === "string" && item.label.length <= 160 &&
    (item.previewUrl === null || typeof item.previewUrl === "string" && item.previewUrl.length <= 4096 && /^(https:\/\/|\/api\/telegram\/stickers\/preview\?)/.test(item.previewUrl)) &&
    ("setName" in item ? typeof item.setName === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(item.setName) : item.provider === "meta");
}
async function read(): Promise<Entry[]> {
  try {
    const text = await sessionStorage.getItem(KEY);
    if (!text || text.length > 60000) return [];
    const value = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return value.filter(entry => typeof entry?.scope === "string" && Number.isFinite(entry.at) && Date.now() - entry.at < TTL && Array.isArray(entry.items))
      .slice(-6).map(entry => ({ ...entry, items: entry.items.filter(valid).slice(0, LIMIT) }));
  } catch { return []; }
}
export async function readStickerRecents(user: string, workspace: string, platform: string, conversationId: string): Promise<Choice[]> {
  const generation = epoch;
  await queue;
  const entries = await read();
  if (generation !== epoch) return [];
  return (entries.find(entry => entry.scope === scopeKey(user, workspace, platform))?.items ?? []).map(item =>
    "setName" in item ? { ...item, previewUrl: item.previewUrl ? telegramStickerPreviewUrl(conversationId, item.setName, item.stickerId) : null } : item);
}
export function rememberSticker(user: string, workspace: string, platform: string, item: Choice, generation: number) {
  const work = queue.then(async () => {
    if (generation !== epoch || !valid(item)) return;
    const scope = scopeKey(user, workspace, platform);
    const entries = await read();
    if (generation !== epoch) return;
    const previous = entries.find(entry => entry.scope === scope)?.items ?? [];
    const next = [...entries.filter(entry => entry.scope !== scope), { scope, at: Date.now(), items: [item, ...previous.filter(old => identity(old) !== identity(item))].slice(0, LIMIT) }].slice(-6);
    while (JSON.stringify(next).length > 60000 && next.length) next.shift();
    await sessionStorage.setItem(KEY, JSON.stringify(next));
  }).catch(() => {});
  queue = work;
  return work;
}
export function clearStickerRecents() {
  epoch++;
  queue = queue.then(() => sessionStorage.removeItem(KEY)).catch(() => {});
  return queue;
}
