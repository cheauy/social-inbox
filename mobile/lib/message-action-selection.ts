import { isMessageDeleted, nativeAlbumImageUrls } from "../../lib/inbox/message-actions";
import type { InboxMessage } from "./types";

export type MessageMedia = { kind: "image" | "video"; uri: string; photoIndex?: number };
export type MessageActionSelection = {
  owner: string;
  messageId: string;
  conversationId: string;
  providerId: string | null;
  media?: MessageMedia;
  photos: string[];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

/** Display media and retain the server's image-only album index. */
export function messageMedia(message: InboxMessage): MessageMedia[] {
  const raw = record(message.raw_payload), native = record(raw.message);
  const nativeAttachments = Array.isArray(native.attachments) ? native.attachments : null;
  const attachments = nativeAttachments ?? (Array.isArray(raw.attachments) ? raw.attachments : []);
  let photoIndex = -1;
  const found = attachments.flatMap((value): MessageMedia[] => {
    const item = record(value), payload = record(item.payload), imageData = record(item.image_data);
    const indexedPhoto = nativeAttachments && item.type === "image" && !payload.sticker_id && typeof payload.url === "string" && payload.url;
    if (indexedPhoto) photoIndex++;
    const uri = text(payload.url) ?? text(imageData.url) ?? text(item.url);
    const kind = text(item.type)?.toLowerCase();
    if (!uri || (kind !== "image" && kind !== "video")) return [];
    return [{ kind, uri, ...(indexedPhoto ? { photoIndex } : {}) }];
  });
  if (message.attachment_url && !found.some(item => item.uri === message.attachment_url)) {
    found.unshift({ kind: message.message_type === "video" ? "video" : "image", uri: message.attachment_url });
  }
  return found;
}

export function selectMessageAction(owner: string, message: InboxMessage, media?: MessageMedia): MessageActionSelection | null {
  if (!owner || isMessageDeleted(message)) return null;
  return { owner, messageId: message.id, conversationId: message.conversation_id,
    providerId: message.platform_message_id, media: media ? { ...media } : undefined,
    photos: nativeAlbumImageUrls(message) };
}

/** Resolve again at dispatch/send time; never substitute a different row or photo. */
export function resolveMessageAction(selection: MessageActionSelection | null, owner: string, messages: readonly InboxMessage[]) {
  if (!selection || !owner || selection.owner !== owner) return null;
  const message = messages.find(row => row.id === selection.messageId && row.conversation_id === selection.conversationId);
  if (!message || message.platform_message_id !== selection.providerId || isMessageDeleted(message)) return null;
  if (!selection.media) return { message, photo: message, media: null, photoNumber: null, photoCount: 0, perPhotoReply: false };
  const selected = selection.media;
  const media = messageMedia(message);
  if (!media.some(item => item.kind === selected.kind && item.uri === selected.uri)) return null;
  const photos = nativeAlbumImageUrls(message);
  let index: number | null = null;
  if (selected.photoIndex !== undefined) {
    const previousMatches = selection.photos.filter(uri => uri === selected.uri).length;
    const matches = photos.flatMap((uri, i) => uri === selected.uri ? [i] : []);
    if (previousMatches === 1 && matches.length === 1) index = matches[0];
    else if (JSON.stringify(selection.photos) === JSON.stringify(photos) && photos[selected.photoIndex] === selected.uri) index = selected.photoIndex;
    else return null; // Duplicate/replaced media cannot be silently retargeted.
  }
  const perPhotoReply = index !== null && photos.length > 1;
  const photo: InboxMessage = { ...message, attachment_url: selected.uri,
    message_type: selected.kind === "video" ? "video" : message.message_type === "sticker" ? "sticker" : "image",
    // Existing server UI-selection contract; the provider MID stays unchanged.
    id: perPhotoReply ? `${message.id}:photo:${index}` : message.id };
  return { message, photo, media: selected, photoNumber: index === null ? null : index + 1,
    photoCount: photos.length, perPhotoReply };
}
