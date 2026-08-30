"use client";

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

type AttentionItem = {
  id: string;
  title: string;
  meta: string;
  status: HealthStatus;
  detail: string;
  secondary?: string | null;
  failedChecks: string[];
  passedChecks: number;
};

function StatusIcon({ status }: { status: HealthStatus }) {
  const classes =
    status === "healthy"
      ? "border-emerald-500 text-emerald-600"
      : status === "warning"
        ? "border-amber-500 text-amber-600"
        : "border-red-500 text-red-600";

  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${classes}`}
      aria-hidden="true"
    >
      {status === "healthy" ? "✓" : status === "warning" ? "!" : "!"}
    </span>
  );
}

function Check({ value, children }: { value: CheckValue; children: ReactNode }) {
  const classes =
    value === true
      ? "bg-emerald-50 text-emerald-700"
      : value === false
        ? "bg-red-100 text-red-700"
        : "bg-slate-100 text-slate-500";

  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${classes}`}>
      {value === true ? "✓" : value === false ? "×" : "—"} {children}
    </span>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Never recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "not run yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";

  const difference = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(difference / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ActivityRow({ activity }: { activity: ActivitySnapshot }) {
  return (
    <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-3">
      <div>
        <span className="font-semibold text-slate-700">Last inbound:</span>{" "}
        {formatDate(activity.lastInboundAt)}
      </div>
      <div>
        <span className="font-semibold text-slate-700">Last outbound:</span>{" "}
        {formatDate(activity.lastOutboundAt)}
      </div>
      <div>
        <span className="font-semibold text-slate-700">Failed sends 24h:</span>{" "}
        {activity.failedOutbound24h}
      </div>
      {activity.error ? (
        <div className="text-amber-700 sm:col-span-3">
          Activity check warning: {activity.error}
        </div>
      ) : null}
    </div>
  );
}

function messengerCheckRows(item: MessengerItem) {
  return [
    ["Token", item.checks.token],
    ["Page identity", item.checks.identity],
    ["Conversations API", item.checks.conversations],
    ["Webhook app", item.checks.webhook],
    ["Messages field", item.checks.messagesField],
    ["Feed/comments", item.checks.feedField],
    ["Permissions", item.checks.permissions],
  ] as const;
}

function telegramCheckRows(item: TelegramItem) {
  return [
    ["Bot token", item.checks.token],
    ["TENH token status", item.checks.localToken],
    ["Webhook delivery", item.checks.webhook],
    ["Webhook URL", item.checks.webhookUrl],
    ["Message updates", item.checks.allowedUpdates],
  ] as const;
}

function FailedPills({ item }: { item: AttentionItem }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {item.failedChecks.map((label) => (
        <span
          key={label}
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            item.status === "error"
              ? "bg-red-100 text-red-700"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          × {label}
        </span>
      ))}
      {item.passedChecks > 0 ? (
        <span className="text-[10px] text-slate-500">
          {item.passedChecks} other{item.passedChecks === 1 ? "" : "s"} passed
        </span>
      ) : null}
    </div>
  );
}

function MessengerDetail({ item }: { item: MessengerItem }) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap gap-1.5">
        {messengerCheckRows(item).map(([label, value]) => (
          <Check key={label} value={value}>
            {label}
          </Check>
        ))}
      </div>
      <p className="text-sm leading-5 text-slate-600">{item.detail}</p>
      {item.permissions.missingScopes.length > 0 ? (
        <p className="text-xs text-amber-700">
          Missing scopes: {item.permissions.missingScopes.join(", ")}
        </p>
      ) : null}
      {item.permissions.expiresAt ? (
        <p className="text-xs text-slate-400">
          Token expiry reported by Meta: {formatDate(item.permissions.expiresAt)}
        </p>
      ) : null}
      {item.permissions.error ? (
        <p className="text-xs text-amber-700">
          Permission check: {item.permissions.error}
        </p>
      ) : null}
      <ActivityRow activity={item.activity} />
      {item.localError ? (
        <p className="text-xs text-red-600">Stored error: {item.localError}</p>
      ) : null}
    </div>
  );
}

