import type { InboxMessage } from "../../types/inbox";
import { isFacebookComment, record } from "./message-actions";

/** Customer activity decides the badge, not Page replies or recovery insertion order. */
export function latestCustomerChannel(messages: InboxMessage[], conversationId: string): "comment" | "messenger" | null {
  const incoming = messages.filter(message => message.conversation_id === conversationId &&
    message.direction === "incoming" && !message.id.startsWith("optimistic:") &&
    Boolean(message.platform_message_id) && !message.platform_message_id?.startsWith("telegram:"));
  incoming.sort((a, b) => {
    const time = (message: InboxMessage) => Date.parse(message.platform_created_at || message.created_at) || 0;
    return time(b) - time(a) || b.id.localeCompare(a.id);
  });
  const latest = incoming[0];
  if (!latest) return null;
  // Ad/referral context may contain a post ID, but a native Messenger MID
  // identifies a DM rather than a public comment.
  if (typeof record(record(latest.raw_payload).message).mid === "string") return "messenger";
  return isFacebookComment(latest) ? "comment" : "messenger";
}
