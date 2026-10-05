import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isTelegramReactionEmoji, telegramAllowedReactions, telegramReactionTarget } from "@/lib/telegram/message-reactions";
import { getTelegramChat, getTelegramReactionBot, setTelegramMessageReaction, TelegramReactionRejectedError } from "@/lib/telegram/telegram-api";
import { claimReaction, finishReaction, reactionStoreReady, readReactionState, telegramReactionsEnabled, type TelegramReactionScope } from "@/lib/telegram/reaction-store";
import type { InboxMessage } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number, code = "TELEGRAM_REACTION_FAILED") => json({ success: false, error, code }, status);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
type Input = { businessId: string; accountId: string; conversationId: string; messageId: string; platformMessageId: string };
function parseInput(body: Record<string, unknown>): Input | null {
  return [body.businessId, body.accountId, body.conversationId, body.messageId].every(uuid) &&
    typeof body.platformMessageId === "string" && /^telegram:[1-9]\d{0,15}:[1-9]\d{0,15}$/.test(body.platformMessageId) ? body as Input : null;
}

async function prepare(input: Input) {
  const auth = await getCurrentMember(true);
  if (!auth.success) return { response: fail(auth.error, auth.status) };
  if (!auth.member.is_active || auth.member.business_id !== input.businessId) return { response: fail("Selected workspace mismatch.", 403) };
  const access = await getInboxConversationAccess(input.conversationId);
  if (!access.success) return { response: fail(access.error, access.status) };
  if (access.businessId !== input.businessId || access.user.id !== auth.user.id || access.conversation.social_account_id !== input.accountId ||
      !access.conversation.contact_id || !await memberHasPermission(access.member, "conversations", "manage")) return { response: fail("You cannot react in this selected workspace and chat.", 403) };
  if (!await reactionStoreReady(supabaseAdmin, input.businessId)) return { response: json({ success: true, version: 1, available: false, reason: "Telegram reactions are awaiting workspace activation." }) };
  const [messageResult, accountResult, contactResult, conversationResult] = await Promise.all([
    supabaseAdmin.from("messages").select("*").eq("business_id", input.businessId).eq("conversation_id", input.conversationId).eq("id", input.messageId).maybeSingle(),
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active,telegram_token_status,telegram_bot_token_encrypted")
      .eq("business_id", input.businessId).eq("id", input.accountId).maybeSingle(),
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id").eq("business_id", input.businessId).eq("id", access.conversation.contact_id).maybeSingle(),
    supabaseAdmin.from("conversations").select("platform,source_type").eq("business_id", input.businessId).eq("id", input.conversationId).maybeSingle(),
  ]);
  if ([messageResult, accountResult, contactResult, conversationResult].some(result => result.error)) return { response: fail("Unable to verify Telegram ownership.", 503) };
  const message = messageResult.data as InboxMessage | null, account = accountResult.data, contact = contactResult.data;
  const target = message && telegramReactionTarget(message);
  if (!message) return { response: fail("Message was not found in this chat.", 404) };
  if (!target || message.platform_message_id !== input.platformMessageId || conversationResult.data?.platform !== "telegram" || conversationResult.data?.source_type === "comment" ||
      account?.platform !== "telegram" || account.is_active !== true || account.telegram_token_status !== "verified" || !account.telegram_bot_token_encrypted ||
      !/^[1-9]\d{0,15}$/.test(account.platform_account_id ?? "") || contact?.platform !== "telegram" || contact.platform_user_id !== target.chatId) {
    return { response: fail("Reactions require an existing message in this bot's normal private chat.", 409) };
  }
  const owned = (row: InboxMessage) => row.direction === "incoming"
    ? row.sender_platform_id === target.chatId && row.recipient_platform_id === account.platform_account_id
    : row.direction === "outgoing" && row.sender_platform_id === account.platform_account_id && row.recipient_platform_id === target.chatId;
  if (!owned(message)) return { response: fail("Message participants do not match the selected bot and customer.", 409) };
  let first = message, firstTarget = target;
  if (target.albumId) {
    const album = await supabaseAdmin.rpc("tenh_telegram_reaction_album", {
      p_business: input.businessId, p_conversation: input.conversationId, p_album: target.albumId,
    });
    if (album.error || (album.data?.length ?? 0) > 10) return { response: fail("Unable to verify the complete stored album.", 409) };
    const members = ((album.data ?? []) as InboxMessage[]).flatMap(row => {
      const native = telegramReactionTarget(row);
      return native && native.chatId === target.chatId && native.groupKey === target.groupKey && owned(row) ? [{ row, native }] : [];
    }).sort((a, b) => a.native.nativeMessageId - b.native.nativeMessageId);
    if (!members.length || !members.some(item => item.row.id === message.id)) return { response: fail("Album membership changed. Reopen the actions.", 409) };
    first = members[0].row; firstTarget = members[0].native;
  }
  const scope: TelegramReactionScope = { ...input, botId: account.platform_account_id, chatId: target.chatId, groupKey: target.groupKey, targetMessageId: first.id };
  // Existing server decryption path; no credentials leave this route.
  const token = decryptChannelCredential(account.telegram_bot_token_encrypted);
  const [chat, bot] = await Promise.all([getTelegramChat(token, target.chatId), getTelegramReactionBot(token)]);
  if (chat?.type !== "private" || String(chat.id) !== target.chatId || bot?.is_bot !== true || String(bot.id) !== account.platform_account_id) return { response: fail("Telegram did not confirm the selected bot and private chat.", 409) };
  return { scope, token, access, input, nativeMessageId: firstTarget.nativeMessageId, emojis: telegramAllowedReactions(chat), state: await readReactionState(supabaseAdmin, scope) };
}

