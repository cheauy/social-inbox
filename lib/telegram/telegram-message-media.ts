import "server-only";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const TELEGRAM_MESSAGE_MEDIA_BUCKET =
  "tenh-message-media";

/*
 * Telegram's hosted Bot API getFile endpoint currently supports downloading
 * files up to 20 MB. Incoming media larger than that is still represented in
 * TENH as a message, but TENH cannot persist a local copy through getFile.
 */
export const TELEGRAM_INCOMING_MEDIA_MAX_BYTES =
  20 * 1024 * 1024;

export const TELEGRAM_INCOMING_PHOTO_MAX_BYTES =
  TELEGRAM_INCOMING_MEDIA_MAX_BYTES;

/*
 * Vercel Functions cap request bodies at 4.5 MB. Keep margin for multipart
 * overhead for browser -> TENH -> Telegram media uploads.
 */
export const TENH_TELEGRAM_OUTGOING_MEDIA_MAX_BYTES =
  4 * 1024 * 1024;

export const TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES =
  TENH_TELEGRAM_OUTGOING_MEDIA_MAX_BYTES;

export type TelegramStoredMediaKind =
  | "photo"
  | "video"
  | "file"
  | "audio"
  | "voice";

export function telegramMessageMediaStoragePath({
  businessId,
  messageId,
  mediaKind = "photo",
}: {
  businessId: string;
  messageId: string;
  mediaKind?: TelegramStoredMediaKind;
}) {
  return `${businessId}/${messageId}/${mediaKind}`;
}

export function telegramMessageMediaUrl(
  messageId: string,
) {
  return `/api/messages/${encodeURIComponent(
    messageId,
  )}/media`;
}

function cleanMimeType(
  value:
    | string
    | null
    | undefined,
) {
  return (
    value
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ??
    ""
  );
}

export function inferTelegramPhotoContentType({
  providedContentType,
  responseContentType,
  filePath,
}: {
  providedContentType?:
    | string
    | null;
  responseContentType?:
    | string
    | null;
  filePath?: string | null;
}) {
  const candidates = [
    providedContentType,
    responseContentType,
  ];

  for (const candidate of candidates) {
    const normalized =
      cleanMimeType(candidate);

    if (
      normalized ===
        "image/jpeg" ||
      normalized ===
        "image/png" ||
      normalized ===
        "image/webp"
    ) {
      return normalized;
    }
  }

  const lowerPath =
    filePath?.toLowerCase() ??
    "";

  if (
    lowerPath.endsWith(".png")
  ) {
    return "image/png";
  }

  if (
    lowerPath.endsWith(".webp")
  ) {
    return "image/webp";
  }

  return "image/jpeg";
}


export function inferTelegramVideoContentType({
  providedContentType,
  responseContentType,
  filePath,
}: {
  providedContentType?:
    | string
    | null;
  responseContentType?:
    | string
    | null;
  filePath?: string | null;
}) {
  const provided =
    cleanMimeType(
      providedContentType,
    );

  if (
    provided.startsWith(
      "video/",
    )
  ) {
    return provided;
  }

  const responseType =
    cleanMimeType(
      responseContentType,
    );

  if (
    responseType.startsWith(
      "video/",
    )
  ) {
    return responseType;
  }

  const path =
    filePath?.toLowerCase() ??
    "";

  if (path.endsWith(".mp4")) {
    return "video/mp4";
  }

  /*
   * Telegram's sendVideo/client video path is MPEG-4. getFile may not
   * preserve MIME type, so use video/mp4 as the safe video fallback.
   */
  return "video/mp4";
}

export function inferTelegramMediaContentType({
  providedContentType,
  responseContentType,
  filePath,
}: {
  providedContentType?:
    | string
    | null;
  responseContentType?:
    | string
    | null;
  filePath?: string | null;
}) {
  const provided =
    cleanMimeType(
      providedContentType,
    );

  if (
    provided &&
    provided !==
      "application/octet-stream"
  ) {
    return provided;
  }

  const responseType =
    cleanMimeType(
      responseContentType,
    );

  if (
    responseType &&
    responseType !==
      "application/octet-stream"
  ) {
    return responseType;
  }

  const path =
    filePath?.toLowerCase() ??
    "";

  if (path.endsWith(".mp3")) {
    return "audio/mpeg";
  }

  if (
    path.endsWith(".m4a") ||
    path.endsWith(".mp4")
  ) {
    return "audio/mp4";
  }

  if (
    path.endsWith(".ogg") ||
    path.endsWith(".opus")
  ) {
    return "audio/ogg";
  }

  if (path.endsWith(".wav")) {
    return "audio/wav";
  }

  if (path.endsWith(".gif")) {
    return "image/gif";
  }

  if (path.endsWith(".webp")) {
    return "image/webp";
  }

  if (path.endsWith(".webm")) {
    return "video/webm";
  }

  if (path.endsWith(".tgs")) {
    return "application/x-tgsticker";
  }

  if (path.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (path.endsWith(".zip")) {
    return "application/zip";
  }

  if (path.endsWith(".txt")) {
    return "text/plain";
  }

  if (path.endsWith(".csv")) {
    return "text/csv";
  }

  if (path.endsWith(".json")) {
    return "application/json";
  }

  return "application/octet-stream";
}

export async function saveTelegramMessageMedia({
  businessId,
  messageId,
  bytes,
  contentType,
  mediaKind = "photo",
}: {
  businessId: string;
  messageId: string;
  bytes: Uint8Array;
  contentType: string;
  mediaKind?: TelegramStoredMediaKind;
}) {
  const storagePath =
    telegramMessageMediaStoragePath({
      businessId,
      messageId,
      mediaKind,
    });

  const {
    error,
  } =
    await supabaseAdmin.storage
      .from(
        TELEGRAM_MESSAGE_MEDIA_BUCKET,
      )
      .upload(
        storagePath,
        Buffer.from(bytes),
        {
          contentType:
            contentType ||
            "application/octet-stream",
          cacheControl:
            "86400",
          upsert: true,
        },
      );

  if (error) {
    throw new Error(
      `Unable to save Telegram message media: ${error.message}`,
    );
  }

  return {
    storagePath,
    attachmentUrl:
      telegramMessageMediaUrl(
        messageId,
      ),
  };
}

export async function deleteTelegramMessageMedia({
  businessId,
  messageId,
  mediaKind = "photo",
}: {
  businessId: string;
  messageId: string;
  mediaKind?: TelegramStoredMediaKind;
}) {
  const storagePath =
    telegramMessageMediaStoragePath({
      businessId,
      messageId,
      mediaKind,
    });

  const { error } =
    await supabaseAdmin.storage
      .from(
        TELEGRAM_MESSAGE_MEDIA_BUCKET,
      )
      .remove([storagePath]);

  if (error) {
    console.warn(
      "[Tenh Telegram] Unable to clean up message media:",
      error.message,
    );
  }
}
