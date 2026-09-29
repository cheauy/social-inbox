import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getMessageImageUrl, isMessageDeleted, resolvePhotoReplyTarget } from "@/lib/inbox/message-actions";
import { fetchInboxImage } from "@/lib/media/inbox-image-source";
import { cachedSignedUrls } from "@/lib/media/signed-urls";
import { TELEGRAM_MESSAGE_MEDIA_BUCKET, telegramMessageMediaStoragePath } from "@/lib/telegram/telegram-message-media";
import type { InboxMessage } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });

/** Same-origin PNG copying and small reply thumbnails. Never accepts a URL from the browser. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const conversationId = params.get("conversationId")?.trim() || "";
  const messageId = params.get("messageId")?.trim() || "";
  const platformMessageId = params.get("platformMessageId")?.trim() || "";
  const photo = params.get("photoIndex");
  if (!conversationId || conversationId.length > 100 || (!messageId && !platformMessageId) ||
      messageId.length > 100 || platformMessageId.length > 500 ||
      (photo !== null && (!/^(0|[1-9]\d*)$/.test(photo) || Number(photo) > 100))) return fail(400, "Invalid photo reference.");
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return fail(access.status, access.error);
  if (!await memberHasPermission(access.member, "conversations", "view")) return fail(403, "You do not have permission to view this conversation.");
  let query = supabaseAdmin.from("messages").select("*").eq("business_id", access.businessId).eq("conversation_id", conversationId);
  query = messageId ? query.eq("id", messageId) : query.eq("platform_message_id", platformMessageId);
  const { data, error } = await query.maybeSingle();
  if (error) return fail(503, "Unable to load this photo.");
  if (!data || isMessageDeleted(data as InboxMessage)) return fail(404, "Photo unavailable.");
  const original = data as InboxMessage;
  const selected = photo === null ? original : resolvePhotoReplyTarget([original], `${original.id}:photo:${photo}`, conversationId);
  if (!selected) return fail(404, "Photo unavailable.");
  let source = getMessageImageUrl(selected);
  if (!source && !["image", "photo"].includes(original.message_type)) return fail(404, "Photo unavailable.");
  try {
    // Private uploads get a fresh signed link. The path comes from the authorized
    // row, not a user URL; incoming CDN albums keep their selected-photo source.
    if (!source || source.startsWith("/api/messages/")) {
      const path = telegramMessageMediaStoragePath({ businessId: access.businessId, messageId: original.id, mediaKind: "photo" });
      const signed = await cachedSignedUrls(TELEGRAM_MESSAGE_MEDIA_BUCKET, [path], 300);
      source = signed[0]?.signedUrl || null;
    }
    if (!source) return fail(404, "Photo unavailable.");
    const input = await fetchInboxImage(source, process.env.NEXT_PUBLIC_SUPABASE_URL);
    const thumbnail = params.get("thumbnail") === "1";
    const make = (size: number) => sharp(input, { limitInputPixels: 40_000_000, animated: false }).rotate()
      .resize(size, size, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    let output = await make(thumbnail ? 112 : 2048);
    // Leave room below the hosting platform's response-size limit.
    if (output.byteLength > 4 * 1024 * 1024) output = await make(1024);
    if (output.byteLength > 4 * 1024 * 1024) return fail(413, "Photo is too large to copy.");
    return new NextResponse(new Uint8Array(output), { headers: {
      "Content-Type": "image/png", "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="tenh-chat-photo.png"',
    } });
  } catch { return fail(404, "Photo unavailable. Open the original image or ask the customer to resend it."); }
}
