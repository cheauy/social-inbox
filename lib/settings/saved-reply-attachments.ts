import "server-only";

import { TELEGRAM_MESSAGE_MEDIA_BUCKET } from "@/lib/telegram/telegram-message-media";
import type {
  SavedReplyAttachment,
  SavedReplyAttachmentType,
} from "@/types/inbox";

/*
 * Media saved alongside a quick reply.
 *
 * Files live in the bucket the Inbox already uses for message media, under a
 * saved-replies/<businessId>/ prefix. Reusing it keeps one private bucket, one
 * retention story and one set of storage rules, and the prefix is what scopes a
 * file to a workspace: every read checks the caller's business against it, so a
 * path from one workspace can never be served to another.
 */
export const SAVED_REPLY_MEDIA_BUCKET =
  TELEGRAM_MESSAGE_MEDIA_BUCKET;

export const SAVED_REPLY_MEDIA_PREFIX =
  "saved-replies";

/*
 * Meta caps Messenger attachments at 25 MB and Telegram's Bot API at 50 MB for
 * a send. 20 MB keeps a quick reply comfortably sendable on both, which matters
 * more here than on a one-off upload: a quick reply is meant to be reusable,
 * and one that fails on a channel is worse than one that was never allowed.
 */
export const SAVED_REPLY_MEDIA_MAX_BYTES =
  20 * 1024 * 1024;

/*
 * Images may be grouped into an album on send, so several are useful. A video
 * is sent on its own -- neither channel groups video with anything else -- so
 * allowing more than one would promise a delivery that cannot happen.
 */
export const SAVED_REPLY_MAX_IMAGES = 10;
export const SAVED_REPLY_MAX_VIDEOS = 1;

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

/* One shape for this, shared with the client through types/inbox. */
export type {
  SavedReplyAttachment,
  SavedReplyAttachmentType as SavedReplyAttachmentKind,
} from "@/types/inbox";

export function attachmentKindFor(
  mimeType: string,
): SavedReplyAttachmentType | null {
  const normalized = mimeType
    .trim()
    .toLowerCase();

  if (IMAGE_TYPES.has(normalized)) {
    return "image";
  }

  if (VIDEO_TYPES.has(normalized)) {
    return "video";
  }

  return null;
}

export function supportedMediaTypes() {
  return [...IMAGE_TYPES, ...VIDEO_TYPES];
}

/** Storage paths are the workspace boundary, so check the prefix on every read. */
export function isPathOwnedByBusiness(
  path: string,
  businessId: string,
) {
  return path.startsWith(
    `${SAVED_REPLY_MEDIA_PREFIX}/${businessId}/`,
  );
}

/**
 * Read attachments back out of the jsonb column.
 *
 * Anything malformed is dropped rather than thrown on: a quick reply whose
 * media cannot be read should still send its text, and a stored row is not a
 * place to discover a type error.
 */
export function parseAttachments(
  value: unknown,
): SavedReplyAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: SavedReplyAttachment[] = [];

  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object"
    ) {
      continue;
    }

    const item = entry as Record<
      string,
      unknown
    >;
    const path =
      typeof item.path === "string"
        ? item.path
        : "";
    const kind =
      item.kind === "image" ||
      item.kind === "video"
        ? item.kind
        : null;

    if (!path || !kind) {
      continue;
    }

    parsed.push({
      path,
      kind,
      name:
        typeof item.name === "string"
          ? item.name
          : "attachment",
      size:
        typeof item.size === "number" &&
        Number.isFinite(item.size)
          ? item.size
          : 0,
      mimeType:
        typeof item.mimeType === "string"
          ? item.mimeType
          : kind === "image"
            ? "image/jpeg"
            : "video/mp4",
    });
  }

  return parsed;
}

/**
 * Validate what a create or edit is trying to save.
 *
 * Returns an error message, or null when the set is allowed.
 */
export function validateAttachments(
  attachments: SavedReplyAttachment[],
  businessId: string,
) {
  if (attachments.length === 0) {
    return null;
  }

  for (const attachment of attachments) {
    if (
      !isPathOwnedByBusiness(
        attachment.path,
        businessId,
      )
    ) {
      return "One of these files does not belong to this workspace.";
    }
  }

  const images = attachments.filter(
    (attachment) =>
      attachment.kind === "image",
  ).length;
  const videos = attachments.filter(
    (attachment) =>
      attachment.kind === "video",
  ).length;

  if (videos > SAVED_REPLY_MAX_VIDEOS) {
    return "A quick reply can include one video. Messenger and Telegram both send video on its own, so a second one could not be delivered with it.";
  }

  if (videos > 0 && images > 0) {
    return "A quick reply can include images or one video, not both. Video is always sent on its own.";
  }

  if (images > SAVED_REPLY_MAX_IMAGES) {
    return `A quick reply can include up to ${SAVED_REPLY_MAX_IMAGES} images.`;
  }

  return null;
}
