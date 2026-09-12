import "server-only";
import { createHash } from "crypto";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { getTelegramStickerSet } from "@/lib/telegram/telegram-api";
import { normalizeStickerSetName } from "@/lib/telegram/sticker-catalog";
import type { TelegramStickerSet } from "@/lib/telegram/types";
export class StickerStoreError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export async function getStickerConversation(conversationId: string, write = false) {
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) throw new StickerStoreError(access.error, access.status);
  if (write && !(await memberHasPermission(access.member, "conversations", "manage"))) throw new StickerStoreError("You do not have permission to send in this conversation.", 403);
  const { conversation, businessId } = access;
  const [accountResult, contactResult] = await Promise.all([
    supabaseAdmin.from("social_accounts").select("id,platform,is_active,telegram_token_status,telegram_bot_token_encrypted,platform_account_id").eq("business_id", businessId).eq("id", conversation.social_account_id).maybeSingle(),
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id").eq("business_id", businessId).eq("id", conversation.contact_id).maybeSingle(),
  ]);
  if (accountResult.error || contactResult.error) throw new StickerStoreError("Unable to load the Telegram connection.", 503);
  const account = accountResult.data; const contact = contactResult.data;
  if (!account || !contact || account.platform !== "telegram" || contact.platform !== "telegram" || !account.is_active || account.telegram_token_status !== "verified" || !account.telegram_bot_token_encrypted || !/^-?\d+$/.test(contact.platform_user_id || "")) throw new StickerStoreError("An active verified Telegram bot is required for the sticker store.", 409);
  let token: string; try { token = decryptChannelCredential(account.telegram_bot_token_encrypted); } catch { throw new StickerStoreError("The Telegram connection must be reconnected.", 503); }
  return { ...access, account, contact, token };
}
const packs = new Map<string, { until: number; pending: Promise<TelegramStickerSet> }>();
/** Authentication is performed before the cache is used. Bot-specific file IDs
 * are not shared across tenants/bots or across credential rotations. */
export async function loadStickerSet(scope: { token: string; account: { id: string }; businessId: string }, input: unknown) {
  const name = normalizeStickerSetName(input);
  if (!name) throw new StickerStoreError("Enter a Telegram sticker-pack name or its t.me/addstickers link.");
  const key = `${scope.businessId}:${scope.account.id}:${createHash("sha256").update(scope.token).digest("hex").slice(0, 24)}:${name.toLowerCase()}`;
  const cached = packs.get(key); if (cached && cached.until > Date.now()) return cached.pending;
  const pending = getTelegramStickerSet(scope.token, name).then(pack => {
    if (!pack || pack.name?.toLowerCase() !== name.toLowerCase() || !Array.isArray(pack.stickers) || pack.sticker_type !== "regular") throw new StickerStoreError("This is not an available regular Telegram sticker pack.", 404);
    return pack;
  }).catch(error => { if (packs.get(key)?.pending === pending) packs.delete(key); throw error; });
  if (packs.size >= 100) packs.delete(packs.keys().next().value!);
  packs.set(key, { until: Date.now() + 300000, pending }); return pending;
}
