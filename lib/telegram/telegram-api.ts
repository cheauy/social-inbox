import "server-only";

import type {
  TelegramApiEnvelope,
  TelegramFile,
  TelegramMessage,
  TelegramUserProfilePhotos,
  TelegramUser,
  TelegramWebhookInfo,
} from "@/lib/telegram/types";

const TELEGRAM_API_BASE =
  "https://api.telegram.org";

type TelegramRequestOptions = {
  body?: Record<string, unknown>;
};

export class TelegramApiError extends Error {
  readonly method: string;
  readonly errorCode: number | null;
  readonly retryAfter: number | null;

  constructor({
    method,
    description,
    errorCode,
    retryAfter,
  }: {
    method: string;
    description: string;
    errorCode?: number;
    retryAfter?: number;
  }) {
    const retrySuffix =
      typeof retryAfter === "number" &&
      retryAfter > 0
        ? ` Try again in ${retryAfter} seconds.`
        : "";

    super(
      `${description}${retrySuffix}`,
    );

    this.name = "TelegramApiError";
    this.method = method;
    this.errorCode =
      typeof errorCode === "number"
        ? errorCode
        : null;
    this.retryAfter =
      typeof retryAfter === "number"
        ? retryAfter
        : null;
  }
}

async function telegramRequest<T>(
  token: string,
  method: string,
  options: TelegramRequestOptions = {},
): Promise<T> {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        options.body ?? {},
      ),
      cache: "no-store",
    },
  );

  let payload: TelegramApiEnvelope<T>;

  try {
    payload =
      (await response.json()) as TelegramApiEnvelope<T>;
  } catch {
    throw new Error(
      `Telegram ${method} returned an invalid response.`,
    );
  }

  if (
    !response.ok ||
    payload.ok !== true ||
    payload.result === undefined
  ) {
    throw new TelegramApiError({
      method,
      description:
        payload.description ??
        `Telegram ${method} failed.`,
      errorCode:
        payload.error_code,
      retryAfter:
        payload.parameters
          ?.retry_after,
    });
  }

  return payload.result;
}

export async function setTelegramWebhook({
  token,
  url,
  secretToken,
  dropPendingUpdates,
}: {
  token: string;
  url: string;
  secretToken: string;
  dropPendingUpdates: boolean;
}) {
  return telegramRequest<boolean>(
    token,
    "setWebhook",
    {
      body: {
        url,
        secret_token: secretToken,
        allowed_updates: [
          "message",
          "edited_message",
        ],
        drop_pending_updates:
          dropPendingUpdates,
      },
    },
  );
}

export async function deleteTelegramWebhook({
  token,
  dropPendingUpdates,
}: {
  token: string;
  dropPendingUpdates: boolean;
}) {
  return telegramRequest<boolean>(
    token,
    "deleteWebhook",
    {
      body: {
        drop_pending_updates:
          dropPendingUpdates,
      },
    },
  );
}

export async function getTelegramWebhookInfo(
  token: string,
) {
  return telegramRequest<TelegramWebhookInfo>(
    token,
    "getWebhookInfo",
  );
}


export async function getTelegramMe(
  token: string,
) {
  return telegramRequest<TelegramUser>(
    token,
    "getMe",
  );
}

export async function getTelegramUserProfilePhotos({
  token,
  userId,
}: {
  token: string;
  userId: number;
}) {
  return telegramRequest<TelegramUserProfilePhotos>(
    token,
    "getUserProfilePhotos",
    {
      body: {
        user_id: userId,
        offset: 0,
        limit: 1,
      },
    },
  );
}

export async function getTelegramFile({
  token,
  fileId,
}: {
  token: string;
  fileId: string;
}) {
  return telegramRequest<TelegramFile>(
    token,
    "getFile",
    {
      body: {
        file_id: fileId,
      },
    },
  );
}

