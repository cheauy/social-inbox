import type { InboxMessage } from "../../types/inbox";

/** Shared UI/server policy. Pins are TENH bookmarks, not provider chat pins. */
export type ActionMessage = Pick<InboxMessage,
  "id" | "platform_message_id" | "conversation_id" | "direction" |
  "message_type" | "message_text" | "attachment_url" | "raw_payload"
> & Partial<Pick<InboxMessage, "comment_is_deleted" | "comment_deleted_by">>;

export const MESSAGE_ROW_CHANGED_EVENT = "tenh:message-row-changed";
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function isFacebookComment(message: ActionMessage): boolean {
  const raw = record(message.raw_payload);
  return Boolean(raw.comment_id || raw.post_id || raw.parent_comment_id ||
    raw.reply_comment_id || raw.item === "comment" ||
    raw.source === "facebook_comment_reply" || raw.tenh_source === "facebook_page_reply");
}

export function isMessageDeleted(message: ActionMessage): boolean {
  const raw = record(message.raw_payload);
  return Boolean(raw.tenh_deleted || message.comment_is_deleted ||
    record(raw.message).is_deleted || raw.is_deleted ||
    /^message deleted(?: by .+)?$/i.test(text(message.message_text).replace(/^🗑\s*/u, "")));
}

export function getMessageActions(message: ActionMessage, platform?: string | null) {
  const none = { reply: false, pin: false, edit: false, delete: false };
  if (message.id.startsWith("optimistic:") || !message.platform_message_id ||
    isMessageDeleted(message) || isFacebookComment(message)) return none;
  const telegram = platform === "telegram" || message.platform_message_id.startsWith("telegram:");
  if (telegram) {
    const raw = record(message.raw_payload);
    const native = Object.keys(record(raw.message)).length ? record(raw.message) : raw;
    const plainText = message.message_type === "text" && !message.attachment_url &&
      !raw.tenh_location && !raw.tenh_attachment && !raw.tenh_sticker &&
      !["photo", "video", "document", "voice", "audio", "animation", "sticker", "location"].some((key) => native[key]);
    const ownText = message.direction === "outgoing" && plainText;
    return { reply: true, pin: true, edit: ownText && Boolean(text(message.message_text)), delete: true };
  }
  if (platform === "facebook" || platform === "messenger") {
    return { reply: true, pin: true, edit: false, delete: false };
  }
  return none;
}

export function getMessageSummary(message: ActionMessage): string {
  if (isMessageDeleted(message)) return getDeletedMessageText(message);
  const value = text(message.message_text);
  const mediaPlaceholder = message.message_type !== "text" && /^\[(?:image|photo|video|audio|voice|file|document|sticker)\]$/i.test(value);
  if (value && !mediaPlaceholder) return value;
  const labels: Record<string, string> = { image: "Photo", photo: "Photo", video: "Video", file: "File", document: "File", audio: "Audio", voice: "Voice message", sticker: "Sticker", location: "Location", text: "Message" };
  return labels[message.message_type] || "Message";
}

export function getDeletedMessageText(
  message: Pick<ActionMessage, "raw_payload" | "message_text">,
  options: { customerName?: string | null; teamMembers?: Array<{ id: string; full_name: string }> } = {},
): string {
  const deleted = record(record(message.raw_payload).tenh_deleted);
  const source = text(deleted.source);
  // Actor is explicit metadata, NEVER inferred from the message direction.
  const memberId = text(deleted.deleted_by_member_id);
  const memberName = options.teamMembers?.find((member) => member.id === memberId)?.full_name;
  const storedName = text(deleted.deleted_by_name) || text(deleted.deleted_by_member_name) || text(deleted.deleted_by_customer_name);
  if (source === "tenh") return `Message deleted by ${storedName || text(memberName) || "TENH team member"}`;
  if (source === "customer") return `Message deleted by ${storedName || text(options.customerName) || "customer"}`;
  // Telegram "not found" is not evidence of WHO deleted it.
  if (source === "telegram" || source === "unknown") return "Message deleted";
  const existing = text(message.message_text).replace(/^🗑\s*/u, "");
  return /^message deleted(?: by .+)?$/i.test(existing) ? existing : "Message deleted";
}

export function getMessagePin(message: Pick<ActionMessage, "raw_payload">) {
  return record(record(message.raw_payload).tenh_message_pin);
}
export function isMessagePinned(message: ActionMessage): boolean {
  return getMessagePin(message).pinned === true && !isMessageDeleted(message);
}

/** A photo within one Messenger message is a UI selection, not a database ID. */
export function parsePhotoReplyId(value: string) {
  const match = /^(.*):photo:(0|[1-9]\d*)$/.exec(value);
  const index = match ? Number(match[2]) : null;
  return { messageId: match ? match[1] : value,
    photoIndex: index };
}

export function nativeAlbumImageUrls(message: ActionMessage): string[] {
  if (isMessageDeleted(message)) return [];
  const raw = record(message.raw_payload);
  const attachments = record(raw.message).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap(attachment => {
    const item = record(attachment), payload = record(item.payload);
    return item.type === "image" && !payload.sticker_id && typeof payload.url === "string" && payload.url
      ? [payload.url] : [];
  });
}

