import { isMessageDeleted, record, type ActionMessage } from "../inbox/message-actions";

// Exact ReactionTypeEmoji values in Bot API; custom and paid reactions excluded.
export const TELEGRAM_REACTION_EMOJIS = ["❤", "👍", "👎", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈", "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿", "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡"] as const;
const emojiSet: ReadonlySet<string> = new Set(TELEGRAM_REACTION_EMOJIS);
export const TELEGRAM_QUICK_REACTIONS = [
  { emoji: "👍", label: "Like" }, { emoji: "❤", label: "Love" },
  { emoji: "😁", label: "Laugh" }, { emoji: "😱", label: "Wow" },
  { emoji: "😢", label: "Sad" }, { emoji: "🤬", label: "Angry" },
  { emoji: "🎉", label: "Celebrate" },
] as const;
export const isTelegramReactionEmoji = (value: unknown): value is string => typeof value === "string" && emojiSet.has(value);

export type TelegramReactionState = {
  status: "idle" | "confirmed" | "pending" | "uncertain";
  emoji: string | null;
  revision: number;
  updatedAt: string;
  groupKey: string;
  chatId: string;
  targetMessageId: string;
};

/** The indexed album domain is a JSON string of 1..64 ASCII digits, without trimming. */
export const isTelegramAlbumId = (value: unknown): value is string => typeof value === "string" &&
  value.length >= 1 && value.length <= 64 && !/[^0-9]/.test(value);

/** Only supported normal private messages with matching stored/native identity. */
export function telegramReactionTarget(message: ActionMessage) {
  if (!message.platform_message_id || message.id.startsWith("optimistic:") || isMessageDeleted(message)) return null;
  const parsed = /^telegram:([1-9]\d{0,15}):([1-9]\d{0,15})$/.exec(message.platform_message_id);
  if (!parsed || !Number.isSafeInteger(Number(parsed[1])) || !Number.isSafeInteger(Number(parsed[2]))) return null;
  const raw = record(message.raw_payload);
  // Any nested JSON object is authoritative, including {}. Null/array wrappers use root.
  const native = raw.message !== null && typeof raw.message === "object" && !Array.isArray(raw.message) ? record(raw.message) : raw;
  const chat = record(native.chat);
  if (chat.type !== "private" || String(chat.id) !== parsed[1] || native.message_id !== Number(parsed[2]) ||
      native.business_connection_id || raw.business_connection_id || !["text", "image", "video", "audio", "voice", "file", "sticker", "location"].includes(message.message_type ?? "")) return null;
  // A supported content field excludes service-only and malformed payloads.
  if (!["text", "photo", "video", "animation", "audio", "voice", "document", "sticker", "location"].some(key => native[key] != null)) return null;
  const albumId = native.media_group_id;
  if (albumId !== undefined && !isTelegramAlbumId(albumId)) return null;
  return { chatId: parsed[1], nativeMessageId: Number(parsed[2]), albumId: typeof albumId === "string" ? albumId : null,
    groupKey: typeof albumId === "string" ? `a:${albumId}` : `m:${parsed[2]}` };
}

export function getTelegramReaction(raw: unknown): TelegramReactionState | null {
  const value = record(record(raw).tenh_telegram_reaction);
  if (!["idle", "confirmed", "pending", "uncertain"].includes(String(value.status)) ||
      !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
      (value.emoji !== null && !isTelegramReactionEmoji(value.emoji)) ||
      typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || typeof value.groupKey !== "string" ||
      typeof value.chatId !== "string" || typeof value.targetMessageId !== "string") return null;
  return value as TelegramReactionState;
}

export function telegramAllowedReactions(chat: { available_reactions?: unknown }) {
  if (chat.available_reactions === undefined) return [...TELEGRAM_REACTION_EMOJIS];
  if (!Array.isArray(chat.available_reactions)) return [];
  return [...new Set(chat.available_reactions.flatMap(item => {
    const reaction = record(item);
    return reaction.type === "emoji" && isTelegramReactionEmoji(reaction.emoji) ? [reaction.emoji] : [];
  }))];
}
