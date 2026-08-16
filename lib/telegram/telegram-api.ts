import "server-only";

import type {
  TelegramApiEnvelope,
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