export function getMessageImageUrl(message: ActionMessage): string | null {
  if (isMessageDeleted(message)) return null;
  const { photoIndex } = parsePhotoReplyId(message.id);
  const photos = nativeAlbumImageUrls(message);
  if (photoIndex !== null) return photos[photoIndex] ?? null;
  if (["image", "photo"].includes(message.message_type)) return message.attachment_url || photos[0] || null;
  return photos[0] ?? null;
}

/** Preserve each photo's selection ID, while sharing the provider's real MID. */
export function expandAlbumPhotos<T extends ActionMessage>(message: T): T[] {
  const urls = nativeAlbumImageUrls(message);
  return urls.length > 1 ? urls.map((url, index) => ({
    ...message, id: `${message.id}:photo:${index}`, attachment_url: url,
    message_type: "image" as T["message_type"],
  })) : [];
}

export function resolvePhotoReplyTarget<T extends ActionMessage>(
  messages: readonly T[], selectionId: string | null | undefined, conversationId?: string | null,
): T | null {
  if (!selectionId) return null;
  const { messageId, photoIndex } = parsePhotoReplyId(selectionId);
  const target = messages.find(row => row.id === messageId && (!conversationId || row.conversation_id === conversationId));
  if (!target) return null;
  if (photoIndex === null) return target;
  if (!Number.isSafeInteger(photoIndex) || photoIndex < 0) return null;
  return expandAlbumPhotos(target)[photoIndex] ?? null;
}

export function createReplyContext(message: ActionMessage, scope: "tenh" | "telegram" | "facebook") {
  const { messageId, photoIndex } = parsePhotoReplyId(message.id);
  const imageUrl = getMessageImageUrl(message);
  return {
    reply_to_local_message_id: messageId,
    reply_to_platform_message_id: message.platform_message_id,
    preview_text: getMessageSummary(message).slice(0, 500),
    preview_type: message.message_type,
    ...(imageUrl ? { preview_image_url: imageUrl } : {}),
    ...(photoIndex !== null ? { preview_image_index: photoIndex } : {}),
    scope,
  };
}

export type ReplyImageReference = {
  conversationId: string;
  messageId?: string | null;
  platformMessageId?: string | null;
  photoIndex?: number | null;
  url?: string | null;
};

/** Resolve quotes even when their original photo is outside the loaded page. */
export function getReplyImageReference(message: ActionMessage, messages: readonly ActionMessage[]): ReplyImageReference | null {
  const raw = record(message.raw_payload), saved = record(raw.tenh_reply);
  if (raw.tenh_reply_fallback || isMessageDeleted(message)) return null;
  const native = record(raw.message), telegram = record(native.reply_to_message ?? raw.reply_to_message);
  const facebookMid = text(record(native.reply_to ?? raw.reply_to).mid);
  const captured = record(raw.tenh_facebook_reply);
  const validCaptured = captured.platformMessageId === facebookMid && captured.conversationId === message.conversation_id;
  const chatId = /^telegram:([^:]+):/.exec(message.platform_message_id ?? "")?.[1];
  const telegramMid = chatId && telegram.message_id != null ? `telegram:${chatId}:${telegram.message_id}` : "";
  const platformMessageId = facebookMid || text(saved.reply_to_platform_message_id) || telegramMid;
  const messageId = text(saved.reply_to_local_message_id);
  const original = messages.find(row => row.conversation_id === message.conversation_id &&
    ((platformMessageId && row.platform_message_id === platformMessageId) || (!platformMessageId && messageId && row.id === messageId)));
  if (original && isMessageDeleted(original)) return null;
  const savedMatches = !platformMessageId || saved.reply_to_platform_message_id === platformMessageId;
  const photoIndex = savedMatches && Number.isSafeInteger(saved.preview_image_index) && Number(saved.preview_image_index) >= 0
    ? Number(saved.preview_image_index) : null;
  const selected = original && photoIndex !== null ? expandAlbumPhotos(original)[photoIndex] : original;
  const url = selected ? getMessageImageUrl(selected) : null;
  const previewType = savedMatches ? text(saved.preview_type) : "";
  const capturedPhoto = validCaptured && ["image", "photo"].includes(text(captured.messageType));
  const hasPhoto = Boolean(url || ["image", "photo"].includes(previewType) || Array.isArray(telegram.photo) || capturedPhoto);
  if (!hasPhoto || (!messageId && !platformMessageId && !original)) return null;
  // When the original is not loaded, use the authorized endpoint instead of
  // trusting a stale signed URL or arbitrary provider-supplied quote URL.
  return { conversationId: message.conversation_id, messageId: original?.id || messageId || null,
    platformMessageId: platformMessageId || null, photoIndex, url };
}

export function inboxImageEndpoint(reference: ReplyImageReference, thumbnail = false) {
  const params = new URLSearchParams({ conversationId: reference.conversationId });
  if (reference.messageId) {
    const parsed = parsePhotoReplyId(reference.messageId);
    params.set("messageId", parsed.messageId);
    if (parsed.photoIndex !== null) params.set("photoIndex", String(parsed.photoIndex));
  } else if (reference.platformMessageId) params.set("platformMessageId", reference.platformMessageId);
  if (reference.photoIndex != null) params.set("photoIndex", String(reference.photoIndex));
  if (thumbnail) params.set("thumbnail", "1");
  return `/api/inbox/message-image?${params.toString()}`;
}
