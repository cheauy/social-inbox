import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFacebookPostIdForComment, getFacebookPostPreview } from "@/lib/facebook/get-post-preview";
import { mergePostPreview, record, text } from "@/lib/facebook/post-preview-data";
import { messengerSourceFromEvent, readMessengerSources } from "@/lib/facebook/messenger-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Resolve context from an authorized message, never a client-supplied post/URL/token. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const conversationId = params.get("conversationId")?.trim() ?? "";
  const messageId = params.get("messageId")?.trim() ?? "";
  if (!conversationId || conversationId.length > 100 || !messageId || messageId.length > 100) return json({ success: false, error: "Invalid comment reference." }, 400);
  try {
    const access = await getInboxConversationAccess(conversationId);
    if (!access.success) return json({ success: false, error: access.error }, access.status);
    if (!await memberHasPermission(access.member, "conversations", "view")) return json({ success: false, error: "Not allowed to view this conversation." }, 403);
    const { data: message, error } = await supabaseAdmin.from("messages")
      .select("id,platform_message_id,message_type,direction,raw_payload,comment_is_deleted")
      .eq("id", messageId).eq("conversation_id", conversationId).eq("business_id", access.businessId).maybeSingle();
    if (error) return json({ success: false, error: "Unable to load comment context." }, 503);
    if (!message || message.comment_is_deleted) return json({ success: false, error: "Comment unavailable." }, 404);
    const { data: account, error: accountError } = await supabaseAdmin.from("social_accounts")
      .select("platform,platform_account_id,is_active,facebook_token_status")
      .eq("id", access.conversation.social_account_id).eq("business_id", access.businessId).maybeSingle();
    if (accountError) return json({ success: false, error: "Unable to load the Page." }, 503);
    if (!account || account.platform !== "facebook" || !account.is_active || account.facebook_token_status === "disconnected") return json({ success: false, error: "Facebook Page unavailable." }, 404);
    const payload = record(message.raw_payload);
    const saved = record(payload.post_preview);
    if (params.get("source") === "1") {
      if (message.direction !== "incoming") return json({ success: false, error: "Incoming source required." }, 400);
      const { data: conversation, error: sourceError } = await supabaseAdmin.from("conversations")
        .select("facebook_messenger_sources").eq("id", conversationId).eq("business_id", access.businessId).maybeSingle();
      if (sourceError) return json({ success: false, error: "Unable to load source context." }, 503);
      const embedded = messengerSourceFromEvent(payload);
      const sources = [...readMessengerSources(conversation?.facebook_messenger_sources), ...(embedded ? [{ ...embedded, message_id: embedded.message_id ?? message.platform_message_id }] : [])];
      const source = sources.findLast(item => item.message_id === message.platform_message_id && item.post_id);
      const pageId = text(account.platform_account_id);
      if (!source?.post_id || !pageId) return json({ success: true, preview: null, available: false });
      const fresh = await getFacebookPostPreview(source.post_id, pageId, { refresh: params.get("refresh") === "1" });
      // Source IDs come only from this authorized message's exact referral.
      return json({ success: true, preview: fresh, available: !!fresh?.full_picture });
    }
    const isComment = message.message_type === "comment" || payload.source === "facebook_comment" ||
      payload.source === "facebook_comment_reply" || payload.tenh_source === "facebook_page_reply" ||
      payload.source_type === "comment" || payload.item === "comment" ||
      !!text(payload.comment_id) || !!text(payload.post_id) || !!text(payload.parent_comment_id) || !!text(payload.reply_comment_id);
    if (!isComment) return json({ success: false, error: "This message is not a Facebook comment." }, 400);
    const pageId = text(account.platform_account_id);
    if (!pageId) return json({ success: false, error: "Facebook Page unavailable." }, 404);
    const postId = text(payload.post_id) ?? text(record(payload.post).id) ?? text(saved.id) ??
      await getFacebookPostIdForComment(text(payload.comment_id) ?? message.platform_message_id ?? "", pageId);
    if (!postId) return json({ success: true, preview: null, available: false });
    const fresh = await getFacebookPostPreview(postId, pageId, { refresh: params.get("refresh") === "1" });
    // Read-only: a late repair must not overwrite concurrent comment deletes,
    // pins, replies or reactions in messages.raw_payload.
    const preview = mergePostPreview(saved, fresh, postId);
    return json({ success: true, preview, available: !!(fresh?.message || fresh?.full_picture) });
  } catch {
    return json({ success: false, error: "Post preview temporarily unavailable." }, 503);
  }
}
