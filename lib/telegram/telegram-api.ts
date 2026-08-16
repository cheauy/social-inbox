import "server-only";

import type {
  TelegramApiEnvelope,
  TelegramFile,
  TelegramMessage,
  TelegramUserProfilePhotos,
  TelegramWebhookInfo,
} from "@/lib/telegram/types";

const TELEGRAM_API_BASE =
  "https://api.telegram.org";

type TelegramRequestOptions = {
  body?: Record<string, unknown>;
};

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
    throw new Error(
      payload.description ??
        `Telegram ${method} failed.`,
    );
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
        allowed_updates: ["message"],
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
}: {
  token: string;
  chatId: string | number;
  text: string;
}) {
  return telegramRequest<TelegramMessage>(
    token,
    "sendMessage",
    {
      body: {
        chat_id: chatId,
        text,
      },
    },
  );
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
  | "sendVideo";

type TelegramBinaryField =
  | "document"
  | "audio"
  | "voice"
  | "video";

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

