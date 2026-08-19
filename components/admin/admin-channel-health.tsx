"use client";

import { useState, type ReactNode } from "react";

type HealthStatus = "healthy" | "warning" | "error";
type Platform = "all" | "messenger" | "telegram" | "system";
type CheckValue = boolean | null;

type HealthSummary = {
  total: number;
  healthy: number;
  warning: number;
  error: number;
};

type ActivitySnapshot = {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  failedOutbound24h: number;
  error: string | null;
};

type MessengerItem = {
  id: string;
  businessId: string;
  name: string;
  pageId: string | null;
  status: HealthStatus;
  checks: {
    token: CheckValue;
    identity: CheckValue;
    conversations: CheckValue;
    webhook: CheckValue;
    messagesField: CheckValue;
    feedField: CheckValue;
    permissions: CheckValue;
  };
  permissions: {
    available: boolean;
    missingScopes: string[];
    expiresAt: string | null;
    error: string | null;
  };
  activity: ActivitySnapshot;
  detail: string;
  localError?: string | null;
};

type TelegramItem = {
  id: string;
  businessId: string;
  name: string;
  username?: string | null;
  status: HealthStatus;
  checks: {
    token: CheckValue;
    localToken: CheckValue;
    webhook: CheckValue;
    webhookUrl: CheckValue;
    allowedUpdates: CheckValue;
  };
  pendingUpdates?: number | null;
  remoteWebhookError?: string | null;
  remoteWebhookErrorAt?: string | null;
  activity: ActivitySnapshot;
  detail: string;
  localError?: string | null;
};

type SystemCheck = {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
};

type DiagnosticsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  generatedAt?: string;
  messenger?: {
    summary: HealthSummary;
    items: MessengerItem[];
  } | null;
  telegram?: {
    summary: HealthSummary;
    items: TelegramItem[];
  } | null;
  system?: {
    status: HealthStatus;
    summary: HealthSummary;
    checks: SystemCheck[];
  } | null;
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const classes =
    status === "healthy"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-black capitalize ${classes}`}
    >
      {status}
    </span>
  );
}

function Check({ value, children }: { value: CheckValue; children: ReactNode }) {
  const classes =
    value === true
      ? "bg-emerald-50 text-emerald-700"
      : value === false
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-500";

  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${classes}`}>
      {value === true ? "✓" : value === false ? "✕" : "—"} {children}
    </span>
  );
}

