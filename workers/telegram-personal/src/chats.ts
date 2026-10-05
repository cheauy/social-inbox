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

/** A Telegram file the worker may copy into TENH storage (see media-storage.ts). */
export type MediaRef = {
  fileId: number;
  size: number;
  mimeType: string;
  name: string;
  /** messages.message_type once saved. */
  messageType: "image" | "video" | "audio" | "file" | "sticker";
  /** Path segment used by the web media route for this message type. */
  pathKind: "photo" | "video" | "audio" | "file";
  duration: number | null;
};

export type IngestInput = {
  chatId: string;
  messageId: number;
  direction: "incoming" | "outgoing";
  type: "text" | "placeholder";
  body: string | null;
  placeholder: PlaceholderKind | null;
  sentAt: string;
  /** Present only for media messages. */
  media?: MediaRef;
  /** Telegram id of the quoted message in the same chat, when this is a reply. */
  replyTo?: number;
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

type FileObj = { id?: unknown; size?: unknown; expected_size?: unknown };

function fileRef(file: unknown, rest: Omit<MediaRef, "fileId" | "size">): MediaRef | undefined {
  const f = (file ?? {}) as FileObj;
  const id = Number(f.id);
  const size = Number(f.size) || Number(f.expected_size) || 0;
  if (!Number.isSafeInteger(id) || id <= 0) return undefined;
  return { fileId: id, size, ...rest };
}

const num = (value: unknown) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
const str = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : fallback);

/** The file inside a media message, if TENH can show it. Animated stickers stay placeholders. */
export function mediaOf(content: TdObject): MediaRef | undefined {
  switch (content._) {
    case "messagePhoto": {
      const sizes = (((content.photo as TdObject | undefined)?.sizes as TdObject[] | undefined) ?? [])
        .filter((size) => size.photo)
        .sort((a, b) => Number(a.width) * Number(a.height) - Number(b.width) * Number(b.height));
      const largest = sizes[sizes.length - 1];
      return largest ? fileRef(largest.photo, { mimeType: "image/jpeg", name: "photo.jpg", messageType: "image", pathKind: "photo", duration: null }) : undefined;
    }
    case "messageVideo": {
      const v = (content.video ?? {}) as TdObject;
      return fileRef(v.video, { mimeType: str(v.mime_type, "video/mp4"), name: str(v.file_name, "video.mp4"), messageType: "video", pathKind: "video", duration: num(v.duration) });
    }
    case "messageAnimation": {
      const v = (content.animation ?? {}) as TdObject;
      return fileRef(v.animation, { mimeType: str(v.mime_type, "video/mp4"), name: str(v.file_name, "animation.mp4"), messageType: "video", pathKind: "video", duration: num(v.duration) });
    }
    case "messageVideoNote": {
      const v = (content.video_note ?? {}) as TdObject;
      return fileRef(v.video, { mimeType: "video/mp4", name: "video-message.mp4", messageType: "video", pathKind: "video", duration: num(v.duration) });
    }
    case "messageVoiceNote": {
      const v = (content.voice_note ?? {}) as TdObject;
      return fileRef(v.voice, { mimeType: str(v.mime_type, "audio/ogg"), name: "voice.ogg", messageType: "audio", pathKind: "audio", duration: num(v.duration) });
    }
    case "messageAudio": {
      const v = (content.audio ?? {}) as TdObject;
      return fileRef(v.audio, { mimeType: str(v.mime_type, "audio/mpeg"), name: str(v.file_name, "audio.mp3"), messageType: "audio", pathKind: "audio", duration: num(v.duration) });
    }
    case "messageDocument": {
      const v = (content.document ?? {}) as TdObject;
      return fileRef(v.document, { mimeType: str(v.mime_type, "application/octet-stream"), name: str(v.file_name, "file"), messageType: "file", pathKind: "file", duration: null });
    }
    case "messageSticker": {
      const v = (content.sticker ?? {}) as TdObject;
      if ((v.format as TdObject | undefined)?._ !== "stickerFormatWebp") return undefined;
      return fileRef(v.sticker, { mimeType: "image/webp", name: "sticker.webp", messageType: "sticker", pathKind: "file", duration: null });
    }
    default:
      return undefined;
  }
}

/** Telegram id of the quoted message when it is in the same chat. */
export function replyToOf(message: TdObject): number | undefined {
  const reply = message.reply_to as TdObject | undefined;
  if (reply?._ === "messageReplyToMessage") {
    const sameChat = reply.chat_id === undefined || Number(reply.chat_id) === Number(message.chat_id);
    const id = Number(reply.message_id);
    return sameChat && Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }
  const legacy = Number(message.reply_to_message_id);
  return Number.isSafeInteger(legacy) && legacy > 0 ? legacy : undefined;
}

/** Text of a message content (text or caption), for edits. */
export function contentText(content: TdObject | undefined): string {
  if (!content) return "";
  if (content._ === "messageText") return text(content.text) ?? "";
  return text(content.caption) ?? "";
}

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
  const replyTo = replyToOf(message);
  const base = {
    chatId: String(chatId),
    messageId: id,
    direction: message.is_outgoing === true ? ("outgoing" as const) : ("incoming" as const),
    sentAt: new Date(date * 1000).toISOString(),
    ...(replyTo ? { replyTo } : {}),
  };
  if (content._ === "messageText") {
    const body = text(content.text);
    return body ? { ...base, type: "text", body: body.slice(0, 4096), placeholder: null } : null;
  }
  const media = mediaOf(content);
  return {
    ...base,
    type: "placeholder",
    body: text(content.caption)?.slice(0, 4096) ?? null,
    placeholder: PLACEHOLDERS[content._] ?? "other",
    ...(media ? { media } : {}),
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
 * Title and username of a one-to-one chat with a real user, or null for
 * anything else (groups, channels, bots, Saved Messages, Telegram service).
 * Used by automatic sharing, with the same rules as the chat chooser.
 */
export async function personChat(invoke: Invoke, chatId: number, myUserId: number | null): Promise<{ title: string; username: string | null } | null> {
  const chat = await invoke({ _: "getChat", chat_id: chatId }, "get_chat");
  const type = chat.type as TdObject | undefined;
  if (type?._ !== "chatTypePrivate") return null;
  const userId = Number(type.user_id);
  if (userId === myUserId || userId === TELEGRAM_SERVICE_USER_ID) return null;
  const user = await invoke({ _: "getUser", user_id: userId }, "get_user");
  if ((user.type as TdObject | undefined)?._ !== "userTypeRegular") return null;
  return {
    title: String(chat.title ?? "Telegram user").slice(0, 200),
    username: ((user.usernames as { active_usernames?: string[] } | undefined)?.active_usernames ?? [])[0] ?? null,
  };
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
