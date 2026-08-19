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

type Props = { onConnectionChanged?: (summary: { active: number; total: number }) => void };

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

export function TelegramChannelPanel({ onConnectionChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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



  return (
    <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl shadow-sm">
              <img
                src="/images/channels/telegram.png"
                alt="Telegram"
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">Customer channel</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">Telegram Bots</h2>
              <p className="mt-1 text-xs text-slate-500">Multiple Bots can share one TENH subscription.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                connections.some((item) => item.isActive)
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : connections.length > 0
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              {connections.some((item) => item.isActive)
                ? "Connected"
                : connections.length > 0
                  ? "Disabled"
                  : "Not connected"}
            </span>
            {canManage ? (
              <button type="button" onClick={() => setShowAddBot((v) => !v)} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700">
                + Add Bot
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-6 sm:p-7">
        <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-900">
          Each Telegram Bot uses one connection. Customer messages from that Bot will appear in TENH Inbox, and your team can reply from the same Bot. Only the workspace Owner can connect or disconnect Bots.
        </div>

        {error ? (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
        {notice ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

        {showAddBot && canManage ? (
          <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-5">
            <p className="font-bold text-slate-900">
              Connect another Telegram Bot
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Create your Bot in @BotFather, copy the Bot Token, then paste it here. A Bot already claimed by another TENH workspace cannot be used to join or take over that workspace.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456789:AA..." autoComplete="off" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
              <button type="button" disabled={Boolean(working) || !token.trim()} onClick={() => void connectTelegram()} className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">
                {working === "connect" ? "Verifying..." : "Connect Bot"}
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm font-medium text-slate-500">Loading Telegram Bots...</div>
        ) : connections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center">
            <p className="font-bold text-slate-900">No Telegram Bot connected</p>
            <p className="mt-2 text-sm text-slate-500">Connect the first Bot to start using Telegram in this subscription.</p>
            {!canManage ? <p className="mt-4 text-sm font-medium text-amber-700">Only the subscription Owner can connect a Telegram Bot. Ask an Owner to invite you to the workspace if you need access.</p> : null}
            {canManage && !showAddBot ? <button type="button" onClick={() => setShowAddBot(true)} className="mt-4 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white">Connect Telegram Bot</button> : null}
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
            <div className="min-h-0">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Connected Bots</p>
              <div className="max-h-[220px] space-y-2 overflow-y-auto overscroll-contain pr-1">
                {connections.map((item) => (
                  <button key={item.id} type="button" onClick={() => void selectBot(item.id)} className={`w-full rounded-2xl border p-4 text-left transition ${item.id === selected?.id ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">{item.botName ?? "Telegram Bot"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.isActive ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {item.isActive ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs font-medium text-sky-700">{item.username ? `@${item.username}` : item.botId}</p>
                  </button>
                ))}
              </div>
            </div>

            {selected ? (
              <div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Selected Bot</p>
                    <p className="mt-2 text-lg font-bold text-slate-950">{selected.botName ?? "Telegram Bot"}</p>
                    <p className="mt-1 text-sm font-medium text-sky-700">{selected.username ? `@${selected.username}` : "No public username"}</p>
                    <p className="mt-2 break-all text-xs text-slate-500">Bot ID: {selected.botId}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Connection</p>
                    <p className={`mt-2 font-semibold ${channelEnabled ? "text-emerald-700" : verified ? "text-amber-700" : "text-slate-500"}`}>
                      {channelEnabled ? "Connected" : verified ? "Disabled" : selected.status}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">Connected: {formatDate(selected.connectedAt)}</p>
                    {verified && !selected.isActive ? (
                      <p className="mt-2 text-xs font-medium text-amber-700">This Bot is disabled in subscription usage and cannot be opened in Inbox.</p>
                    ) : null}
                  </div>
                </div>

                {channelEnabled && !inboxActive && canManage ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-amber-900">Activate Inbox to receive messages</p>
                      <p className="mt-1 text-sm text-amber-800">Your Bot is connected. Activate Inbox so new Telegram customer messages can appear in TENH Chat.</p>
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => void activate()}
                      className="shrink-0 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {working === "activate" ? "Activating..." : "Activate Inbox"}
                    </button>
                  </div>
                ) : null}

                {verified && !selected.isActive ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-amber-900">Channel disabled</p>
                      <p className="mt-1 text-sm text-amber-800">This Bot stays connected, but it does not use a channel slot and TENH blocks it from Inbox until an Owner enables it again.</p>
                    </div>
                    <a href="/dashboard/settings/users?tab=channels" className="shrink-0 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50">
                      Enable channel
                    </a>
                  </div>
                ) : null}

                {remote?.lastErrorMessage || webhook?.lastError ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{webhook?.lastError ?? remote?.lastErrorMessage}</div> : null}

                {canManage ? (
                  <div className="mt-5 rounded-2xl border border-slate-200 p-5">
                    <div>
                      <p className="font-bold text-slate-900">Bot controls</p>
                      <p className="mt-1 text-xs text-slate-500">Manage Inbox access or disconnect this Bot.</p>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {selected.isActive ? (
                        inboxActive ? (
                          <button type="button" disabled={Boolean(working)} onClick={() => void disable()} className="rounded-xl border border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-800">{working === "disable" ? "Disabling..." : "Disable Inbox"}</button>
                        ) : (
                          <button type="button" disabled={Boolean(working) || !verified} onClick={() => void activate()} className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{working === "activate" ? "Activating..." : "Activate Inbox"}</button>
                        )
                      ) : null}
                      <button type="button" disabled={Boolean(working)} onClick={() => void disconnect()} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700">{working === "disconnect" ? "Disconnecting..." : "Disconnect Bot"}</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">You are an Agent in this subscription. You can use its Telegram conversations in Inbox; only the Owner can change Bot connections.</div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
