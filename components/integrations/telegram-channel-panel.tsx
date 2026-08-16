"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type TelegramConnection = {
  id: string;
  botId: string | null;
  botName: string | null;
  username: string | null;
  isActive: boolean;
  status: string;
  connectedAt: string | null;
  lastError: string | null;
};

type TelegramConnectionResponse = {
  success: boolean;
  canManage?: boolean;
  connection?: TelegramConnection | null;
  message?: string;
  error?: string;
  details?: string;
};

type TelegramWebhookState = {
  status: string;
  url: string | null;
  registeredAt: string | null;
  lastError: string | null;
};

type TelegramRemoteWebhook = {
  url: string | null;
  pendingUpdateCount: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  allowedUpdates: string[];
};

type TelegramWebhookResponse = {
  success: boolean;
  canManage?: boolean;
  webhook?: TelegramWebhookState | null;
  remote?: TelegramRemoteWebhook;
  remoteError?: string;
  message?: string;
  error?: string;
  details?: string;
};

type TelegramChannelPanelProps = {
  onConnectionChanged?: (
    connected: boolean,
  ) => void;
};

function formatDate(
  value: string | null,
) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

async function readJson<T>(
  response: Response,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `Server returned an empty response (HTTP ${response.status}).`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Server returned invalid JSON (HTTP ${response.status}).`,
    );
  }
}

export function TelegramChannelPanel({
  onConnectionChanged,
}: TelegramChannelPanelProps) {
  const [loading, setLoading] =
    useState(true);
  const [webhookLoading, setWebhookLoading] =
    useState(false);
  const [working, setWorking] =
    useState<
      | "connect"
      | "activate"
      | "disable"
      | "disconnect"
      | null
    >(null);
  const [canManage, setCanManage] =
    useState(false);
  const [connection, setConnection] =
    useState<TelegramConnection | null>(null);
  const [webhook, setWebhook] =
    useState<TelegramWebhookState | null>(null);
  const [remoteWebhook, setRemoteWebhook] =
    useState<TelegramRemoteWebhook | null>(null);
  const [remoteWebhookError, setRemoteWebhookError] =
    useState<string | null>(null);
  const [token, setToken] =
    useState("");
  const [error, setError] =
    useState<string | null>(null);
  const [notice, setNotice] =
    useState<string | null>(null);

  const loadWebhookStatus = useCallback(
    async () => {
      setWebhookLoading(true);
      setRemoteWebhookError(null);

      try {
        const response = await fetch(
          "/api/telegram/webhook",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const data =
          await readJson<TelegramWebhookResponse>(
            response,
          );

        if (!response.ok || !data.success) {
          throw new Error(
            data.error ??
              "Unable to load Telegram webhook status.",
          );
        }

        if (
          typeof data.canManage ===
          "boolean"
        ) {
          setCanManage(data.canManage);
        }

        setWebhook(
          data.webhook ?? null,
        );
        setRemoteWebhook(
          data.remote ?? null,
        );
        setRemoteWebhookError(
          data.remoteError ?? null,
        );
      } catch (loadError) {
        setRemoteWebhookError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load Telegram webhook status.",
        );
      } finally {
        setWebhookLoading(false);
      }
    },
    [],
  );

  const loadConnection = useCallback(
    async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          "/api/telegram/connection",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const data =
          await readJson<TelegramConnectionResponse>(
            response,
          );

        if (!response.ok || !data.success) {
          throw new Error(
            data.error ??
              "Unable to load Telegram connection.",
          );
        }

        setCanManage(
          Boolean(data.canManage),
        );

        const nextConnection =
          data.connection ?? null;
        const isConnected = Boolean(
          nextConnection?.isActive &&
            nextConnection.status ===
              "verified",
        );

        setConnection(nextConnection);
        onConnectionChanged?.(
          isConnected,
        );

        if (isConnected) {
          await loadWebhookStatus();
        } else {
          setWebhook(null);
          setRemoteWebhook(null);
          setRemoteWebhookError(null);
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load Telegram connection.",
        );
      } finally {
        setLoading(false);
      }
    },
    [
      loadWebhookStatus,
      onConnectionChanged,
    ],
  );

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  async function connectTelegram() {
    if (working) {
      return;
    }

    const normalized = token.trim();

    if (!normalized) {
      setError(
        "Paste the Telegram Bot token from BotFather.",
      );
      return;
    }

    setWorking("connect");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/telegram/connection",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            token: normalized,
          }),
        },
      );

      const data =
        await readJson<TelegramConnectionResponse>(
          response,
        );

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ??
            "Unable to connect Telegram.",
        );
      }

      setToken("");
      const nextConnection =
        data.connection ?? null;

      setConnection(nextConnection);
      setWebhook(null);
      setRemoteWebhook(null);
      onConnectionChanged?.(
        Boolean(
          nextConnection?.isActive &&
            nextConnection.status ===
              "verified",
        ),
      );
      setNotice(
        data.message ??
          "Telegram Bot connected.",
      );

      if (nextConnection?.isActive) {
        await loadWebhookStatus();
      }
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to connect Telegram.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function activateTelegramInbox() {
    if (working) {
      return;
    }

    setWorking("activate");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/telegram/webhook",
        {
          method: "POST",
        },
      );

      const data =
        await readJson<TelegramWebhookResponse>(
          response,
        );

      if (!response.ok || !data.success) {
        throw new Error(
          data.details
            ? `${data.error ?? "Unable to activate Telegram Inbox."} ${data.details}`
            : data.error ??
                "Unable to activate Telegram Inbox.",
        );
      }

      setWebhook(
        data.webhook ?? null,
      );
      setNotice(
        data.message ??
          "Telegram Inbox activated.",
      );
      await loadWebhookStatus();
    } catch (activateError) {
      setError(
        activateError instanceof Error
          ? activateError.message
          : "Unable to activate Telegram Inbox.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function disableTelegramInbox() {
    if (working) {
      return;
    }

    const confirmed = window.confirm(
      "Disable incoming Telegram messages in TENH? The Bot will remain connected and keep using its channel slot.",
    );

    if (!confirmed) {
      return;
    }

    setWorking("disable");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/telegram/webhook",
        {
          method: "DELETE",
        },
      );

      const data =
        await readJson<TelegramWebhookResponse>(
          response,
        );

      if (!response.ok || !data.success) {
        throw new Error(
          data.details
            ? `${data.error ?? "Unable to disable Telegram Inbox."} ${data.details}`
            : data.error ??
                "Unable to disable Telegram Inbox.",
        );
      }

      setWebhook(
        data.webhook ?? {
          status: "disabled",
          url: null,
          registeredAt: null,
          lastError: null,
        },
      );
      setRemoteWebhook(null);
      setNotice(
        data.message ??
          "Telegram Inbox disabled.",
      );
    } catch (disableError) {
      setError(
        disableError instanceof Error
          ? disableError.message
          : "Unable to disable Telegram Inbox.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function disconnectTelegram() {
    if (working) {
      return;
    }

    const confirmed = window.confirm(
      "Disconnect this Telegram Bot from TENH? Incoming Telegram messages will stop, the encrypted Bot token will be removed, and the channel slot will be freed.",
    );

    if (!confirmed) {
      return;
    }

    setWorking("disconnect");
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/telegram/connection",
        {
          method: "DELETE",
        },
      );

      const data =
        await readJson<TelegramConnectionResponse>(
          response,
        );

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ??
            "Unable to disconnect Telegram.",
        );
      }

      setConnection(null);
      setWebhook(null);
      setRemoteWebhook(null);
      setRemoteWebhookError(null);
      onConnectionChanged?.(false);
      setNotice(
        data.message ??
          "Telegram disconnected.",
      );
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Unable to disconnect Telegram.",
      );
    } finally {
      setWorking(null);
    }
  }

  const connected = Boolean(
    connection?.isActive &&
      connection.status === "verified",
  );
  const inboxActive =
    webhook?.status === "active";

  return (
    <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500 text-lg font-black text-white shadow-sm">
              T
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">
                Customer channel
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">
                Telegram
              </h2>
            </div>
          </div>

          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
              inboxActive
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : connected
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-slate-100 text-slate-600"
            }`}
          >
            {connected
              ? "Connected"
              : "Setup available"}
          </span>
        </div>
      </div>

      <div className="p-6 sm:p-7">
        <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-900">
          V3.11.3 receives new private Telegram text messages securely and saves them as TENH customers, conversations, and Inbox messages. Telegram replies and media support come in later phases.
        </div>

        {error ? (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
            {error}
          </div>
        ) : null}

        {notice ? (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-medium text-slate-500">
            Loading Telegram connection...
          </div>
        ) : connected && connection ? (
          <div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Connected Bot
                </p>
                <p className="mt-2 text-lg font-bold text-slate-950">
                  {connection.botName ??
                    "Telegram Bot"}
                </p>
                <p className="mt-1 text-sm font-medium text-sky-700">
                  {connection.username
                    ? `@${connection.username}`
                    : "No public username"}
                </p>
                <p className="mt-2 break-all text-xs text-slate-500">
                  Bot ID: {connection.botId}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Connection
                </p>
                <div className="mt-2 flex items-center gap-2 font-semibold text-emerald-700">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Token verified
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  Connected: {formatDate(
                    connection.connectedAt,
                  )}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Subscription usage: 1 channel slot
                </p>
              </div>

            </div>

            {webhook?.lastError ||
            remoteWebhook?.lastErrorMessage ||
            remoteWebhookError ? (
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                <span className="font-semibold">
                  Telegram webhook status:
                </span>{" "}
                {webhook?.lastError ??
                  remoteWebhook?.lastErrorMessage ??
                  remoteWebhookError}
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
              <span className="font-semibold text-slate-800">
                Current V3.11.3 scope:
              </span>{" "}
              new private text messages only. Group messages, photos, files, voice/audio, stickers, and replies from TENH are not enabled yet.
            </div>

            {canManage ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {inboxActive ? (
                  <button
                    type="button"
                    disabled={Boolean(working)}
                    onClick={() =>
                      void disableTelegramInbox()
                    }
                    className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {working === "disable"
                      ? "Disabling..."
                      : "Disable Telegram Inbox"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(working)}
                    onClick={() =>
                      void activateTelegramInbox()
                    }
                    className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {working === "activate"
                      ? "Activating..."
                      : "Activate Telegram Inbox"}
                  </button>
                )}

                <button
                  type="button"
                  disabled={Boolean(working)}
                  onClick={() =>
                    void disconnectTelegram()
                  }
                  className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {working === "disconnect"
                    ? "Disconnecting..."
                    : "Disconnect Telegram"}
                </button>
              </div>
            ) : (
              <p className="mt-5 text-sm text-slate-500">
                Only the workspace owner can change this connection.
              </p>
            )}
          </div>
        ) : (
          <div>
            <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  1. Create your Bot
                </p>
                <p className="mt-2 font-semibold text-slate-900">
                  Open @BotFather in Telegram
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Use /newbot, choose a Bot name and username, then copy the authentication token BotFather gives you.
                </p>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Treat the token like a password. TENH stores it encrypted and never displays the saved token back to the browser.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  2. Verify and connect
                </p>

                {canManage ? (
                  <>
                    <label
                      htmlFor="telegram-bot-token"
                      className="mt-3 block text-sm font-semibold text-slate-800"
                    >
                      Telegram Bot token
                    </label>
                    <input
                      id="telegram-bot-token"
                      type="password"
                      value={token}
                      onChange={(event) =>
                        setToken(
                          event.target.value,
                        )
                      }
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="123456789:AA..."
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    />
                    <button
                      type="button"
                      disabled={
                        Boolean(working) ||
                        !token.trim()
                      }
                      onClick={() =>
                        void connectTelegram()
                      }
                      className="mt-4 inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {working === "connect"
                        ? "Verifying Bot..."
                        : "Connect Telegram Bot"}
                    </button>
                  </>
                ) : (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Only the workspace owner can connect Telegram.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              Connecting a verified Bot uses one workspace channel slot. Incoming messages are activated separately after the Bot is connected.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
