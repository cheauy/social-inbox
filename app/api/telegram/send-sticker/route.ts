import { NextRequest, NextResponse } from "next/server";
import { getStickerConversation, loadStickerSet, StickerStoreError } from "@/lib/telegram/sticker-store-server";
import { sendTelegramSticker } from "@/lib/telegram/telegram-api";
import { sendWithTelegramReplySafety } from "@/lib/telegram/reply-safety";
import { telegramStickerPreviewUrl } from "@/lib/telegram/sticker-catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isMessageDeleted, createReplyContext, type ActionMessage } from "@/lib/inbox/message-actions";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new StickerStoreError("Invalid request origin.", 403);
    let body; try { body = await request.json(); } catch { throw new StickerStoreError("Invalid request."); }
    if (!body || typeof body.conversationId !== "string" || body.conversationId.length > 100 ||
      typeof body.setName !== "string" || typeof body.stickerId !== "string" || body.stickerId.length > 200 ||
      (body.replyToMessageId != null && typeof body.replyToMessageId !== "string")) throw new StickerStoreError("Invalid sticker request.");
    const scope = await getStickerConversation(body.conversationId, true);
    const pack = await loadStickerSet(scope, body.setName);
    // Browser supplies only a public unique ID. Resolve actual file_id with THIS
    // authorized bot; never trust a foreign bot's file_id or an arbitrary URL.
    const sticker = pack.stickers.find(s => s.file_unique_id === body.stickerId && s.type === "regular");
    if (!sticker) throw new StickerStoreError("The selected sticker is no longer in this pack.", 404);
    let target: ActionMessage | null = null; let replyId: number | null = null;
    if (body.replyToMessageId) {
      const result = await supabaseAdmin.from("messages").select("id,conversation_id,platform_message_id,message_text,message_type,raw_payload,attachment_url,direction,comment_is_deleted")
        .eq("business_id", scope.businessId).eq("conversation_id", scope.conversation.id).eq("id", body.replyToMessageId).maybeSingle();
      if (result.error) throw new StickerStoreError("Unable to load the reply target.", 503);
      target = result.data as ActionMessage | null;
      const match = target?.platform_message_id.match(/^telegram:([^:]+):(\d+)$/);
      if (!target || !match || match[1] !== scope.contact.platform_user_id || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) throw new StickerStoreError("The reply target is not in this Telegram conversation.", 400);
      replyId = Number(match[2]);
    }
    const outcome = await sendWithTelegramReplySafety({ replyToMessageId: replyId,
      knownUnavailable: Boolean(target && isMessageDeleted(target)),
      send: reply => sendTelegramSticker({ token: scope.token, chatId: scope.contact.platform_user_id, fileId: sticker.file_id, replyToMessageId: reply }),
    });
    const sent = outcome.message;
    if (!Number.isSafeInteger(sent.message_id) || sent.message_id < 1) throw new StickerStoreError("Telegram returned no message ID. Check the conversation before retrying.", 502);
    const sentAt = Number.isFinite(sent.date) ? new Date(sent.date * 1000).toISOString() : new Date().toISOString();
    const platformMessageId = `telegram:${scope.contact.platform_user_id}:${sent.message_id}`;
    const previewUrl = sticker.thumbnail || (!sticker.is_animated && !sticker.is_video) ? telegramStickerPreviewUrl(scope.conversation.id, pack.name, sticker.file_unique_id) : null;
    const format = sticker.is_video ? "video" : sticker.is_animated ? "animated" : "static";
    let warning: string | null = null;
    // Provider success is final. A local persistence failure must not invite
    // another send of the same sticker.
    try {
      const stored = await supabaseAdmin.from("messages").insert({
        business_id: scope.businessId, conversation_id: scope.conversation.id, platform_message_id: platformMessageId,
        sender_platform_id: scope.account.platform_account_id || String(sent.from?.id || "telegram-bot"), recipient_platform_id: scope.contact.platform_user_id,
        direction: "outgoing", message_type: "sticker", message_text: `Sticker ${sticker.emoji || ""}`.trim(),
        sent_by_member_id: scope.member.id, delivery_status: "sent", delivered_at: null, seen_at: null, attachment_url: previewUrl, is_echo: false,
        raw_payload: { ...sent, tenh_sticker: { format, preview_kind: previewUrl ? "image" : "file", emoji: sticker.emoji || null, set_name: pack.name },
          ...(target && outcome.replyApplied ? { tenh_reply: createReplyContext(target, "telegram") } : {}),
          ...(outcome.replyFallback ? { tenh_reply_fallback: { reason: "original_unavailable", notice: outcome.notice } } : {}),
          tenh_delivery: { status: "accepted_by_telegram", accepted_at: sentAt },
        }, platform_created_at: sentAt,
      });
      if (stored.error) warning = "Telegram sent the sticker, but TENH could not save its local record. Do not resend it.";
      const update = await supabaseAdmin.from("conversations").update({ last_message_text: "You sent a sticker", last_message_at: sentAt, updated_at: new Date().toISOString() })
        .eq("business_id", scope.businessId).eq("id", scope.conversation.id);
      if (update.error) warning ||= "Sticker sent; the local conversation preview could not be updated.";
    } catch { warning = "Sticker sent; local synchronization is pending. Do not resend it."; }
    return NextResponse.json({ success: true, platform: "telegram", messageId: platformMessageId, replyApplied: outcome.replyApplied, replyFallback: outcome.replyFallback, notice: outcome.notice, warning });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof StickerStoreError ? error.message : "Telegram could not confirm this sticker send. Check the conversation before retrying." }, { status: error instanceof StickerStoreError ? error.status : 502 });
  }
}
