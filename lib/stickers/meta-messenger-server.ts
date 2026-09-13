import "server-only";
import { createHash } from "node:crypto";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MetaStickerChoice, MetaStickerPack } from "./catalog";

export class MetaStickerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "META_STICKER_REQUEST_FAILED",
    readonly details?: string,
  ) { super(message); }
}

export async function metaStickerConversation(conversationId: string, write = false) {
  if (!conversationId || conversationId.length > 100) throw new MetaStickerError("Choose a Facebook conversation.");
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) throw new MetaStickerError(access.error, access.status);
  if (write && !(await memberHasPermission(access.member, "conversations", "manage"))) {
    throw new MetaStickerError("You cannot send in this conversation.", 403);
  }
  const [pageResult, contactResult] = await Promise.all([
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active").eq("id", access.conversation.social_account_id).eq("business_id", access.businessId).maybeSingle(),
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id").eq("id", access.conversation.contact_id).eq("business_id", access.businessId).maybeSingle(),
  ]);
  if (pageResult.error || contactResult.error) throw new MetaStickerError("Unable to verify the Facebook conversation.", 503);
  const page = pageResult.data, contact = contactResult.data;
  if (!page || !contact || !page.is_active || page.platform !== "facebook" || contact.platform !== "facebook" ||
      !/^\d{1,30}$/.test(page.platform_account_id) || !/^\d{1,30}$/.test(contact.platform_user_id)) {
    throw new MetaStickerError("An active Facebook Page/customer conversation is required.", 409);
  }
  return { ...access, page, contact };
}
export type MetaStickerScope = Awaited<ReturnType<typeof metaStickerConversation>>;

const GRAPH_VERSION = () => process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
const GRAPH_ROOT = "https://graph.facebook.com";

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; type?: string } };

type MetaPage<T> = {
  data?: T[];
  stickers?: T[];
  sticker_packs?: T[];
  stickerpacks?: T[];
  results?: T[];
  paging?: { next?: string; cursors?: { after?: string }; after?: string };
} & GraphError;

function boundedString(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}
function numericId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : boundedString(value, 80);
  return text && /^\d{1,40}$/.test(text) ? text : null;
}
function catalogId(value: unknown): string | null {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : boundedString(value, 128);
  return text && /^[A-Za-z0-9_.:-]{1,128}$/.test(text) ? text : null;
}
function metaItems<T>(payload: MetaPage<T>): T[] {
  for (const candidate of [payload.data, payload.sticker_packs, payload.stickerpacks, payload.stickers, payload.results]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
function hasMetaItemsArray<T>(payload: MetaPage<T>) {
  return [payload.data, payload.sticker_packs, payload.stickerpacks, payload.stickers, payload.results].some(Array.isArray);
}
function nextCursor<T>(payload: MetaPage<T>) {
  if (!payload.paging?.next) return null;
  const cursor = payload.paging?.cursors?.after || payload.paging?.after || null;
  return typeof cursor === "string" && cursor.length <= 512 ? cursor : null;
}
function safePreview(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname === "localhost" || url.hostname.endsWith(".local")) return null;
    return url.href;
  } catch { return null; }
}
function firstValue(raw: any, keys: string[]) {
  for (const key of keys) if (raw?.[key] !== undefined && raw?.[key] !== null) return raw[key];
  return null;
}
function firstPreview(raw: any) {
  const direct = firstValue(raw, ["preview_url", "preview_image_url", "thumbnail_url", "cover_url", "image_url", "url", "uri", "cdn_url"]);
  if (typeof direct === "string") return safePreview(direct);
  const nested = firstValue(raw, ["preview", "preview_image", "preview_sticker", "cover", "thumbnail", "image", "asset"]);
  if (typeof nested === "string") return safePreview(nested);
  if (nested && typeof nested === "object") return safePreview(firstValue(nested, ["url", "uri", "src", "image_url"]));
  return null;
}

export function normalizeMetaSticker(raw: any, fallbackPackId: string | null = null): MetaStickerChoice | null {
  const stickerId = numericId(firstValue(raw, ["id", "sticker_id", "stickerId"]));
  if (!stickerId) return null;
  const packId = catalogId(firstValue(raw, ["pack_id", "sticker_pack_id", "packId"])) || fallbackPackId;
  const widthRaw = Number(firstValue(raw, ["width", "image_width"]));
  const heightRaw = Number(firstValue(raw, ["height", "image_height"]));
  const label = boundedString(firstValue(raw, ["name", "label", "title", "accessibility_text", "description"]), 160) || "Messenger sticker";
  return {
    provider: "meta",
    stickerId,
    label,
    previewUrl: firstPreview(raw),
    packId,
    width: Number.isFinite(widthRaw) && widthRaw > 0 ? widthRaw : null,
    height: Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : null,
    animated: Boolean(firstValue(raw, ["is_animated", "animated", "isAnimated"])),
  };
}