export async function downloadTelegramFile({
  token,
  filePath,
}: {
  token: string;
  filePath: string;
}) {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Telegram file download failed with HTTP ${response.status}.`,
    );
  }

  return response;
}


export async function sendTelegramMessage({
  token,
  chatId,
  text,
  replyToMessageId,
}: {
  token: string;
  chatId: string | number;
  text: string;
  replyToMessageId?: number | null;
}) {
  return telegramRequest<TelegramMessage>(
    token,
    "sendMessage",
    {
      body: {
        chat_id: chatId,
        text,
        ...(typeof replyToMessageId === "number" &&
        Number.isSafeInteger(replyToMessageId) &&
        replyToMessageId > 0
          ? {
              reply_parameters: {
                message_id: replyToMessageId,
                allow_sending_without_reply:
                  false,
              },
            }
          : {}),
      },
    },
  );
}

export async function editTelegramMessageText({
  token,
  chatId,
  messageId,
  text,
}: {
  token: string;
  chatId: string | number;
  messageId: number;
  text: string;
}) {
  return telegramRequest<TelegramMessage>(
    token,
    "editMessageText",
    {
      body: {
        chat_id: chatId,
        message_id: messageId,
        text,
      },
    },
  );
}

export async function deleteTelegramMessage({
  token,
  chatId,
  messageId,
}: {
  token: string;
  chatId: string | number;
  messageId: number;
}) {
  return telegramRequest<boolean>(
    token,
    "deleteMessage",
    {
      body: {
        chat_id: chatId,
        message_id: messageId,
      },
    },
  );
}

export async function sendTelegramChatAction({
  token,
  chatId,
  action = "typing",
}: {
  token: string;
  chatId: string | number;
  action?: "typing";
}) {
  return telegramRequest<boolean>(
    token,
    "sendChatAction",
    {
      body: {
        chat_id: chatId,
        action,
      },
    },
  );
}

/**
 * Send 2-10 photos as one Telegram album.
 *
 * sendMediaGroup takes a JSON `media` array describing each item, while the
 * bytes ride alongside as ordinary multipart fields; each item points at its
 * field with an attach:// reference. Telegram replies with one message per
 * photo, so the caller still gets a row per item — the grouping is what the
 * customer sees, not how it is stored.
 */
/*
 * Send several photos and videos as one album.
 *
 * Telegram groups photos and videos together, so an agent sending both gets one
 * message rather than two. Documents cannot join them -- Telegram only groups
 * documents with documents -- so the caller keeps those separate.
 *
 * A caption belongs to the album, not to a file, and Telegram takes it from the
 * first item only. Putting the agent's text there is what turns "media, then a
 * separate text message" into the single message they expected to send.
 */
export async function sendTelegramMediaGroup({
  token,
  chatId,
  files,
  caption,
  replyToMessageId,
}: {
  token: string;
  chatId: string;
  files: File[];
  caption?: string | null;
  replyToMessageId?: number | null;
}) {
  const formData = new FormData();

  formData.set("chat_id", String(chatId));

  if (
    typeof replyToMessageId === "number"
  ) {
    formData.set(
      "reply_to_message_id",
      String(replyToMessageId),
    );
  }

  const trimmedCaption =
    caption?.trim() ?? "";

  const media = files.map((file, index) => {
    const isVideo = file.type
      .toLowerCase()
      .startsWith("video/");

    const field = isVideo
      ? `video_${index}`
      : `photo_${index}`;

    formData.set(
      field,
      file,
      file.name ||
        (isVideo
          ? `tenh-telegram-video-${index}.mp4`
          : `tenh-telegram-photo-${index}.jpg`),
    );

    return {
      type: isVideo ? "video" : "photo",
      media: `attach://${field}`,

      /* Telegram shows the album's caption from the first item only. */
      ...(index === 0 && trimmedCaption
        ? {
            caption: trimmedCaption.slice(
              0,
              1024,
            ),
          }
        : {}),
    };
  });

  formData.set("media", JSON.stringify(media));

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendMediaGroup`,
    {
      method: "POST",
      body: formData,
      cache: "no-store",
    },
  );

  let payload: TelegramApiEnvelope<TelegramMessage[]>;

  try {
    payload =
      (await response.json()) as TelegramApiEnvelope<
        TelegramMessage[]
      >;
  } catch {
    throw new Error(
      "Telegram sendMediaGroup returned an invalid response.",
    );
  }

  if (
    !response.ok ||
    payload.ok !== true ||
    !Array.isArray(payload.result)
  ) {
    throw new Error(
      payload.description ??
        "Telegram sendMediaGroup failed.",
    );
  }

  return payload.result;
}

export async function sendTelegramPhoto({
  token,
  chatId,
  photo,
  fileName,
}: {
  token: string;
  chatId: string | number;
  photo: Blob;
  fileName: string;
}) {
  const formData =
    new FormData();

  formData.set(
    "chat_id",
    String(chatId),
  );

  formData.set(
    "photo",
    photo,
    fileName ||
      "tenh-telegram-photo.jpg",
  );

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/sendPhoto`,
    {
      method: "POST",
      body: formData,
      cache: "no-store",
    },
  );

  let payload:
    TelegramApiEnvelope<TelegramMessage>;

  try {
    payload =
      (await response.json()) as
        TelegramApiEnvelope<TelegramMessage>;
  } catch {
    throw new Error(
      "Telegram sendPhoto returned an invalid response.",
    );
  }

  if (
    !response.ok ||
    payload.ok !== true ||
    !payload.result
  ) {
    throw new Error(
      payload.description ??
        "Telegram sendPhoto failed.",
    );
  }

  return payload.result;
}