export async function GET(request: NextRequest) {
  if (!telegramReactionsEnabled()) return json({ success: true, version: 1, available: false, reason: "Telegram reactions are awaiting backend rollout." });
  const input = parseInput(Object.fromEntries(request.nextUrl.searchParams));
  if (!input) return fail("Exact workspace, bot, chat and message IDs are required.", 400);
  try {
    const prepared = await prepare(input);
    if (prepared.response) return prepared.response;
    const blocked = prepared.state?.status === "pending" || prepared.state?.status === "uncertain";
    return json({ success: true, version: 1, available: !blocked && (prepared.emojis.length > 0 || prepared.state?.emoji !== null && !!prepared.state),
      scope: prepared.scope, emojis: prepared.emojis, state: prepared.state, album: prepared.scope.groupKey.startsWith("a:"),
      reason: blocked ? "This bot reaction is pending or uncertain. It needs review before another action." : prepared.emojis.length ? null : "This chat does not allow standard emoji reactions." });
  } catch { return fail("Telegram reactions are unavailable until the chat and reviewed backend can be verified.", 503); }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return fail("A same-origin signed-in request is required.", 403);
  if (!telegramReactionsEnabled()) return fail("Telegram reactions are awaiting backend rollout.", 503, "TELEGRAM_REACTIONS_DISABLED");
  let body: Record<string, unknown>;
  try { const raw = await request.text(); if (raw.length > 4096) return fail("Request too large.", 413); body = JSON.parse(raw); }
  catch { return fail("Invalid reaction request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid reaction request.", 400);
  const input = parseInput(body);
  if (!input || !uuid(body.requestId) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 ||
      (body.reaction !== null && !isTelegramReactionEmoji(body.reaction))) return fail("Exact message IDs, a request ID/revision, and one standard emoji or null are required.", 400);
  const requestId = body.requestId, emoji = body.reaction as string | null;
  let claimed = false, dispatched = false;
  try {
    const prepared = await prepare(input);
    if (prepared.response) return prepared.response.status === 200 ? fail("Telegram reactions are awaiting workspace activation.", 503) : prepared.response;
    if (emoji !== null && !prepared.emojis.includes(emoji)) return fail("This standard emoji is not allowed in the selected chat.", 409);
    // Recheck membership/subscription/permission after the provider capability read.
    const fresh = await getInboxConversationAccess(input.conversationId);
    if (!fresh.success) return fail(fresh.error, fresh.status);
    if (fresh.businessId !== input.businessId || fresh.user.id !== prepared.access.user.id || fresh.conversation.social_account_id !== input.accountId ||
        fresh.conversation.contact_id !== prepared.access.conversation.contact_id || !await memberHasPermission(fresh.member, "conversations", "manage")) return fail("Chat ownership or permission changed. Reopen the actions.", 403);
    const reservation = await claimReaction(supabaseAdmin, { ...prepared.scope, expectedRevision: Number(body.expectedRevision) }, requestId, fresh.member.id, emoji);
    if (reservation.kind === "request_conflict") return fail("This request ID belongs to a different reaction action.", 409);
    if (reservation.kind === "target_changed") return fail("The album changed. Reopen the actions before reacting.", 409);
    if (reservation.kind === "revision_changed") return fail("Another agent changed this reaction. Reopen the actions before reacting.", 409);
    if (reservation.kind === "blocked") return fail("This reaction is pending or uncertain. It needs review before another action.", 409, "TELEGRAM_REACTION_UNCERTAIN");
    if (reservation.kind === "replay") {
      if (reservation.operationStatus !== "confirmed") return fail("This request was already recorded and will not be sent again. Refresh the reaction state.", 409, "TELEGRAM_REACTION_ALREADY_RECORDED");
      return json({ success: true, version: 1, replayed: true, scope: prepared.scope, state: reservation.state });
    }
    claimed = true; dispatched = true;
    await setTelegramMessageReaction({ token: prepared.token, chatId: prepared.scope.chatId, messageId: prepared.nativeMessageId, emoji });
    const state = await finishReaction(supabaseAdmin, requestId, "confirmed");
    return json({ success: true, version: 1, scope: prepared.scope, state });
  } catch (error) {
    if (claimed) {
      const rejected = dispatched && error instanceof TelegramReactionRejectedError;
      try { await finishReaction(supabaseAdmin, requestId, rejected || !dispatched ? "rejected" : "uncertain"); }
      catch { /* Claim stays blocked; no second provider attempt. */ }
      return fail(rejected ? "Telegram rejected this reaction. Refresh the chat's available reactions before choosing again."
        : "The bot reaction result is uncertain. Do not retry; it needs review in Telegram and TENH.", 502,
      rejected ? "TELEGRAM_REACTION_REJECTED" : "TELEGRAM_REACTION_UNCERTAIN");
    }
    return fail("Unable to prepare or reserve this reaction. No provider action was started.", 503);
  }
}
