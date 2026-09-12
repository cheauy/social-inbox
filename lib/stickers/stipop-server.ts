import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { StipopStickerChoice } from "./catalog";

export class StipopError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "sticker_request_failed") { super(message); }
}
export async function stickerConversation(conversationId: string, write = false) {
  if (!conversationId || conversationId.length > 100) throw new StipopError("Choose a Facebook conversation.");
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) throw new StipopError(access.error, access.status);
  if (write && !(await memberHasPermission(access.member, "conversations", "manage"))) throw new StipopError("You cannot send in this conversation.", 403);
  const [pageResult, contactResult] = await Promise.all([
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active").eq("id", access.conversation.social_account_id).eq("business_id", access.businessId).maybeSingle(),
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id").eq("id", access.conversation.contact_id).eq("business_id", access.businessId).maybeSingle(),
  ]);
  if (pageResult.error || contactResult.error) throw new StipopError("Unable to verify the Facebook conversation.", 503);
  const page = pageResult.data, contact = contactResult.data;
  if (!page || !contact || !page.is_active || page.platform !== "facebook" || contact.platform !== "facebook" || !/^\d{1,30}$/.test(page.platform_account_id) || !/^\d{1,30}$/.test(contact.platform_user_id)) throw new StipopError("An active Facebook Page/customer conversation is required.", 409);
  return { ...access, page, contact };
}
export type StickerScope = Awaited<ReturnType<typeof stickerConversation>>;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function config() {
  const key = process.env.STIPOP_API_KEY?.trim();
  if (!key) throw new StipopError("Online stickers are not configured. Ask the owner to add STIPOP_API_KEY to the existing TENH deployment.", 503, "STICKER_STORE_NOT_CONFIGURED");
  return { key, lang: /^[a-z]{2}$/.test(process.env.STIPOP_LANGUAGE || "") ? process.env.STIPOP_LANGUAGE! : "en",
    country: /^[A-Z]{2}$/.test(process.env.STIPOP_COUNTRY || "") ? process.env.STIPOP_COUNTRY! : "KH" };
}
/** Only the vendor's HTTPS image hosts (or explicit admin-added CDN hosts). */
export function stickerMediaUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const extra = (process.env.STIPOP_MEDIA_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
        !(url.hostname.endsWith(".stipop.io") || url.hostname === "stipop.io" || extra.includes(url.hostname)) ||
        url.hostname === "localhost" || url.hostname.endsWith(".local") || /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.includes(":")) return null;
    return url.href;
  } catch { return null; }
}
export type StickerSelection = {
  businessId: string; conversationId: string; memberId: string; pageId: string; psid: string;
  stickerId: string; imageUrl: string; label: string; query: string; expiresAt: number;
};
function signature(payload: string) { return createHmac("sha256", config().key).update(`tenh-sticker-v1:${payload}`).digest("base64url"); }
export function signSelection(data: StickerSelection) { const payload = Buffer.from(JSON.stringify(data)).toString("base64url"); return `${payload}.${signature(payload)}`; }
export function verifySelection(token: unknown, scope: StickerScope, now = Date.now()): StickerSelection {
  if (typeof token !== "string" || token.length > 12000) throw new StipopError("Search and choose the sticker again.", 400, "INVALID_STICKER_SELECTION");
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw new StipopError("Invalid sticker selection.");
  const expected = Buffer.from(signature(parts[0])), supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new StipopError("Sticker selection was modified.", 403);
  let value: StickerSelection; try { value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw new StipopError("Invalid sticker selection."); }
  if (!value || value.businessId !== scope.businessId || value.memberId !== scope.member.id || value.conversationId !== scope.conversation.id || value.pageId !== scope.page.platform_account_id || value.psid !== scope.contact.platform_user_id) throw new StipopError("This sticker selection belongs to another conversation or agent.", 403);
  if (!Number.isFinite(value.expiresAt) || value.expiresAt < now || value.expiresAt > now + 16 * 60000) throw new StipopError("Sticker selection expired. Search again.", 409, "STICKER_SELECTION_EXPIRED");
  if (!/^\d{1,30}$/.test(value.stickerId) || !stickerMediaUrl(value.imageUrl)) throw new StipopError("The sticker image host is not approved.");
  return value;
}
async function vendorJson(url: URL, method = "GET", timeoutMs = 12000) {
  const { key } = config();
  let response: Response;
  try { response = await fetch(url, { method, headers: { apikey: key, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs), redirect: "error", cache: "no-store" }); }
  catch { throw new StipopError("Sticker service is temporarily unavailable. Your message was not sent.", 502); }
  if (!response.ok) throw new StipopError(response.status === 429 ? "Sticker service is busy. Wait before searching again." : "Stipop rejected the request. Check the server API key and plan.", response.status === 429 ? 429 : 502);
  const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new StipopError("Sticker service response was too large.", 502);
  let data; try { data = JSON.parse(text); } catch { throw new StipopError("Sticker service returned an unreadable response.", 502); }
  if (data?.header?.code !== "0000") throw new StipopError("Stipop did not confirm the request. Check its API key and plan.", 502);
  return data;
}
const searches = new Map<string, { at: number; items: StipopStickerChoice[]; hasMore: boolean }>();
const rate = new Map<string, { until: number; count: number }>();
export async function searchStickers(scope: StickerScope, query: string, pageNumber = 1) {
  const cfg = config();
  const q = query.trim();
  if (!q || q.length > 100 || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 50) throw new StipopError("Enter a search up to 100 characters.");
  const userId = digest(`${scope.businessId}:${scope.member.user_id || scope.member.id}`);
  const key = `${digest(cfg.key)}:${userId}:${scope.conversation.id}:${cfg.lang}:${cfg.country}:${q}:${pageNumber}`;
  const cached = searches.get(key);
  if (cached && Date.now() - cached.at < 30000) return { stickers: cached.items, hasMore: cached.hasMore };
  const now = Date.now(); let quota = rate.get(userId);
  if (!quota || quota.until < now) { quota = { until: now + 60000, count: 0 }; if (rate.size >= 500) rate.delete(rate.keys().next().value!); rate.set(userId, quota); }
  if (++quota.count > 40) throw new StipopError("Too many sticker searches. Wait a moment.", 429);
  const url = new URL("https://messenger.stipop.io/v1/search");
  url.search = new URLSearchParams({ q, userId, lang: cfg.lang, countryCode: cfg.country, pageNumber: String(pageNumber), limit: "24" }).toString();
  const data = await vendorJson(url);
  if (!Array.isArray(data.body?.stickerList)) throw new StipopError("Stipop returned no sticker list.", 502);
  const seen = new Set<string>(), items: StipopStickerChoice[] = [];
  for (const raw of data.body.stickerList.slice(0, 24)) {
    const stickerId = String(raw?.stickerId || ""), imageUrl = stickerMediaUrl(raw?.stickerImg);
    if (!/^\d{1,30}$/.test(stickerId) || !imageUrl || seen.has(stickerId)) continue;
    seen.add(stickerId);
    const label = String(raw.keyword || q).slice(0, 100), expiresAt = now + 15 * 60000;
    const selection: StickerSelection = { businessId: scope.businessId, conversationId: scope.conversation.id, memberId: scope.member.id,
      pageId: scope.page.platform_account_id, psid: scope.contact.platform_user_id, stickerId, imageUrl, label, query: q, expiresAt };
    items.push({ provider: "stipop", stickerId, imageUrl, label, expiresAt, selectionToken: signSelection(selection) });
  }
  if (data.body.stickerList.length && !items.length) throw new StipopError("Stipop returned image hosts that are not approved. Check STIPOP_MEDIA_HOSTS against your provider account's CDN, not arbitrary URLs.", 502);
  if (searches.size >= 200) searches.delete(searches.keys().next().value!);
  const hasMore = data.body.stickerList.length >= 24;
  searches.set(key, { at: now, items, hasMore });
  return { stickers: items, hasMore };
}
/** Only a signed search-result URL can reach this fetch. Redirects are refused. */
export async function downloadSticker(selection: StickerSelection) {
  const url = stickerMediaUrl(selection.imageUrl); if (!url) throw new StipopError("Invalid sticker URL.");
  let response; try { response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "error", cache: "no-store" }); } catch { throw new StipopError("Sticker image could not be loaded. Nothing was sent.", 502); }
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!response.ok || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type)) throw new StipopError("Stipop returned an unsupported sticker image.", 502);
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers.get("content-length") || 0) > limit) throw new StipopError("Sticker exceeds the 8 MB limit.", 413);
  const reader = response.body?.getReader(); if (!reader) throw new StipopError("Empty sticker image.", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new StipopError("Sticker exceeds the 8 MB limit.", 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks); if (!size) throw new StipopError("Empty sticker image.", 502);
  // MIME headers alone must not turn an HTML/SVG response into an upload.
  const valid = type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === "image/gif" ? /^(GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString())
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new StipopError("Sticker bytes do not match the image format.", 502);
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  return new File([new Uint8Array(bytes)], `stipop-${selection.stickerId}.${ext}`, { type });
}
export async function registerStickerSend(selection: StickerSelection, scope: StickerScope) {
  const cfg = config(), url = new URL(`https://messenger.stipop.io/v1/analytics/send/${selection.stickerId}`);
  url.search = new URLSearchParams({ userId: digest(`${scope.businessId}:${scope.member.user_id || scope.member.id}`), q: selection.query, lang: cfg.lang, countryCode: cfg.country }).toString();
  await vendorJson(url, "POST", 1500);
}