type TelegramBinaryMethod =
  | "sendDocument"
  | "sendAudio"
  | "sendVoice"
  | "sendVideo"
  | "sendAnimation";

type TelegramBinaryField =
  | "document"
  | "audio"
  | "voice"
  | "video"
  | "animation";

async function sendTelegramBinaryMedia({
  token,
  chatId,
  method,
  field,
  file,
  fileName,
}: {
  token: string;
  chatId: string | number;
  method: TelegramBinaryMethod;
  field: TelegramBinaryField;
  file: Blob;
  fileName: string;
}) {
  const formData =
    new FormData();

  formData.set(
    "chat_id",
    String(chatId),
  );

  formData.set(
    field,
    file,
    fileName ||
      `tenh-${field}`,
  );

  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/${method}`,
    {
      method: "POST",
      body: formData,
      cache: "no-store",
    },
  );

  let payload:
    TelegramApiEnvelope<TelegramMessage>;

  try {
    payload =
      (await response.json()) as
        TelegramApiEnvelope<TelegramMessage>;
  } catch {
    throw new Error(
      `Telegram ${method} returned an invalid response.`,
    );
  }

  if (
    !response.ok ||
    payload.ok !== true ||
    !payload.result
  ) {
    throw new Error(
      payload.description ??
        `Telegram ${method} failed.`,
    );
  }

  return payload.result;
}

export async function sendTelegramDocument({
  token,
  chatId,
  document,
  fileName,
}: {
  token: string;
  chatId: string | number;
  document: Blob;
  fileName: string;
}) {
  return sendTelegramBinaryMedia({
    token,
    chatId,
    method: "sendDocument",
    field: "document",
    file: document,
    fileName,
  });
}

export async function sendTelegramAudio({
  token,
  chatId,
  audio,
  fileName,
}: {
  token: string;
  chatId: string | number;
  audio: Blob;
  fileName: string;
}) {
  return sendTelegramBinaryMedia({
    token,
    chatId,
    method: "sendAudio",
    field: "audio",
    file: audio,
    fileName,
  });
}

export async function sendTelegramVoice({
  token,
  chatId,
  voice,
  fileName,
}: {
  token: string;
  chatId: string | number;
  voice: Blob;
  fileName: string;
}) {
  return sendTelegramBinaryMedia({
    token,
    chatId,
    method: "sendVoice",
    field: "voice",
    file: voice,
    fileName,
  });
}

export async function sendTelegramVideo({
  token,
  chatId,
  video,
  fileName,
}: {
  token: string;
  chatId: string | number;
  video: Blob;
  fileName: string;
}) {
  return sendTelegramBinaryMedia({
    token,
    chatId,
    method: "sendVideo",
    field: "video",
    file: video,
    fileName:
      fileName ||
      "tenh-video.mp4",
  });
}

export async function sendTelegramAnimation({
  token,
  chatId,
  animation,
  fileName,
}: {
  token: string;
  chatId: string | number;
  animation: Blob;
  fileName: string;
}) {
  return sendTelegramBinaryMedia({
    token,
    chatId,
    method: "sendAnimation",
    field: "animation",
    file: animation,
    fileName:
      fileName ||
      "tenh-animation.gif",
  });
}

export async function sendTelegramLocation({
  token,
  chatId,
  latitude,
  longitude,
}: {
  token: string;
  chatId: string | number;
  latitude: number;
  longitude: number;
}) {
  return telegramRequest<TelegramMessage>(
    token,
    "sendLocation",
    {
      body: {
        chat_id: chatId,
        latitude,
        longitude,
      },
    },
  );
}

