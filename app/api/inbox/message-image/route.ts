import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
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

type FacebookGraphAttachment = {
  type?: string | null;
  image_data?: { url?: string | null } | null;
  video_data?: { url?: string | null } | null;
  file_url?: string | null;
  url?: string | null;
  payload?: { url?: string | null } | null;
  subattachments?: { data?: FacebookGraphAttachment[] | null } | null;
};

function firstFacebookAttachmentUrl(attachments: FacebookGraphAttachment[]): string | null {
  for (const attachment of attachments) {
    const direct = attachment.image_data?.url || attachment.file_url || attachment.video_data?.url || attachment.payload?.url || attachment.url;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const nested = attachment.subattachments?.data;
    if (Array.isArray(nested)) {
      const found = firstFacebookAttachmentUrl(nested);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Meta CDN URLs carried by old webhook rows can expire. Only after the saved
 * source fails, ask Graph for the same authorized message again and use its
 * current attachment URL. The browser never receives the Page access token or
 * the refreshed CDN URL; this route still returns only transformed image bytes.
 */
async function refreshFacebookMessageImage({
  businessId,
  socialAccountId,
  platformMessageId,
  photoIndex = 0,
}: {
  businessId: string;
  socialAccountId: string | null;
  platformMessageId: string | null;
  photoIndex?: number;
}): Promise<string | null> {
  if (!socialAccountId || !platformMessageId) return null;

  const { data: account, error } = await supabaseAdmin
    .from("social_accounts")
    .select("platform,platform_account_id,is_active")
    .eq("id", socialAccountId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error || !account || account.platform !== "facebook" || account.is_active !== true || !account.platform_account_id) return null;

  const token = await getFacebookPageAccessToken(account.platform_account_id);
  const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(platformMessageId)}`);
  url.searchParams.set("fields", "attachments");

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }

  const payload = await response.json().catch(() => null) as { attachments?: { data?: FacebookGraphAttachment[] | null } | FacebookGraphAttachment[] | null } | null;
  const raw = payload?.attachments;
  const attachments = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  const imageUrls = (items:FacebookGraphAttachment[]):string[] => items.flatMap(item => {
    const url = item.image_data?.url || (item.type === "image" ? item.payload?.url : null);
    return url ? [url] : imageUrls(item.subattachments?.data ?? []);
  });
  const urls = imageUrls(attachments);
  return urls[photoIndex] ?? (photoIndex === 0 ? firstFacebookAttachmentUrl(attachments) : null);
}

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
      const mediaKind = original.message_type === "sticker" ? "file" : "photo";
      const index = photo === null ? 0 : Number(photo);
      const album = original.raw_payload?.tenh_image_album as {saved_indices?:number[]} | undefined;
      if (index > 0 && !album?.saved_indices?.includes(index)) return fail(404,"Photo unavailable.");
      const path = telegramMessageMediaStoragePath({ businessId: access.businessId, messageId: original.id, mediaKind }) + (index ? `-${index}` : "");
      const signed = await cachedSignedUrls(TELEGRAM_MESSAGE_MEDIA_BUCKET, [path], 300);
      source = signed[0]?.signedUrl || null;
    }
    if (!source) return fail(404, "Photo unavailable.");
    let input: Uint8Array;
    try {
      input = await fetchInboxImage(source, process.env.NEXT_PUBLIC_SUPABASE_URL);
    } catch (storedSourceError) {
      const freshSource = await refreshFacebookMessageImage({
        businessId: access.businessId,
        socialAccountId: access.conversation.social_account_id,
        platformMessageId: original.platform_message_id,
        photoIndex: photo === null ? 0 : Number(photo),
      }).catch(() => null);
      if (!freshSource || freshSource === source) throw storedSourceError;
      input = await fetchInboxImage(freshSource, process.env.NEXT_PUBLIC_SUPABASE_URL);
    }
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
