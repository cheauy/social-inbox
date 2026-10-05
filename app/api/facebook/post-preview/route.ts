import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFacebookPostIdForComment, getFacebookPostPreview, getFacebookCommentContext, getFacebookPhotoContext } from "@/lib/facebook/get-post-preview";
import { mergePostPreview, record, text, safePostImage, safePostLink, type FacebookCommentParent } from "@/lib/facebook/post-preview-data";
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
      .select("platform,platform_account_id,account_name,is_active,facebook_token_status")
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
      const postIds = /^\d+$/.test(source.post_id) && /^\d+$/.test(pageId)
        ? [`${pageId}_${source.post_id}`, source.post_id]
        : [source.post_id];
      const options = { refresh: params.get("refresh") === "1" };
      let fresh = await getFacebookPostPreview(postIds[0], pageId, options);
      if (!fresh?.full_picture && postIds[1]) {
        const fallback = await getFacebookPostPreview(postIds[1], pageId, options);
        fresh = fallback?.full_picture ? fallback : fresh ?? fallback;
      }
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
    const commentId = text(payload.comment_id) ?? text(payload.reply_comment_id) ?? text(message.platform_message_id);
    const providerContext = commentId ? await getFacebookCommentContext(commentId, pageId) : null;
    const snapshot = record(payload.comment_context), snapshotParent = record(snapshot.parent);
    const snapshotParentId = text(snapshot.parent_id);
    const context = providerContext ?? (snapshot.id === commentId && Object.prototype.hasOwnProperty.call(snapshot, "parent_id") ? {
      object_id: text(snapshot.object_id), permalink_url: safePostLink(snapshot.permalink_url), parent_id: snapshotParentId, parent_resolved: true,
      parent: snapshotParentId && snapshotParent.id === snapshotParentId ? {
        id: snapshotParentId, author: text(snapshotParent.author), text: text(snapshotParent.text),
        image: safePostImage(snapshotParent.image), permalink_url: safePostLink(snapshotParent.permalink_url),
        status: snapshotParent.status === "deleted" ? "deleted" as const : text(snapshotParent.text) ? "available" as const :
          snapshotParent.status === "media" || safePostImage(snapshotParent.image) ? "media" as const : "unavailable" as const,
      } : null,
    } : null);
    let postId = text(payload.post_id) ?? text(record(payload.post).id) ?? text(saved.id);
    const objectId = context?.object_id ?? null;
    // A photo can point to its actual Page story. Never derive a post URL or
    // source identity from the comment ID, photo order, or conversation header.
    const photo = objectId && (!postId || objectId !== postId || !postId.startsWith(`${pageId}_`))
      ? await getFacebookPhotoContext(objectId, pageId) : null;
    const samePost = (left: string, right: string) => left === right ||
      left === `${pageId}_${right}` || right === `${pageId}_${left}`;
    const photoStory = photo?.post_id && (!photo.post_id.includes("_") || photo.post_id.startsWith(`${pageId}_`)) ? photo.post_id : null;
    if (objectId?.startsWith(`${pageId}_`) && !photoStory) postId = objectId;
    if (photoStory) postId = photoStory;
    postId ??= objectId ?? (commentId ? await getFacebookPostIdForComment(commentId, pageId) : null);
    if ((postId?.includes("_") && !postId.startsWith(`${pageId}_`)) || (objectId?.includes("_") && !objectId.startsWith(`${pageId}_`))) {
      return json({ success: true, preview: null, parent: null, parent_id: null, comment_permalink_url: null, available: false });
    }
    const storedParentId = text(payload.parent_comment_id) ?? text(payload.parent_id);
    const storedReplyId = storedParentId && storedParentId !== postId && storedParentId !== objectId ? storedParentId : null;
    const parentId = context ? context.parent_id ?? (context.parent_resolved === false ? storedReplyId : null) : storedReplyId;
    let parent: FacebookCommentParent | null = context?.parent ?? null;
    if (parentId) {
      // Exact parent lookup includes the Page join, so another customer's
      // comment on this Page is available without crossing a tenant or Page.
      const { data: parentMessage } = await supabaseAdmin.from("messages")
        .select("platform_message_id,message_text,message_type,attachment_url,raw_payload,direction,comment_is_deleted,conversation:conversations!inner(social_account_id,business_id)")
        .eq("business_id", access.businessId).eq("platform_message_id", parentId)
        .eq("conversation.social_account_id", access.conversation.social_account_id)
        .eq("conversation.business_id", access.businessId).limit(1).maybeSingle();
      if (parentMessage) {
        const parentPayload = record(parentMessage.raw_payload);
        const parentPost = text(parentPayload.post_id) ?? text(record(parentPayload.post_preview).id);
        if (!parentPost || !postId || samePost(parentPost, postId)) {
          const deleted = parentMessage.comment_is_deleted === true;
          const image = deleted ? null : (parentMessage.message_type === "image" ? safePostImage(parentMessage.attachment_url) : null) ?? safePostImage(record(record(record(parentPayload.attachment).media).image).src);
          const content = deleted || (parentMessage.message_text === "Facebook comment" && !text(parentPayload.message)) ? null : text(parentMessage.message_text);
          parent = { id: parentId, author: text(record(parentPayload.from).name) ?? (parentMessage.direction === "outgoing" ? text(account.account_name) : null) ?? parent?.author ?? null,
            text: content ?? (deleted ? null : parent?.text ?? null), image: image ?? (deleted ? null : parent?.image ?? null),
            permalink_url: safePostLink(record(parentPayload.comment_context).permalink_url ?? parentPayload.permalink_url) ?? parent?.permalink_url ?? null,
            status: deleted ? "deleted" : content ? "available" : image || Object.keys(record(parentPayload.attachment)).length || ["image", "video", "audio", "file"].includes(parentMessage.message_type) ? "media" : parent?.status ?? "unavailable" };
        }
      }
      parent ??= { id: parentId, author: null, text: null, image: null, permalink_url: null, status: "unavailable" };
    }
    if (!postId) return json({ success: true, preview: null, parent, parent_id: parentId, comment_permalink_url: context?.permalink_url ?? null, available: false });
    const fresh = await getFacebookPostPreview(postId, pageId, { refresh: params.get("refresh") === "1" });
    // Read-only: a late repair must not overwrite concurrent comment deletes,
    // pins, replies or reactions in messages.raw_payload.
    const preview = mergePostPreview(text(saved.id) && !samePost(text(saved.id)!, postId) ? null : saved, fresh, postId);
    preview.comment_object_id = objectId && samePost(objectId, postId) ? postId : objectId;
    preview.photo_id = objectId && preview.photos?.some(item => item.id === objectId) ? objectId : null;
    if (photo && photoStory && samePost(photoStory, postId) && photo.full_picture) {
      preview.photos = [{ id: photo.id, src: photo.full_picture, permalink_url: photo.permalink_url }, ...(preview.photos ?? []).filter(item => item.id !== photo.id)];
      preview.photo_id = photo.id;
    }
    return json({ success: true, preview, parent, parent_id: parentId, comment_permalink_url: context?.permalink_url ?? null,
      available: !!(fresh?.message || fresh?.full_picture || preview.photos?.length) });
  } catch {
    return json({ success: false, error: "Post preview temporarily unavailable." }, 503);
  }
}
