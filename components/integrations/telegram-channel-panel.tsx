"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { IntegrationActionMenu } from "@/components/integrations/integration-action-menu";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY } from "@/lib/display/workspace-storage";
import { setIntegrationEnabled } from "@/lib/channels/set-integration-enabled";

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
  canAddConnections: boolean;
  onConnectionChanged?: (summary: { active: number; total: number }) => void;
  openAddBotSignal?: number;
  businessId: string;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
};

type Working = "connect" | "activate" | "disable" | "disconnect" | null;

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`Server returned an empty response (HTTP ${response.status}).`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Server returned invalid JSON (HTTP ${response.status}).`); }
}

function botLabel(connection: TelegramConnection) {
  return connection.username ? `@${connection.username}` : connection.botName ?? "Telegram Bot";
}

export function TelegramChannelPanel({ canAddConnections, onConnectionChanged, openAddBotSignal = 0, businessId, returnFocusRef }: Props) {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const text = (en: string, km: string) => isKhmer ? km : en;
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [connections, setConnections] = useState<TelegramConnection[]>([]);
  const [token, setToken] = useState("");
  const [showAddBot, setShowAddBot] = useState(false);
  const [handledSignal, setHandledSignal] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ kind: "disable" | "disconnect"; bot: TelegramConnection } | null>(null);
  const [working, setWorking] = useState<Working>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const readSequence = useRef(0);
  const scopeValid = useRef(true);

  if (openAddBotSignal !== handledSignal) {
    setHandledSignal(openAddBotSignal);
    if (openAddBotSignal > 0) { setShowAddBot(true); setConnectError(null); setErrorCode(null); }
  }

  const loadConnections = useCallback(async () => {
    const version = generation.current;
    const sequence = ++readSequence.current;
    try {
      const response = await fetch("/api/telegram/connection", { cache: "no-store" });
      const data = await readJson<ConnectionResponse>(response);
      if (!response.ok || !data.success) throw new Error(data.error ?? "Unable to load Telegram Bots.");
      if (!mounted.current || version !== generation.current || sequence !== readSequence.current) return;
      const rows = (data.connections ?? (data.connection ? [data.connection] : [])).filter(item => item.status !== "disconnected");
      const next = await Promise.all(rows.map(async item => {
        if (!item.isActive || item.status !== "verified") return item;
        try {
          const check = await fetch(`/api/telegram/webhook?connectionId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
          const result = await readJson<WebhookResponse>(check);
          if (!check.ok || !result.success) throw new Error(result.error ?? "Unable to check this bot. Try again.");
          return { ...item, webhookStatus: result.webhook?.status ?? null, lastError: result.remoteError ?? result.webhook?.lastError ?? result.remote?.lastErrorMessage ?? item.lastError };
        } catch {
          return { ...item, webhookStatus: "error", lastError: "Unable to confirm Inbox access. Try enabling Inbox again or reconnect the bot." };
        }
      }));
      if (!mounted.current || version !== generation.current || sequence !== readSequence.current) return;
      setConnections(next);
      setCanManage(scopeValid.current && Boolean(data.canManage));
      onConnectionChanged?.({ total: next.length, active: next.filter(item => item.isActive && item.status === "verified" && item.webhookStatus === "active" && !item.lastError).length });
      return next;
    } catch (loadError) {
      if (mounted.current && version === generation.current && sequence === readSequence.current) setError(loadError instanceof Error ? loadError.message : "Unable to load Telegram Bots.");
    } finally {
      if (mounted.current && version === generation.current && sequence === readSequence.current) setLoading(false);
    }
  }, [onConnectionChanged]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => { if (mounted.current) void loadConnections(); });
    const endScope = () => { mounted.current = false; generation.current++; };
    const workspaceChanged = () => {
      generation.current++;
      scopeValid.current = false;
      setToken(""); setShowAddBot(false); setPendingAction(null); setConnectError(null); setError(null); setNotice(null);
      setConnections([]); setCanManage(false); setLoading(true);
      void loadConnections();
    };
    const navigationChanged = () => {
      setToken(""); setShowAddBot(false);
      if (!busy.current) setPendingAction(null);
    };
    const storageChanged = (event: StorageEvent) => { if (event.key === TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY) workspaceChanged(); };
    window.addEventListener(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, workspaceChanged);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("popstate", navigationChanged);
    window.addEventListener("pagehide", navigationChanged);
    return () => {
      endScope();
      window.removeEventListener(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, workspaceChanged);
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("popstate", navigationChanged);
      window.removeEventListener("pagehide", navigationChanged);
    };
  }, [loadConnections, businessId]);

  function dismiss() {
    if (busy.current) return;
    setShowAddBot(false); setToken(""); setConnectError(null); setErrorCode(null);
  }

  async function connectTelegram() {
    if (busy.current || !canManage || !canAddConnections) return;
    const submittedToken = token.trim();
    if (submittedToken.length < 20 || submittedToken.length > 512 || /\s/.test(submittedToken)) {
      setConnectError(text("Enter a valid Telegram Bot token from BotFather.", "បញ្ចូល Bot Token ត្រឹមត្រូវពី BotFather។"));
      return;
    }
    busy.current = true;
    const version = generation.current;
    const previousIds = new Set(connections.map(bot => bot.id));
    setWorking("connect"); setConnectError(null); setErrorCode(null); setNotice(null);
    try {
      const response = await fetch("/api/telegram/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: submittedToken }) });
      const data = await readJson<ConnectionResponse>(response);
      if (!mounted.current || version !== generation.current) return;
      if (!response.ok || !data.success || !data.connection) {
        setErrorCode(data.code ?? null);
        throw new Error(data.error ?? "Unable to confirm the Telegram Bot connection. Check the list before trying again.");
      }
      setToken("");
      await loadConnections();
      if (!mounted.current || version !== generation.current) return;
      setShowAddBot(false);
      setNotice(text("Bot connected. Choose Enable inbox from its action menu to receive messages.", "បានភ្ជាប់ Bot។ ជ្រើសរើស បើកប្រអប់សារ ពីម៉ឺនុយ ដើម្បីទទួលសារ។"));
    } catch (connectFailure) {
      if (mounted.current && version === generation.current) {
        setConnectError(connectFailure instanceof Error ? connectFailure.message : "Unable to connect Telegram Bot.");
        // A lost response may follow a completed server operation. Reconcile before allowing a retry.
        const reconciled = await loadConnections();
        if (reconciled?.some(bot => !previousIds.has(bot.id) && bot.botId === submittedToken.split(":")[0])) {
          setToken(""); setShowAddBot(false); setConnectError(null);
          setNotice(text("Bot connection confirmed. Enable Inbox from its action menu.", "បានបញ្ជាក់ការភ្ជាប់ Bot។ បើកប្រអប់សារពីម៉ឺនុយសកម្មភាព។"));
        }
      }
    } finally {
      if (mounted.current) {
        if (version !== generation.current) await loadConnections();
        setWorking(null);
      }
      busy.current = false;
    }
  }

  async function changeInbox(bot: TelegramConnection, kind: "activate" | "disable" | "disconnect") {
    if (busy.current || !canManage) return;
    busy.current = true;
    const version = generation.current;
    setWorking(kind); setError(null); setNotice(null);
    try {
      if (kind === "activate" && !bot.isActive) {
        await setIntegrationEnabled(bot.id, true, businessId);
        if (!mounted.current || version !== generation.current) return;
      }
      const path = kind === "disconnect" ? "/api/telegram/connection" : "/api/telegram/webhook";
      const response = await fetch(`${path}?connectionId=${encodeURIComponent(bot.id)}`, { method: kind === "activate" ? "POST" : "DELETE" });
      const data = await readJson<ConnectionResponse>(response);
      if (!mounted.current || version !== generation.current) return;
      if (!response.ok || !data.success) throw new Error(data.error ?? "Unable to update this Telegram Bot.");
      setPendingAction(null);
      setNotice(data.message ?? text("Telegram Bot updated.", "បានធ្វើបច្ចុប្បន្នភាព Telegram Bot។"));
    } catch (actionFailure) {
      if (mounted.current && version === generation.current) setError(actionFailure instanceof Error ? actionFailure.message : "Unable to update this Telegram Bot.");
    } finally {
      if (mounted.current) { await loadConnections(); setWorking(null); }
      busy.current = false;
    }
  }

  return <section className="min-w-0 space-y-3" data-telegram-bots>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-slate-950">{text("Telegram bots", "Telegram Bots")}</h2>
    </div>
    {error && !pendingAction ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p> : null}
    {working === "connect" && !showAddBot ? <p role="status" className="p-3 text-sm text-slate-600">{text("The connection request is still processing. Please wait before trying again.", "សំណើភ្ជាប់កំពុងដំណើរការ។ សូមរង់ចាំ មុនសាកល្បងម្តងទៀត។")}</p> : null}
    {loading ? <p role="status" className="p-4 text-sm text-slate-500">{text("Loading Telegram bots…", "កំពុងផ្ទុក Telegram Bots…")}</p> : connections.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{text("No Telegram bot connected", "មិនទាន់ភ្ជាប់ Telegram Bot")}</p> : <div className="space-y-3">
      {connections.map(bot => {
        const needsReconnect = bot.status !== "verified" || Boolean(bot.lastError) || ["error", "failed"].includes(bot.webhookStatus ?? "");
        const inboxEnabled = bot.isActive && bot.webhookStatus === "active";
        const active = !needsReconnect && inboxEnabled;
        const disabled = !needsReconnect && (!bot.isActive || bot.webhookStatus === "disabled");
        const label = needsReconnect ? text("Reconnect required", "ត្រូវភ្ជាប់ឡើងវិញ") : active ? text("Active", "សកម្ម") : disabled ? text("Disabled", "បានបិទ") : text("Enable inbox to continue", "បើកប្រអប់សារ ដើម្បីបន្ត");
        return <article key={bot.id} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sm font-bold text-sky-700">{(bot.botName || bot.username || "TB").slice(0, 2).toUpperCase()}</span>
            <div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold text-slate-950">{bot.botName ?? "Telegram Bot"}</h3>{bot.username ? <p className="break-all text-xs leading-6 text-slate-500">@{bot.username}</p> : null}
              <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${active ? "bg-emerald-50 text-emerald-700" : disabled ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"}`}>{label}</span>
            </div>
            {canManage ? <IntegrationActionMenu name={botLabel(bot)} disabled={Boolean(working)} actions={[
              { label: inboxEnabled ? text("Disable inbox", "បិទប្រអប់សារ") : text("Enable inbox", "បើកប្រអប់សារ"), onSelect: () => { setError(null); if (inboxEnabled) setPendingAction({ kind: "disable", bot }); else void changeInbox(bot, "activate"); } },
              ...(needsReconnect && canAddConnections ? [{ label: text("Reconnect", "ភ្ជាប់ឡើងវិញ"), onSelect: () => { setConnectError(null); setErrorCode(null); setShowAddBot(true); } }] : []),
              { label: text("Disconnect", "ផ្តាច់ការតភ្ជាប់"), danger: true, onSelect: () => { setError(null); setPendingAction({ kind: "disconnect", bot }); } },
            ]} /> : null}
          </div>
          {needsReconnect ? <p className="mt-3 text-sm leading-6 text-amber-800">{text("Reconnect this bot with its Bot Token to restore Inbox access.", "ភ្ជាប់ Bot នេះឡើងវិញដោយប្រើ Bot Token ដើម្បីស្តារការចូលប្រើប្រអប់សារ។")}</p> : null}
        </article>;
      })}
    </div>}
    <ConfirmActionDialog open={showAddBot && canManage && canAddConnections} tone="primary" icon="unplug"
      title={text("Connect another Telegram bot", "ភ្ជាប់ Telegram Bot មួយទៀត")}
      description={text("Create the bot in @BotFather, copy the Bot Token, then paste it here.", "បង្កើត Bot នៅក្នុង @BotFather ចម្លង Bot Token រួចបិទភ្ជាប់នៅទីនេះ។")}
      confirmLabel={text("Connect", "ភ្ជាប់")} cancelLabel={text("Cancel", "បោះបង់")} closeLabel={text("Close Telegram bot connection", "បិទការភ្ជាប់ Telegram Bot")}
      loadingLabel={text("Connecting…", "កំពុងភ្ជាប់…")} loading={working === "connect"} confirmDisabled={!token.trim()}
      error={connectError} returnFocusRef={returnFocusRef} onCancel={dismiss} onConfirm={() => void connectTelegram()}>
      <form className="mt-4" onSubmit={event => { event.preventDefault(); void connectTelegram(); }}>
        <label htmlFor="telegram-bot-token" className="block text-sm font-semibold text-slate-700">Bot Token</label>
        <input id="telegram-bot-token" type="password" value={token} disabled={working === "connect"} onChange={event => setToken(event.target.value)} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="123456789:AA..." aria-invalid={Boolean(connectError)} className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60" />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {working === "connect" ? <p role="status" className="mt-3 text-sm text-slate-500">{text("Connecting. Please wait before closing this dialog.", "កំពុងភ្ជាប់។ សូមរង់ចាំ មុនពេលបិទផ្ទាំងនេះ។")}</p> : null}
      {errorCode === "SUBSCRIPTION_LOCKED" ? <a href="/dashboard/subscription" className="mt-3 inline-flex min-h-11 items-center text-sm text-blue-700 underline">{text("Open Subscription", "បើកការជាវ")}</a> : null}
    </ConfirmActionDialog>
    <ConfirmActionDialog open={Boolean(pendingAction)} icon={pendingAction?.kind === "disconnect" ? "unplug" : "warning"} tone={pendingAction?.kind === "disconnect" ? "danger" : "warning"}
      title={pendingAction?.kind === "disconnect" ? text("Disconnect this Telegram Bot?", "ផ្តាច់ Telegram Bot នេះ?") : text("Disable Telegram Inbox?", "បិទប្រអប់សារ Telegram?")}
      description={pendingAction ? pendingAction.kind === "disconnect" ? text(`TENH will remove the saved token for ${botLabel(pendingAction.bot)} and stop receiving its messages.`, `TENH នឹងលុបថូខិនដែលបានរក្សាទុកសម្រាប់ ${botLabel(pendingAction.bot)} ហើយឈប់ទទួលសារ។`) : text(`New messages sent to ${botLabel(pendingAction.bot)} will stop arriving in your TENH Inbox.`, `សារថ្មីទៅ ${botLabel(pendingAction.bot)} នឹងឈប់ចូលប្រអប់សារ TENH។`) : ""}
      note={pendingAction?.kind === "disconnect" ? text("Stored conversations and contacts are kept. Pending Telegram updates are discarded and the channel slot is freed. You will need the Bot Token to reconnect.", "សន្ទនា និងទំនាក់ទំនងដែលបានរក្សាទុកនៅតែមាន។ សាររង់ចាំនៅ Telegram ត្រូវបានបោះចោល ហើយកន្លែងឆានែលត្រូវបានដោះលែង។ ត្រូវការ Bot Token ដើម្បីភ្ជាប់ឡើងវិញ។") : text("The bot and its token stay connected, and stored history is kept. Pending Telegram updates are discarded. You can enable Inbox again later.", "Bot និងថូខិននៅតែបានភ្ជាប់ ហើយប្រវត្តិដែលរក្សាទុកនៅតែមាន។ សាររង់ចាំនៅ Telegram ត្រូវបានបោះចោល។ អ្នកអាចបើកប្រអប់សារឡើងវិញពេលក្រោយ។")}
      confirmLabel={pendingAction?.kind === "disconnect" ? text("Disconnect", "ផ្តាច់ការតភ្ជាប់") : text("Disable inbox", "បិទប្រអប់សារ")}
      cancelLabel={text("Cancel", "បោះបង់")} closeLabel={text("Close confirmation", "បិទការបញ្ជាក់")} loadingLabel={text("Working…", "កំពុងដំណើរការ…")}
      loading={Boolean(working)} error={error} onCancel={() => { if (!busy.current) { setPendingAction(null); setError(null); } }}
      onConfirm={() => { if (pendingAction) void changeInbox(pendingAction.bot, pendingAction.kind); }} />
  </section>;
}
