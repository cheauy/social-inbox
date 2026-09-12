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
    return { reply: true, pin: ownText, edit: ownText && Boolean(text(message.message_text)), delete: true };
  }
  if (platform === "facebook" || platform === "messenger") {
    return { reply: true, pin: true, edit: false, delete: false };
  }
  return none;
}

export function getMessageSummary(message: ActionMessage): string {
  if (isMessageDeleted(message)) return getDeletedMessageText(message);
  const value = text(message.message_text);
  if (value) return value;
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

export function createReplyContext(message: ActionMessage, scope: "tenh" | "telegram") {
  return {
    reply_to_local_message_id: message.id,
    reply_to_platform_message_id: message.platform_message_id,
    preview_text: getMessageSummary(message).slice(0, 500),
    preview_type: message.message_type,
    scope,
  };
}
