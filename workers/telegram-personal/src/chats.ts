import type { TdObject } from "./tdlib-port.ts";

/*
 * D1: one-to-one text chats only. Media and other content types are stored as
 * a placeholder (kind + caption) so nobody misses a message; files are never
 * downloaded in D1. Groups, channels, bots, Saved Messages and Telegram's own
 * service account are excluded.
 */

export const TELEGRAM_SERVICE_USER_ID = 777000;

export type PlaceholderKind =
  | "photo" | "video" | "voice" | "video_note" | "sticker" | "file" | "audio" | "gif"
  | "location" | "contact" | "poll" | "other";

export type IngestInput = {
  chatId: string;
  messageId: number;
  direction: "incoming" | "outgoing";
  type: "text" | "placeholder";
  body: string | null;
  placeholder: PlaceholderKind | null;
  sentAt: string;
};

export type ChatSummary = {
  chat_id: string;
  title: string;
  username: string | null;
  last_message_at: string | null;
};

const PLACEHOLDERS: Record<string, PlaceholderKind> = {
  messagePhoto: "photo",
  messageVideo: "video",
  messageVoiceNote: "voice",
  messageVideoNote: "video_note",
  messageSticker: "sticker",
  messageDocument: "file",
  messageAudio: "audio",
  messageAnimation: "gif",
  messageLocation: "location",
  messageVenue: "location",
  messageContact: "contact",
  messagePoll: "poll",
};

// Service notices that are not part of the conversation.
const SKIPPED_CONTENT = new Set([
  "messageContactRegistered",
  "messageScreenshotTaken",
  "messageChatSetMessageAutoDeleteTime",
  "messageChatSetTheme",
  "messageChatSetBackground",
  "messageExpiredPhoto",
  "messageExpiredVideo",
  "messageExpiredVideoNote",
  "messageExpiredVoiceNote",
]);

function text(value: unknown): string | null {
  const t = (value as { text?: unknown } | undefined)?.text;
  return typeof t === "string" && t.length ? t : null;
}

/** Returns null for messages that must not be stored (still sending, service notices). */
export function mapMessage(message: TdObject): IngestInput | null {
  if (message.sending_state) return null; // pending local send: D2 reconciles these
  const id = Number(message.id);
  const chatId = Number(message.chat_id);
  const date = Number(message.date);
  if (!Number.isSafeInteger(id) || !Number.isSafeInteger(chatId) || !Number.isFinite(date) || date <= 0) return null;
  const content = (message.content ?? {}) as TdObject;
  if (SKIPPED_CONTENT.has(content._)) return null;
  const base = {
    chatId: String(chatId),
    messageId: id,
    direction: message.is_outgoing === true ? ("outgoing" as const) : ("incoming" as const),
    sentAt: new Date(date * 1000).toISOString(),
  };
  if (content._ === "messageText") {
    const body = text(content.text);
    return body ? { ...base, type: "text", body: body.slice(0, 4096), placeholder: null } : null;
  }
  return {
    ...base,
    type: "placeholder",
    body: text(content.caption)?.slice(0, 4096) ?? null,
    placeholder: PLACEHOLDERS[content._] ?? "other",
  };
}

type Invoke = (request: TdObject, operation: string) => Promise<TdObject>;

/** The holder's recent one-to-one chats with real users, newest first. */
export async function listPrivateChats(invoke: Invoke, myUserId: number | null, limit = 100): Promise<ChatSummary[]> {
  try {
    await invoke({ _: "loadChats", chat_list: { _: "chatListMain" }, limit }, "load_chats");
  } catch {
    // 404 means every chat is already loaded; other errors surface on getChats.
  }
  const result = await invoke({ _: "getChats", chat_list: { _: "chatListMain" }, limit }, "get_chats");
  const ids = Array.isArray(result.chat_ids) ? (result.chat_ids as number[]).slice(0, limit) : [];
  const chats: ChatSummary[] = [];
  for (const id of ids) {
    const chat = await invoke({ _: "getChat", chat_id: id }, "get_chat");
    const type = chat.type as TdObject | undefined;
    if (type?._ !== "chatTypePrivate") continue;
    const userId = Number(type.user_id);
    if (userId === myUserId || userId === TELEGRAM_SERVICE_USER_ID) continue;
    const user = await invoke({ _: "getUser", user_id: userId }, "get_user");
    if ((user.type as TdObject | undefined)?._ !== "userTypeRegular") continue;
    const lastDate = Number((chat.last_message as TdObject | undefined)?.date);
    chats.push({
      chat_id: String(id),
      title: String(chat.title ?? "Telegram user").slice(0, 200),
      username: ((user.usernames as { active_usernames?: string[] } | undefined)?.active_usernames ?? [])[0] ?? null,
      last_message_at: Number.isFinite(lastDate) && lastDate > 0 ? new Date(lastDate * 1000).toISOString() : null,
    });
  }
  return chats.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
}

/**
 * Up to `limit` most recent messages of one chat, newest first, in pages of at
 * most 50. With offset 0 TDLib starts each page at from_message_id itself, so
 * repeated ids are skipped.
 */
export async function loadHistory(invoke: Invoke, chatId: string, limit: number): Promise<TdObject[]> {
  const out: TdObject[] = [];
  const seen = new Set<number>();
  let fromMessageId = 0;
  for (let page = 0; page < 6 && out.length < limit; page += 1) {
    const result = await invoke({
      _: "getChatHistory",
      chat_id: Number(chatId),
      from_message_id: fromMessageId,
      offset: 0,
      limit: Math.min(50, limit - out.length + (fromMessageId ? 1 : 0)),
      only_local: false,
    }, "get_chat_history");
    const messages = (Array.isArray(result.messages) ? (result.messages as TdObject[]) : [])
      .filter((message) => !seen.has(Number(message.id)));
    if (!messages.length) break;
    for (const message of messages) seen.add(Number(message.id));
    out.push(...messages);
    const last = Number(messages[messages.length - 1].id);
    if (!Number.isSafeInteger(last)) break;
    fromMessageId = last;
  }
  return out.slice(0, limit);
}
