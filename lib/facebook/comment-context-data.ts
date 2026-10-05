import type { InboxMessage } from "@/types/inbox";
import { record, text, safePostImage, safePostLink, type FacebookCommentParent } from "./post-preview-data";

export function facebookCommentIdentity(message: InboxMessage) {
  const payload = record(message.raw_payload);
  const postId = text(payload.post_id) ?? text(record(payload.post).id) ?? text(record(payload.post_preview).id);
  const rawParent = text(payload.parent_comment_id) ?? text(payload.parent_id);
  const context = record(payload.comment_context);
  const preview = record(payload.post_preview);
  const verified = context.id === message.platform_message_id && Object.prototype.hasOwnProperty.call(context, "parent_id");
  const candidateParent = verified ? text(context.parent_id) : rawParent;
  const parentId = candidateParent && candidateParent !== postId ? candidateParent : null;
  const isComment = message.message_type === "comment" || !!(text(payload.comment_id) || text(payload.reply_comment_id) || text(payload.post_id) || text(payload.parent_comment_id) ||
    payload.item === "comment" || payload.source === "facebook_comment" || payload.source === "facebook_comment_reply" || payload.tenh_source === "facebook_page_reply");
  const objectId = text(preview.photo_id) ?? (context.id === message.platform_message_id ? text(context.object_id) : null) ?? text(preview.comment_object_id);
  const singlePost = preview.attachments_complete === true && Array.isArray(preview.photos) && preview.photos.length <= 1;
  return { postId, parentId, isComment, sourceKey: objectId ?? (singlePost ? postId : null) };
}

function loadedParent(message: InboxMessage, messages: InboxMessage[]) {
  const identity = facebookCommentIdentity(message);
  if (!identity.parentId) return null;
  return messages.find(candidate => {
    const parent = facebookCommentIdentity(candidate);
    return candidate.conversation_id === message.conversation_id && candidate.platform_message_id === identity.parentId &&
      parent.isComment && !(identity.postId && parent.postId && identity.postId !== parent.postId);
  }) ?? null;
}

/** Stop at the first loaded ancestor; a missing root never hides its subtree. */
export function facebookCommentRenderRoot(message: InboxMessage, messages: InboxMessage[], states: Record<string, { deleted?: boolean }> = {}) {
  let current = message;
  const visited = new Set<string>([message.id]);
  while (true) {
    const parent = loadedParent(current, messages);
    if (!parent || (states[parent.id]?.deleted ?? parent.comment_is_deleted)) return current;
    if (visited.has(parent.id)) return message;
    visited.add(parent.id);
    current = parent;
  }
}

export function facebookCommentParentPreview(message: InboxMessage, messages: InboxMessage[], pageName: string,
  states: Record<string, { deleted?: boolean }> = {}): FacebookCommentParent | null {
  const { parentId } = facebookCommentIdentity(message);
  if (!parentId) return null;
  const parent = loadedParent(message, messages);
  if (parent) {
    const payload = record(parent.raw_payload), attachment = record(payload.attachment);
    const deleted = states[parent.id]?.deleted ?? parent.comment_is_deleted;
    const image = deleted ? null : (parent.message_type === "image" ? safePostImage(parent.attachment_url) : null) ?? safePostImage(record(record(attachment.media).image).src);
    const messageText = deleted ? null : facebookCommentText(parent.message_text, payload);
    return { id: parentId, author: text(record(payload.from).name) ?? (parent.direction === "outgoing" ? pageName : null),
      text: messageText, image, permalink_url: safePostLink(record(payload.comment_context).permalink_url ?? payload.permalink_url),
      status: deleted ? "deleted" : messageText ? "available" : image || Object.keys(attachment).length || ["image", "video", "audio", "file"].includes(parent.message_type) ? "media" : "unavailable" };
  }
  const context = record(record(message.raw_payload).comment_context), saved = record(context.parent);
  if (text(saved.id) !== parentId) return null;
  return { id: parentId, author: text(saved.author), text: text(saved.text), image: safePostImage(saved.image),
    permalink_url: safePostLink(saved.permalink_url), status: saved.status === "deleted" ? "deleted" :
      text(saved.text) ? "available" : safePostImage(saved.image) ? "media" : "unavailable" };
}

/** Ingestion's no-text placeholder is not a provider comment body. */
export function facebookCommentText(value: unknown, payload: Record<string, unknown>): string | null {
  const content = text(value);
  return content === "Facebook comment" && !text(payload.message) ? null : content;
}
