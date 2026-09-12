import type { InboxMessage } from "../../types/inbox";
import { record, isMessageDeleted, getMessageSummary } from "../inbox/message-actions";
export function facebookReplyTarget(rawPayload: unknown): string | null {
  const raw = record(rawPayload); const msg = record(raw.message);
  const id = record(msg.reply_to ?? raw.reply_to).mid;
  return typeof id === "string" && id.trim() && id.length <= 500 ? id.trim() : null;
}
export function facebookNativeReply(message: InboxMessage, messages: InboxMessage[]) {
  // Telegram uses a different native reply object; never mix the protocols.
  if (message.platform_message_id?.startsWith("telegram:")) return null;
  const id = facebookReplyTarget(message.raw_payload);
  if (!id || id === message.platform_message_id) return null;
  const original = messages.find(row => row.conversation_id === message.conversation_id && row.platform_message_id === id);
  if (original) return {
    platformMessageId: id, localMessageId: original.id,
    text: getMessageSummary(original).slice(0, 500), kind: isMessageDeleted(original) ? "Deleted message" : "Message",
  };
  const saved = record(record(message.raw_payload).tenh_facebook_reply);
  const valid = saved.platformMessageId === id && saved.conversationId === message.conversation_id;
  return { platformMessageId: id, localMessageId: null,
    text: valid && typeof saved.text === "string" ? saved.text : "Original message is not available in TENH.", kind: "Message" };
}