function TelegramDetail({ item }: { item: TelegramItem }) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap gap-1.5">
        {telegramCheckRows(item).map(([label, value]) => (
          <Check key={label} value={value}>
            {label}
          </Check>
        ))}
      </div>
      <p className="text-sm leading-5 text-slate-600">{item.detail}</p>
      {item.remoteWebhookError ? (
        <p className="text-xs text-amber-700">
          Telegram last webhook error: {item.remoteWebhookError}
          {item.remoteWebhookErrorAt ? ` · ${formatDate(item.remoteWebhookErrorAt)}` : ""}
        </p>
      ) : null}
      <ActivityRow activity={item.activity} />
      {item.localError ? (
        <p className="text-xs text-red-600">Stored error: {item.localError}</p>
      ) : null}
    </div>
  );
}

function HealthyAccordion({
  title,
  children,
  defaultOpen = true,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group overflow-hidden rounded-xl border border-slate-200 bg-white"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
        <span className="flex min-w-0 items-center gap-2">
          <StatusIcon status="healthy" />
          <span className="truncate">{title}</span>
        </span>
        <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-slate-100 px-4 pb-3">{children}</div>
    </details>
  );
}

export function AdminChannelHealth() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [running, setRunning] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  async function run(platform: Platform) {
    setRunning(platform);
    setError(null);
    setMenuOpen(false);

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

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    for (const item of data?.messenger?.items ?? []) {
      if (item.status === "healthy") continue;
      const rows = messengerCheckRows(item);
      const failedChecks = rows
        .filter(([, value]) => value === false)
        .map(([label]) => label);
      const passedChecks = rows.filter(([, value]) => value === true).length;

      items.push({
        id: `messenger:${item.id}`,
        title: item.name,
        meta: `Messenger · page ${item.pageId ?? "unknown"}`,
        status: item.status,
        detail: item.detail,
        secondary:
          item.permissions.error ??
          item.localError ??
          (item.permissions.missingScopes.length > 0
            ? `Missing scopes: ${item.permissions.missingScopes.join(", ")}`
            : null),
        failedChecks,
        passedChecks,
      });
    }

    for (const item of data?.telegram?.items ?? []) {
      if (item.status === "healthy") continue;
      const rows = telegramCheckRows(item);
      const failedChecks = rows
        .filter(([, value]) => value === false)
        .map(([label]) => label);
      const passedChecks = rows.filter(([, value]) => value === true).length;

      items.push({
        id: `telegram:${item.id}`,
        title: item.name,
        meta: `Telegram${item.username ? ` · @${item.username}` : ""}`,
        status: item.status,
        detail: item.detail,
        secondary:
          item.remoteWebhookError ?? item.localError ??
          (typeof item.pendingUpdates === "number" && item.pendingUpdates > 0
            ? `${item.pendingUpdates} pending update${item.pendingUpdates === 1 ? "" : "s"}`
            : null),
        failedChecks,
        passedChecks,
      });
    }

    for (const check of data?.system?.checks ?? []) {
      if (check.status === "healthy") continue;
      items.push({
        id: `system:${check.key}`,
        title: check.label,
        meta: "System",
        status: check.status,
        detail: check.detail,
        failedChecks: [],
        passedChecks: 0,
      });
    }

    return items;
  }, [data]);

  const overall = useMemo(() => {
    const messengerItems = data?.messenger?.items ?? [];
    const telegramItems = data?.telegram?.items ?? [];
    const systemChecks = data?.system?.checks ?? [];

    const statuses: HealthStatus[] = [
      ...messengerItems.map((item) => item.status),
      ...telegramItems.map((item) => item.status),
      ...systemChecks.map((item) => item.status),
    ];

    return {
      total: statuses.length,
      healthy: statuses.filter((status) => status === "healthy").length,
      warning: statuses.filter((status) => status === "warning").length,
      error: statuses.filter((status) => status === "error").length,
    };
  }, [data]);

  const healthyMessenger = (data?.messenger?.items ?? []).filter(
    (item) => item.status === "healthy",
  );
  const healthyTelegram = (data?.telegram?.items ?? []).filter(
    (item) => item.status === "healthy",
  );
  const healthySystem = (data?.system?.checks ?? []).filter(
    (item) => item.status === "healthy",
  );

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
              Admin
            </p>
            <h2 className="mt-1 text-[28px] font-bold leading-none text-slate-950">
              Diagnostics
            </h2>
          </div>

          <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={Boolean(running)}
              onClick={() => void run("all")}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span aria-hidden="true">⟳</span>
              {running === "all" ? "Running checks..." : "Run all checks"}
            </button>

            <button
              type="button"
              aria-label="More diagnostic options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-slate-100"
            >
              ⋯
            </button>

            {menuOpen ? (
              <div className="absolute right-0 top-12 z-30 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {([
                  ["messenger", "Run Messenger checks"],
                  ["telegram", "Run Telegram checks"],
                  ["system", "Run system checks"],
                ] as const).map(([platform, label]) => (
                  <button
                    key={platform}
                    type="button"
                    disabled={Boolean(running)}
                    onClick={() => void run(platform)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {running === platform ? "Checking..." : label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {data ? (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 ${
              overall.error > 0
                ? "border-red-300 bg-red-100/80"
                : overall.warning > 0
                  ? "border-amber-300 bg-amber-50"
                  : "border-emerald-300 bg-emerald-50"
            }`}
          >
            <div className="flex items-start gap-3">
              <StatusIcon
                status={overall.error > 0 ? "error" : overall.warning > 0 ? "warning" : "healthy"}
              />
              <div>
                <p
                  className={`text-sm font-bold ${
                    overall.error > 0
                      ? "text-red-900"
                      : overall.warning > 0
                        ? "text-amber-900"
                        : "text-emerald-900"
                  }`}
                >
                  {overall.error > 0 || overall.warning > 0
                    ? `${overall.error} error${overall.error === 1 ? "" : "s"}, ${overall.warning} warning${overall.warning === 1 ? "" : "s"}`
                    : "All diagnostics healthy"}
                </p>
                <p
                  className={`mt-0.5 text-xs ${
                    overall.error > 0
                      ? "text-red-700"
                      : overall.warning > 0
                        ? "text-amber-700"
                        : "text-emerald-700"
                  }`}
                >
                  {overall.healthy} of {overall.total} checks healthy · last run {formatRelative(data.generatedAt)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            Run diagnostics to check Messenger, Telegram and TENH system health. No test messages are sent and access tokens are never displayed.
          </div>
        )}

        {error ? (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      {data ? (
        <>
          <section>
            <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
              Needs attention
            </p>

            {attentionItems.length === 0 ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-800">
                No diagnostics need attention.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {attentionItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`relative px-4 py-4 sm:px-5 ${
                      index > 0 ? "border-t border-slate-200" : ""
                    }`}
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-0.5 ${
                        item.status === "error" ? "bg-red-500" : "bg-amber-500"
                      }`}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="font-bold text-slate-950">{item.title}</p>
                      <p className="text-xs text-slate-400">{item.meta}</p>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-5 text-slate-700">
                      {item.detail}
                    </p>
                    {item.secondary ? (
                      <p
                        className={`mt-1 text-xs ${
                          item.status === "error" ? "text-red-700" : "text-amber-700"
                        }`}
                      >
                        {item.secondary}
                      </p>
                    ) : null}
                    <FailedPills item={item} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.15em] text-slate-400">
              Healthy
            </p>

            <div className="space-y-2">
              <HealthyAccordion
                title={
                  <>
                    Messenger · {healthyMessenger.length} of {data.messenger?.items.length ?? 0} connections healthy
                  </>
                }
              >
                {healthyMessenger.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    No Messenger connection is fully healthy in this run.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {healthyMessenger.map((item) => (
                      <div key={item.id} className="py-3">
                        <p className="font-semibold text-slate-900">
                          {item.name}
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            page {item.pageId ?? "unknown"}
                          </span>
                        </p>
                        <MessengerDetail item={item} />
                      </div>
                    ))}
                  </div>
                )}
              </HealthyAccordion>

              <HealthyAccordion
                title={
                  <>
                    Telegram · {healthyTelegram.length} of {data.telegram?.items.length ?? 0} bots healthy
                  </>
                }
              >
                {healthyTelegram.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    No Telegram bot is fully healthy in this run.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {healthyTelegram.map((item) => (
                      <div key={item.id} className="py-3">
                        <p className="font-semibold text-slate-900">
                          {item.name}
                          {item.username ? (
                            <span className="ml-1 text-xs font-normal text-slate-400">
                              (@{item.username})
                            </span>
                          ) : null}
                        </p>
                        <TelegramDetail item={item} />
                      </div>
                    ))}
                  </div>
                )}
              </HealthyAccordion>

              <HealthyAccordion
                title={
                  <>
                    System · {healthySystem.length} of {data.system?.checks.length ?? 0} checks passing
                  </>
                }
              >
                {healthySystem.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    No system check is fully healthy in this run.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {healthySystem.map((check) => (
                      <div key={check.key} className="py-3">
                        <p className="font-semibold text-slate-900">{check.label}</p>
                        <p className="mt-1 text-sm leading-5 text-slate-600">
                          {check.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </HealthyAccordion>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