export function normalizeMetaStickerPack(raw: any): MetaStickerPack | null {
  const packId = catalogId(firstValue(raw, ["id", "pack_id", "sticker_pack_id", "packId"]));
  if (!packId) return null;
  const countRaw = Number(firstValue(raw, ["sticker_count", "stickers_count", "count"]));
  return {
    packId,
    name: boundedString(firstValue(raw, ["localized_name", "name", "title"]), 160) || "Messenger stickers",
    description: boundedString(firstValue(raw, ["localized_description", "description", "subtitle"]), 500),
    previewUrl: firstPreview(raw),
    stickerCount: Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : null,
  };
}

/**
 * Catalog endpoints are app-scoped (App Access Token), not Page Graph edges.
 * https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/sticker-api
 * Only the Send API uses the Page token. Keep all credentials on the server.
 */
const catalogCache = new Map<string, { expires: number; result: Promise<MetaPage<unknown>> }>();

async function graphGetCatalog<T>(path: string, params: Record<string, string> = {}): Promise<MetaPage<T>> {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const token = process.env.FACEBOOK_APP_ACCESS_TOKEN?.trim() || (appId && appSecret ? `${appId}|${appSecret}` : "");
  if (!token) throw new MetaStickerError("Messenger stickers are not configured. Ask the workspace owner to check the Facebook app settings.", 503, "META_STICKER_APP_TOKEN_MISSING");
  const url = new URL(`${GRAPH_ROOT}/${GRAPH_VERSION()}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const key = createHash("sha256").update(`${token}:${url.href}`).digest("hex");
  const cached = catalogCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result as Promise<MetaPage<T>>;
  const result = (async (): Promise<MetaPage<T>> => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(12000) });
    } catch { throw new MetaStickerError("Messenger stickers could not load. Please try again.", 502, "META_STICKER_NETWORK_ERROR"); }
    let payload: MetaPage<T> = {};
    try { payload = await response.json(); } catch { /* validated below */ }
    if (!response.ok || payload.error || !hasMetaItemsArray(payload)) {
      // Do not echo upstream messages, URLs or credentials to the browser.
      const detail = `Meta code ${payload.error?.code ?? response.status}${payload.error?.error_subcode ? ` / ${payload.error.error_subcode}` : ""}.`;
      throw new MetaStickerError("Messenger stickers could not load. Please try again or ask the workspace owner to check the Facebook app settings.", 502, "META_STICKER_API_UNAVAILABLE", detail);
    }
    return payload;
  })();
  if (catalogCache.size >= 180) catalogCache.delete(catalogCache.keys().next().value!);
  catalogCache.set(key, { expires: Date.now() + (path === "sticker_search" ? 5 * 60_000 : 60 * 60_000), result });
  try { return await result; }
  catch (error) { if (catalogCache.get(key)?.result === result) catalogCache.delete(key); throw error; }
}

export async function listMetaStickerPacks(_scope: MetaStickerScope, after?: string | null) {
  const params: Record<string, string> = {};
  if (after && /^[A-Za-z0-9_=-]{1,512}$/.test(after)) params.after = after;
  const payload = await graphGetCatalog<any>("sticker_packs", params);
  const packs = metaItems(payload).map(normalizeMetaStickerPack).filter(Boolean) as MetaStickerPack[];
  return { packs, nextCursor: nextCursor(payload) };
}

export async function listMetaStickers(_scope: MetaStickerScope, packId: string, after?: string | null) {
  if (!numericId(packId)) throw new MetaStickerError("Choose a valid Meta sticker pack.");
  const params: Record<string, string> = {};
  if (after && /^[A-Za-z0-9_=-]{1,512}$/.test(after)) params.after = after;
  const payload = await graphGetCatalog<any>(`sticker_packs/${encodeURIComponent(packId)}/stickers`, params);
  const stickers = metaItems(payload).map(item => normalizeMetaSticker(item, packId)).filter(Boolean) as MetaStickerChoice[];
  return { stickers, nextCursor: nextCursor(payload) };
}

export async function searchMetaStickers(_scope: MetaStickerScope, query: string, after?: string | null) {
  const q = query.trim();
  if (q.length < 2 || q.length > 100) throw new MetaStickerError("Enter at least 2 characters to search Meta stickers.");
  const base: Record<string, string> = { q };
  if (after && /^[A-Za-z0-9_=-]{1,512}$/.test(after)) base.after = after;
  const payload = await graphGetCatalog<any>("sticker_search", base);
  const stickers = metaItems(payload).map(item => normalizeMetaSticker(item)).filter(Boolean) as MetaStickerChoice[];
  return { stickers, nextCursor: nextCursor(payload) };
}