function SummaryCards({
  summary,
  totalLabel = "Connections",
}: {
  summary: HealthSummary;
  totalLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
          {totalLabel}
        </p>
        <p className="mt-1 text-xl font-black text-slate-950">{summary.total}</p>
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-600">
          Healthy
        </p>
        <p className="mt-1 text-xl font-black text-emerald-800">{summary.healthy}</p>
      </div>
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-600">
          Warning
        </p>
        <p className="mt-1 text-xl font-black text-amber-800">{summary.warning}</p>
      </div>
      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-red-600">
          Error
        </p>
        <p className="mt-1 text-xl font-black text-red-800">{summary.error}</p>
      </div>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function ActivityRow({ activity }: { activity: ActivitySnapshot }) {
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-3">
      <div>
        <span className="font-bold text-slate-700">Last inbound:</span>{" "}
        {formatDate(activity.lastInboundAt)}
      </div>
      <div>
        <span className="font-bold text-slate-700">Last outbound:</span>{" "}
        {formatDate(activity.lastOutboundAt)}
      </div>
      <div>
        <span className="font-bold text-slate-700">Failed sends 24h:</span>{" "}
        {activity.failedOutbound24h}
      </div>
      {activity.error ? (
        <div className="sm:col-span-3 text-amber-700">
          Activity check warning: {activity.error}
        </div>
      ) : null}
    </div>
  );
}

export function AdminChannelHealth() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [running, setRunning] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(platform: Platform) {
    setRunning(platform);
    setError(null);

    try {
      const response = await fetch(
        `/api/tenh-admin/channel-health?platform=${encodeURIComponent(platform)}`,
        {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        },
      );
      const result = (await response.json()) as DiagnosticsResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.details ?? result.error ?? "Unable to run diagnostics.");
      }

      setData((previous) => ({
        ...previous,
        ...result,
        messenger:
          result.messenger === null ? previous?.messenger ?? null : result.messenger,
        telegram:
          result.telegram === null ? previous?.telegram ?? null : result.telegram,
        system: result.system === null ? previous?.system ?? null : result.system,
      }));
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : "Unable to run diagnostics.",
      );
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
              Live diagnostics
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">
              Messenger, Telegram & TENH system health
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Checks live channel authentication, webhook configuration, recent message activity, failed sends, TENH domain/DNS/HTTPS, Vercel routing, database access, and required server configuration. It does not send a test message and never displays access tokens.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(running)}
              onClick={() => void run("messenger")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === "messenger" ? "Checking Messenger..." : "Messenger health"}
            </button>
            <button
              type="button"
              disabled={Boolean(running)}
              onClick={() => void run("telegram")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === "telegram" ? "Checking Telegram..." : "Telegram health"}
            </button>
            <button
              type="button"
              disabled={Boolean(running)}
              onClick={() => void run("system")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === "system" ? "Checking TENH..." : "TENH system health"}
            </button>
            <button
              type="button"
              disabled={Boolean(running)}
              onClick={() => void run("all")}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === "all" ? "Running diagnostics..." : "Run all diagnostics"}
            </button>
          </div>
        </div>

        {data?.generatedAt ? (
          <p className="mt-4 text-xs text-slate-400">
            Last checked {new Date(data.generatedAt).toLocaleString()}
          </p>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">Messenger health</h3>
            <p className="mt-1 text-sm text-slate-500">
              Page token, Page identity, conversations API, webhook app subscription, messages/feed
              fields, permissions, and recent TENH activity.
            </p>
          </div>
        </div>

        {data?.messenger ? (
          <div className="space-y-4">
            <SummaryCards summary={data.messenger.summary} />
            {data.messenger.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No active Messenger connections found.
              </div>
            ) : (
              <div className="space-y-2">
                {data.messenger.items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-950">{item.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Page {item.pageId ?? "unknown"} · Workspace {item.businessId.slice(0, 8)}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Check value={item.checks.token}>Token</Check>
                      <Check value={item.checks.identity}>Page identity</Check>
                      <Check value={item.checks.conversations}>Conversations API</Check>
                      <Check value={item.checks.webhook}>Webhook app</Check>
                      <Check value={item.checks.messagesField}>Messages field</Check>
                      <Check value={item.checks.feedField}>Feed/comments</Check>
                      <Check value={item.checks.permissions}>Permissions</Check>
                    </div>

                    <p className="mt-3 text-sm leading-5 text-slate-600">{item.detail}</p>

                    {item.permissions.missingScopes.length > 0 ? (
                      <p className="mt-2 text-xs text-amber-700">
                        Missing scopes: {item.permissions.missingScopes.join(", ")}
                      </p>
                    ) : null}
                    {item.permissions.expiresAt ? (
                      <p className="mt-1 text-xs text-slate-400">
                        Token expiry reported by Meta: {formatDate(item.permissions.expiresAt)}
                      </p>
                    ) : null}
                    {item.permissions.error ? (
                      <p className="mt-1 text-xs text-amber-700">
                        Permission check: {item.permissions.error}
                      </p>
                    ) : null}

                    <ActivityRow activity={item.activity} />

                    {item.localError ? (
                      <p className="mt-2 text-xs text-red-600">Stored error: {item.localError}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Click <strong>Messenger health</strong> to check all active Messenger connections.
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4">
          <h3 className="text-lg font-black text-slate-950">Telegram health</h3>
          <p className="mt-1 text-sm text-slate-500">
            Bot API authentication, local token state, webhook URL, required update subscriptions,
            pending updates, remote webhook errors, and recent TENH activity.
          </p>
        </div>

        {data?.telegram ? (
          <div className="space-y-4">
            <SummaryCards summary={data.telegram.summary} />
            {data.telegram.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                No active Telegram connections found.
              </div>
            ) : (
              <div className="space-y-2">
                {data.telegram.items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-950">
                          {item.name}
                          {item.username ? ` (@${item.username})` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          Workspace {item.businessId.slice(0, 8)}
                          {typeof item.pendingUpdates === "number"
                            ? ` · Pending updates ${item.pendingUpdates}`
                            : ""}
                        </p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Check value={item.checks.token}>Bot token</Check>
                      <Check value={item.checks.localToken}>TENH token status</Check>
                      <Check value={item.checks.webhook}>Webhook</Check>
                      <Check value={item.checks.webhookUrl}>Webhook URL</Check>
                      <Check value={item.checks.allowedUpdates}>Message updates</Check>
                    </div>

                    <p className="mt-3 text-sm leading-5 text-slate-600">{item.detail}</p>

                    {item.remoteWebhookError ? (
                      <p className="mt-2 text-xs text-amber-700">
                        Telegram last webhook error: {item.remoteWebhookError}
                        {item.remoteWebhookErrorAt
                          ? ` · ${formatDate(item.remoteWebhookErrorAt)}`
                          : ""}
                      </p>
                    ) : null}

                    <ActivityRow activity={item.activity} />

                    {item.localError ? (
                      <p className="mt-2 text-xs text-red-600">Stored error: {item.localError}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Click <strong>Telegram health</strong> to check all active Telegram connections.
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">TENH system health</h3>
            <p className="mt-1 text-sm text-slate-500">
              Production domain, DNS, HTTPS/TLS, Vercel routing, database access, server environment readiness, and recent Messenger webhook processing failures.
            </p>
          </div>
          {data?.system ? <StatusBadge status={data.system.status} /> : null}
        </div>

        {data?.system ? (
          <div className="space-y-4">
            <SummaryCards summary={data.system.summary} totalLabel="Checks" />
            <div className="space-y-2">
              {data.system.checks.map((check) => (
                <div
                  key={check.key}
                  className="flex flex-col gap-2 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div>
                    <p className="font-bold text-slate-950">{check.label}</p>
                    <p className="mt-1 text-sm leading-5 text-slate-600">{check.detail}</p>
                  </div>
                  <StatusBadge status={check.status} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
            Click <strong>TENH system health</strong> or <strong>Run all diagnostics</strong>.
          </div>
        )}
      </section>
    </div>
  );
}
