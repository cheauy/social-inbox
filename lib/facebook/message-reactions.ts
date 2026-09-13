import { isFacebookComment, isMessageDeleted, record, type ActionMessage } from "../inbox/message-actions";

export const MESSENGER_QUICK_REACTIONS = [
  { emoji: "👍", label: "Like" }, { emoji: "❤️", label: "Love" },
  { emoji: "😂", label: "Laugh" }, { emoji: "😮", label: "Wow" },
  { emoji: "😢", label: "Sad" }, { emoji: "😡", label: "Angry" },
  { emoji: "🎉", label: "Celebrate" },
] as const;

export type MessengerReactionActor = "page" | "customer";
export type MessengerReaction = { emoji: string | null; timestamp: number; member_id?: string };

/** One emoji grapheme, including flags, skin tones, keycaps and ZWJ families. */
export function isMessengerReactionEmoji(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64 || value !== value.trim()) return false;
  if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value)) return false;
  return Array.from(new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)).length === 1;
}

export function canReactToMessengerMessage(message: ActionMessage, platform?: string | null) {
  return (platform === "facebook" || platform === "messenger") &&
    Boolean(message.platform_message_id) && !message.platform_message_id.startsWith("telegram:") &&
    !message.id.startsWith("optimistic:") && !isFacebookComment(message) && !isMessageDeleted(message);
}

export function getMessengerReaction(raw: unknown, actor: MessengerReactionActor): MessengerReaction | null {
  const stored = record(record(record(raw).tenh_messenger_reactions)[actor]);
  if (!Number.isFinite(stored.timestamp) || (stored.emoji !== null && !isMessengerReactionEmoji(stored.emoji))) return null;
  return stored as MessengerReaction;
}

/** A removal retains its timestamp so a delayed webhook cannot restore it. */
export function withMessengerReaction(raw: unknown, actor: MessengerReactionActor, reaction: MessengerReaction) {
  const current = getMessengerReaction(raw, actor);
  if (current && current.timestamp > reaction.timestamp) return record(raw);
  return { ...record(raw), tenh_messenger_reactions: {
    ...record(record(raw).tenh_messenger_reactions), [actor]: reaction,
  } };
}

export function messengerReactionPayload(psid: string, messageId: string, emoji: string | null) {
  return {
    recipient: { id: psid },
    sender_action: emoji === null ? "unreact" : "react",
    payload: { message_id: messageId, ...(emoji === null ? {} : { reaction: emoji }) },
  };
}

export function messengerWebhookEmoji(reaction: { emoji?: string; reaction?: string }) {
  if (isMessengerReactionEmoji(reaction.emoji)) return reaction.emoji;
  const names: Record<string, string> = { smile: "😆", angry: "😠", sad: "😢", wow: "😮", love: "❤️", like: "👍", dislike: "👎" };
  return names[reaction.reaction ?? ""] ?? null;
}
