import type { MetaStickerChoice } from "./catalog";
import type { InboxMessage } from "@/types/inbox";

const PREFIX = "tenh:messenger-sticker-recents:v2:";
const MAX_RECENT = 20;
export const META_STICKER_RECENTS_CHANGED = "tenh:messenger-sticker-recents-changed";
type Recent = { sticker: MetaStickerChoice; sentAt: number };
const memory = new Map<string, Recent[]>();
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

function valid(entry: Recent) {
  return entry?.sticker?.provider === "meta" && /^\d{1,40}$/.test(entry.sticker.stickerId) &&
    typeof entry.sticker.label === "string" && Number.isFinite(entry.sentAt);
}
function read(businessId: string): Recent[] {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + businessId) || "null");
    if (Array.isArray(value)) return value.filter(valid).slice(0, MAX_RECENT);
  } catch { /* Private browsing can disable storage. Keep this session usable. */ }
  return memory.get(businessId) || [];
}
function remember(businessId: string, entries: Recent[]) {
  if (!businessId || !entries.length) return;
  const before = read(businessId), seen = new Set<string>();
  const next = [...entries, ...before].filter(valid).sort((a, b) => b.sentAt - a.sentAt)
    .filter(entry => !seen.has(entry.sticker.stickerId) && Boolean(seen.add(entry.sticker.stickerId))).slice(0, MAX_RECENT);
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  memory.set(businessId, next);
  try { localStorage.setItem(PREFIX + businessId, JSON.stringify(next)); } catch { /* memory fallback */ }
  window.dispatchEvent(new Event(META_STICKER_RECENTS_CHANGED));
}
export function readMetaStickerRecents(businessId: string) {
  return read(businessId).map(entry => entry.sticker);
}
export function rememberMetaSticker(businessId: string, sticker: MetaStickerChoice) {
  remember(businessId, [{ sticker, sentAt: Date.now() }]);
}

/** Reuse loaded history; opening Recents never needs another message query. */
export function rememberMetaStickerMessages(businessId: string, conversationId: string, messages: InboxMessage[]) {
  const entries: Recent[] = [];
  for (const message of messages) {
    if (message.conversation_id !== conversationId || message.direction !== "outgoing" || message.id.startsWith("optimistic:") || message.platform_message_id?.startsWith("telegram:")) continue;
    const raw = record(message.raw_payload), native = record(raw.message), saved = record(raw.tenh_meta_sticker);
    const attachments = Array.isArray(native.attachments) ? native.attachments : [];
    const attachment = attachments.find(item => record(item).type === "sticker" || record(record(item).payload).sticker_id);
    const payload = record(record(attachment).payload);
    const stickerId = String(saved.sticker_id || payload.sticker_id || native.sticker_id || "");
    if (!/^\d{1,40}$/.test(stickerId)) continue;
    const url = message.attachment_url || payload.url;
    entries.push({ sentAt: Date.parse(message.platform_created_at || message.created_at), sticker: {
      provider: "meta", stickerId, label: typeof saved.label === "string" ? saved.label : "Messenger sticker",
      previewUrl: typeof url === "string" && url.startsWith("https://") ? url : null,
      packId: typeof saved.pack_id === "string" ? saved.pack_id : null, width: null, height: null, animated: false,
    } });
  }
  remember(businessId, entries);
}
