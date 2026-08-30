"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TelegramConnection = {
  id: string;
  botId: string | null;
  botName: string | null;
  username: string | null;
  isActive: boolean;
  status: string;
  connectedAt: string | null;
  lastError: string | null;
  webhookStatus?: string | null;
};

type ConnectionResponse = {
  success: boolean;
  canManage?: boolean;
  connection?: TelegramConnection | null;
  connections?: TelegramConnection[];
  message?: string;
  error?: string;
  details?: string;
  code?: string;
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

type WebhookResponse = {
  success: boolean;
  webhook?: TelegramWebhookState | null;
  remote?: TelegramRemoteWebhook;
  remoteError?: string;
  message?: string;
  error?: string;
  details?: string;
};

type Props = {
  onConnectionChanged?: (summary: { active: number; total: number }) => void;
  openAddBotSignal?: number;
};

type Working = "connect" | "activate" | "disable" | "disconnect" | null;

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`Server returned an empty response (HTTP ${response.status}).`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Server returned invalid JSON (HTTP ${response.status}).`); }
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function withConnection(path: string, id: string | null) {
  if (!id) return path;
  return `${path}${path.includes("?") ? "&" : "?"}connectionId=${encodeURIComponent(id)}`;
}

export function TelegramChannelPanel({
  onConnectionChanged,
  openAddBotSignal = 0,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [showAddBot, setShowAddBot] = useState(false);
  const [working, setWorking] = useState<Working>(null);
  const [webhook, setWebhook] = useState<TelegramWebhookState | null>(null);
  const [remote, setRemote] = useState<TelegramRemoteWebhook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(
    () => connections.find((item) => item.id === selectedId) ?? connections[0] ?? null,
    [connections, selectedId],
  );
  const verified = selected?.status === "verified";
  const channelEnabled = Boolean(selected?.isActive && verified);
  const inboxActive = channelEnabled && webhook?.status === "active";

  const loadWebhook = useCallback(async (id: string | null) => {
    if (!id) {
      setWebhook(null);
      setRemote(null);
      return;
    }
    try {
      const response = await fetch(withConnection("/api/telegram/webhook", id), { cache: "no-store" });
      const data = await readJson<WebhookResponse>(response);
      if (!response.ok || !data.success) throw new Error(data.error ?? "Unable to load Telegram webhook.");
      setWebhook(data.webhook ?? null);
      setRemote(data.remote ?? null);
    } catch (loadError) {
      setWebhook(null);
      setRemote(null);
      setError(loadError instanceof Error ? loadError.message : "Unable to load Telegram webhook.");
    }
  }, []);

  const loadConnections = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/telegram/connection", { cache: "no-store" });
      const data = await readJson<ConnectionResponse>(response);
      if (!response.ok || !data.success) throw new Error(data.error ?? "Unable to load Telegram Bots.");

      const allConnections = data.connections ?? (data.connection ? [data.connection] : []);
      // Keep connected credentials visible even when subscription capacity is disabled.
      // Fully disconnected Bots are not shown in the customer-facing panel.
      const next = allConnections.filter((item) => item.status === "verified");
      setConnections(next);
      setCanManage(Boolean(data.canManage));
      const target = next.find((item) => item.id === preferredId) ?? next.find((item) => item.isActive) ?? next[0] ?? null;
      setSelectedId(target?.id ?? null);
      onConnectionChanged?.({
        total: next.length,
        active: next.filter((item) => item.isActive && item.status === "verified").length,
      });
      await loadWebhook(target?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Telegram Bots.");
    } finally {
      setLoading(false);
    }
  }, [loadWebhook, onConnectionChanged]);

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  useEffect(() => {
    if (openAddBotSignal > 0) {
      setShowAddBot(true);
    }
  }, [openAddBotSignal]);

  async function selectBot(id: string) {
    setSelectedId(id);
    setError(null);
    setErrorCode(null);
    setNotice(null);
    await loadWebhook(id);
  }

  async function submitTelegramConnection(): Promise<ConnectionResponse> {
    const response = await fetch("/api/telegram/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token.trim(),
      }),
    });

    const data = await readJson<ConnectionResponse>(response);

    if (!response.ok || !data.success) {
      setErrorCode(data.code ?? null);
      throw new Error(data.error ?? "Unable to connect Telegram Bot.");
    }

    return data;
  }

  async function connectTelegram() {
    if (working || !token.trim()) return;

    setWorking("connect");
    setError(null);
    setErrorCode(null);
    setNotice(null);

    try {
      const data = await submitTelegramConnection();


      if (!data.connection) {
        throw new Error(
          "Telegram connection was not returned by the server.",
        );
      }

      setToken("");
      setShowAddBot(false);
      await loadConnections(data.connection.id);

      setNotice(
        data.message ??
          "Telegram Bot connected. One more step: activate Inbox to start receiving customer messages.",
      );
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to connect Telegram Bot.",
      );
    } finally {
      setWorking(null);
    }
  }

  async function activate() {
    if (!selected || working) return;
    setWorking("activate"); setError(null); setErrorCode(null); setNotice(null);
    try {
      const response = await fetch(withConnection("/api/telegram/webhook", selected.id), { method: "POST" });
      const data = await readJson<WebhookResponse>(response);
      if (!response.ok || !data.success) throw new Error(data.details ? `${data.error ?? "Unable to activate."} ${data.details}` : data.error ?? "Unable to activate Telegram Inbox.");
      setNotice(data.message ?? "Telegram Inbox activated.");
      await loadWebhook(selected.id);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Unable to activate Telegram Inbox.");
    } finally { setWorking(null); }
  }

  async function disable() {
    if (!selected || working || !window.confirm(`Disable incoming messages for ${selected.username ? `@${selected.username}` : selected.botName ?? "this Bot"}?`)) return;
    setWorking("disable"); setError(null); setErrorCode(null); setNotice(null);
    try {
      const response = await fetch(withConnection("/api/telegram/webhook", selected.id), { method: "DELETE" });
      const data = await readJson<WebhookResponse>(response);
      if (!response.ok || !data.success) throw new Error(data.error ?? "Unable to disable Telegram Inbox.");
      setNotice(data.message ?? "Telegram Inbox disabled.");
      await loadWebhook(selected.id);
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "Unable to disable Telegram Inbox.");
    } finally { setWorking(null); }
  }

  async function disconnect() {
    if (!selected || working || !window.confirm(`Disconnect ${selected.username ? `@${selected.username}` : selected.botName ?? "this Telegram Bot"}? Existing TENH conversation history will be kept.`)) return;
    setWorking("disconnect"); setError(null); setErrorCode(null); setNotice(null);
    try {
      const response = await fetch(withConnection("/api/telegram/connection", selected.id), { method: "DELETE" });
      const data = await readJson<ConnectionResponse>(response);
      if (!response.ok || !data.success) throw new Error(data.error ?? "Unable to disconnect Telegram Bot.");
      setNotice(data.message ?? "Telegram Bot disconnected.");
      await loadConnections(null);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Telegram Bot.");
    } finally { setWorking(null); }
  }



  function connectionState(item: TelegramConnection) {
    const itemSelected = item.id === selected?.id;
    const webhookStatus = itemSelected
      ? webhook?.status ?? item.webhookStatus ?? null
      : item.webhookStatus ?? null;
    const webhookError = itemSelected
      ? webhook?.lastError ?? remote?.lastErrorMessage ?? item.lastError ?? null
      : item.lastError ?? null;

    const hasError =
      Boolean(webhookError) ||
      webhookStatus === "error" ||
      webhookStatus === "failed";
    const live =
      item.status === "verified" &&
      item.isActive &&
      webhookStatus === "active" &&
      !hasError;
    const inboxOff =
      item.status === "verified" &&
      item.isActive &&
      !live &&
      !hasError;
    const channelOff = item.status === "verified" && !item.isActive;

    return {
      webhookStatus,
      webhookError,
      hasError,
      live,
      inboxOff,
      channelOff,
    };
  }

  function botInitials(item: TelegramConnection) {
    return (
      (item.botName ?? item.username ?? "TB")
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "TB"
    );
  }

  function avatarClasses(item: TelegramConnection) {
    const seed = (item.botName ?? item.username ?? item.id)
      .split("")
      .reduce((total, char) => total + char.charCodeAt(0), 0);
    const choices = [
      "bg-emerald-100 text-emerald-700",
      "bg-amber-100 text-amber-700",
      "bg-sky-100 text-sky-700",
      "bg-rose-100 text-rose-700",
      "bg-violet-100 text-violet-700",
    ];
    return choices[seed % choices.length];
  }

  async function toggleBot(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(id);
    await selectBot(id);
  }

  const attentionConnections = connections.filter(
    (item) => !connectionState(item).live,
  );
  const healthyConnections = connections.filter(
    (item) => connectionState(item).live,
  );

  function renderBot(item: TelegramConnection) {
    const state = connectionState(item);
    const expanded = expandedId === item.id;
    const isSelected = item.id === selected?.id;

    const borderClass = state.hasError
      ? "border-red-300"
      : state.live
        ? "border-slate-300"
        : "border-amber-400";

    const statusClass = state.hasError
      ? "bg-red-100 text-red-700"
      : state.live
        ? "bg-emerald-100 text-emerald-700"
        : "bg-amber-100 text-amber-800";

    const statusText = state.hasError
      ? "Webhook error"
      : state.live
        ? "Live"
        : state.channelOff
          ? "Disabled"
          : "Inbox off";

    return (
      <article
        key={item.id}
        className={`overflow-hidden rounded-2xl border bg-white ${borderClass}`}
      >
        <button
          type="button"
          onClick={() => void toggleBot(item.id)}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-50/70"
          aria-expanded={expanded}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold ${avatarClasses(item)}`}
            >
              {botInitials(item)}
            </span>

            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-950">
                {item.botName ?? "Telegram bot"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {item.username ? `@${item.username}` : item.botId ?? "No username"}
              </span>
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-3">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}
            >
              {state.hasError ? "⌁" : state.live ? "" : "⚠"}
              {statusText}
            </span>
            <span
              className={`text-lg leading-none text-slate-400 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            >
              ⌄
            </span>
          </span>
        </button>

        {expanded ? (
          <div className="border-t border-slate-200 px-4 pb-4 pt-3">
            {!isSelected ? (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Loading bot details…
              </div>
            ) : (
              <div className="space-y-3">
                {state.hasError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <p className="font-semibold">Telegram webhook needs attention</p>
                    <p className="mt-1 text-xs leading-5">
                      {state.webhookError ??
                        "TENH could not confirm that this bot webhook is working."}
                    </p>
                  </div>
                ) : state.channelOff ? (
                  <div className="flex flex-col gap-3 rounded-xl bg-amber-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-amber-950">
                        This Telegram channel is disabled
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-900">
                        The bot stays connected and its history is kept, but it does not use a channel slot while disabled.
                      </p>
                    </div>
                    {canManage ? (
                      <a
                        href="/dashboard/settings/users?tab=channels"
                        className="shrink-0 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
                      >
                        Enable channel
                      </a>
                    ) : null}
                  </div>
                ) : state.inboxOff ? (
                  <div className="flex flex-col gap-3 rounded-xl bg-[#f8dca2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium leading-5 text-[#76500f]">
                        The bot token is verified, but the webhook is off — no messages will reach your inbox until you activate it.
                      </p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={Boolean(working)}
                        onClick={() => void activate()}
                        className="shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-50"
                      >
                        {working === "activate" ? "Activating…" : "Activate Inbox"}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                      Webhook
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">
                      {webhook?.status === "active"
                        ? "Active"
                        : webhook?.status === "disabled"
                          ? "Disabled"
                          : webhook?.status ?? "Unknown"}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                      Pending updates
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">
                      {remote?.pendingUpdateCount ?? 0}
                    </p>
                  </div>
                </div>

                {canManage ? (
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <button
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => void disconnect()}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {working === "disconnect" ? "Disconnecting…" : "Disconnect"}
                    </button>

                    {selected?.isActive ? (
                      inboxActive ? (
                        <button
                          type="button"
                          disabled={Boolean(working)}
                          onClick={() => void disable()}
                          className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                        >
                          {working === "disable" ? "Disabling…" : "Disable Inbox"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(working) || !verified}
                          onClick={() => void activate()}
                          className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
                        >
                          {working === "activate" ? "Activating…" : "Activate Inbox"}
                        </button>
                      )
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    You are an Agent in this workspace. Only the Owner can change bot connections.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Telegram bots</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Manage your connected Telegram bots and inbox webhooks.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          {errorCode === "SUBSCRIPTION_LOCKED" ? (
            <a
              href="/dashboard/subscription"
              className="mt-2 inline-flex font-semibold underline underline-offset-2"
            >
              Open Subscription
            </a>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {showAddBot && canManage ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
          <p className="font-semibold text-slate-900">Connect another Telegram bot</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Create the bot in @BotFather, copy the Bot Token, then paste it here.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="123456789:AA..."
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            />
            <button
              type="button"
              disabled={Boolean(working) || !token.trim()}
              onClick={() => void connectTelegram()}
              className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {working === "connect" ? "Verifying..." : "Connect bot"}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-medium text-slate-500">
          Loading Telegram bots...
        </div>
      ) : connections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center">
          <p className="font-bold text-slate-900">No Telegram bot connected</p>
          <p className="mt-2 text-sm text-slate-500">
            Connect the first bot to start using Telegram in this workspace.
          </p>
          {!canManage ? (
            <p className="mt-4 text-sm font-medium text-amber-700">
              Only the workspace Owner can connect a Telegram bot.
            </p>
          ) : null}
          {canManage && !showAddBot ? (
            <p className="mt-4 text-sm text-slate-500">
              Use <span className="font-semibold text-slate-700">+ Add Connection</span> above to connect a Telegram bot.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {attentionConnections.length > 0 ? (
            <div className="space-y-2">
              {attentionConnections.map((item) => renderBot(item))}
            </div>
          ) : null}

          {healthyConnections.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                Healthy
              </p>
              <div className="space-y-1">
                {healthyConnections.map((item) => renderBot(item))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
