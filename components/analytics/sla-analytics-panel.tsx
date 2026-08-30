"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type PeriodKey = "7d" | "30d" | "90d";

type Summary = {
  received: number;
  responded: number;
  waiting: number;
  avgFirstResponseSeconds: number;
  medianFirstResponseSeconds: number;
  slaMet: number;
  slaMissed: number;
  slaWaiting: number;
  slaRate: number | null;
  resolved: number;
  avgResolutionSeconds: number;
};

type DailyRow = {
  date: string;
  received: number;
  responded: number;
  avgFirstResponseSeconds: number;
  slaMet: number;
  slaMissed: number;
};

type AttentionRow = {
  conversationId: string;
  customerName: string;
  assignedName: string | null;
  status: string;
  firstIncomingAt: string;
  firstResponseAt: string | null;
  firstResponseSeconds: number | null;
  elapsedSeconds: number;
  slaState: "met" | "missed" | "waiting";
};

type AnalyticsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  businessId?: string;
  period?: PeriodKey;
  periodDays?: number;
  slaMinutes?: number;
  analytics?: {
    summary?: Partial<Summary>;
    daily?: DailyRow[];
    attention?: AttentionRow[];
  };
};

const EMPTY_SUMMARY: Summary = {
  received: 0,
  responded: 0,
  waiting: 0,
  avgFirstResponseSeconds: 0,
  medianFirstResponseSeconds: 0,
  slaMet: 0,
  slaMissed: 0,
  slaWaiting: 0,
  slaRate: null,
  resolved: 0,
  avgResolutionSeconds: 0,
};

function formatDuration(
  seconds: number,
) {
  const safeSeconds = Math.max(
    0,
    Math.round(seconds || 0),
  );

  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }

  const minutes = Math.floor(
    safeSeconds / 60,
  );
  const remainingSeconds =
    safeSeconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(
    minutes / 60,
  );
  const remainingMinutes =
    minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0
    ? `${days}d ${remainingHours}h`
    : `${days}d`;
}

function formatDate(
  value: string,
) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
    },
  ).format(date);
}

function formatDateTime(
  value: string,
) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function MetricIcon({
  tone,
  kind,
}: {
  tone: "blue" | "green" | "violet" | "red";
  kind: "clock" | "check" | "chat" | "timer";
}) {
  const toneClasses =
    tone === "green"
      ? "bg-emerald-50 text-emerald-600"
      : tone === "violet"
        ? "bg-violet-50 text-violet-600"
        : tone === "red"
          ? "bg-rose-50 text-rose-500"
          : "bg-blue-50 text-blue-600";

  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${toneClasses}`}
    >
      {kind === "check" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[21px] w-[21px]" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="m8.7 12.1 2.15 2.15 4.65-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : kind === "chat" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[21px] w-[21px]" aria-hidden="true">
          <rect x="4" y="5" width="16" height="13" rx="3.2" />
          <path d="M8 9h8M8 12h5.5" strokeLinecap="round" />
          <path d="m9 18-2.8 2v-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : kind === "timer" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[21px] w-[21px]" aria-hidden="true">
          <circle cx="12" cy="13" r="7" />
          <path d="M9 3h6M12 6V3M17.2 7.7l1.4-1.4M12 13V9.5M12 13l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[21px] w-[21px]" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7.7V12l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  footer,
  footerTone = "green",
  tone,
  icon,
}: {
  label: string;
  value: string;
  helper: string;
  footer?: string;
  footerTone?: "green" | "blue" | "violet" | "red" | "amber" | "slate";
  tone: "blue" | "green" | "violet" | "red";
  icon: "clock" | "check" | "chat" | "timer";
}) {
  const footerClass =
    footerTone === "blue"
      ? "text-blue-600"
      : footerTone === "violet"
        ? "text-violet-600"
        : footerTone === "red"
          ? "text-red-500"
          : footerTone === "amber"
            ? "text-amber-600"
            : footerTone === "slate"
              ? "text-slate-500"
              : "text-emerald-600";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3.5">
        <MetricIcon tone={tone} kind={icon} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-[28px] font-bold leading-none tracking-tight text-slate-950">
            {value}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            {helper}
          </p>
          {footer ? (
            <p className={`mt-3 text-[10px] font-semibold ${footerClass}`}>
              {footer}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StateBadge({
  state,
}: {
  state: AttentionRow["slaState"];
}) {
  if (state === "missed") {
    return (
      <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600">
        SLA missed
      </span>
    );
  }

  return (
    <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-600">
      Waiting
    </span>
  );
}

function getInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "T";
}

export function SlaAnalyticsPanel() {
  const [period, setPeriod] =
    useState<PeriodKey>("7d");
  const [slaMinutes, setSlaMinutes] =
    useState(10);
  const [summary, setSummary] =
    useState<Summary>(EMPTY_SUMMARY);
  const [daily, setDaily] =
    useState<DailyRow[]>([]);
  const [attention, setAttention] =
    useState<AttentionRow[]>([]);
  const [businessId, setBusinessId] =
    useState<string | null>(null);
  const [loading, setLoading] =
    useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const refreshTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const loadAnalytics = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const params = new URLSearchParams({
          period,
          slaMinutes: String(slaMinutes),
          tzOffsetMinutes: String(
            new Date().getTimezoneOffset(),
          ),
        });

        const response = await fetch(
          `/api/analytics/sla?${params.toString()}`,
          {
            cache: "no-store",
          },
        );

        const text = await response.text();
        let result: AnalyticsResponse | null = null;

        if (text.trim()) {
          try {
            result = JSON.parse(
              text,
            ) as AnalyticsResponse;
          } catch {
            throw new Error(
              "SLA analytics API returned invalid JSON.",
            );
          }
        }

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.details ||
              result?.error ||
              "Unable to load SLA analytics.",
          );
        }

        const nextSummary = {
          ...EMPTY_SUMMARY,
          ...(result.analytics?.summary ?? {}),
        };

        setSummary(nextSummary);
        setDaily(
          result.analytics?.daily ?? [],
        );
        setAttention(
          result.analytics?.attention ?? [],
        );
        setBusinessId(
          result.businessId ?? null,
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load SLA analytics.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, slaMinutes],
  );

  useEffect(() => {
    void loadAnalytics(false);
  }, [loadAnalytics]);

  useEffect(() => {
    if (!businessId) {
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let channel:
      ReturnType<typeof supabase.channel> | null =
      null;

    function scheduleRefresh() {
      if (refreshTimerRef.current) {
        clearTimeout(
          refreshTimerRef.current,
        );
      }

      refreshTimerRef.current = setTimeout(
        () => {
          refreshTimerRef.current = null;
          void loadAnalytics(true);
        },
        250,
      );
    }

    void supabase.auth
      .getSession()
      .then(async ({ data, error: sessionError }) => {
        if (
          cancelled ||
          sessionError ||
          !data.session
        ) {
          return;
        }

        await supabase.realtime.setAuth(
          data.session.access_token,
        );

        if (cancelled) {
          return;
        }

        channel = supabase
          .channel(
            `tenh-sla-v2-14-${businessId}`,
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "messages",
              filter: `business_id=eq.${businessId}`,
            },
            scheduleRefresh,
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "conversations",
              filter: `business_id=eq.${businessId}`,
            },
            scheduleRefresh,
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log(
                "[Tenh SLA V2.14] ✅ REALTIME READY",
              );
            }
          });
      });

    return () => {
      cancelled = true;

      if (refreshTimerRef.current) {
        clearTimeout(
          refreshTimerRef.current,
        );
        refreshTimerRef.current = null;
      }

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, loadAnalytics]);

  const maxDailyReceived = useMemo(
    () =>
      Math.max(
        1,
        ...daily.map(
          (item) => item.received,
        ),
      ),
    [daily],
  );

  const responseRows = useMemo(
    () =>
      daily.map((item) => ({
        ...item,
        responseSeconds: Math.max(
          0,
          Number(item.avgFirstResponseSeconds || 0),
        ),
      })),
    [daily],
  );

  const maxResponseSeconds = useMemo(
    () =>
      Math.max(
        1,
        ...responseRows.map(
          (item) => item.responseSeconds,
        ),
      ),
    [responseRows],
  );

  const bestDay = useMemo(() => {
    const eligible = responseRows.filter(
      (item) =>
        item.responded > 0 &&
        item.responseSeconds > 0,
    );

    return eligible.length > 0
      ? [...eligible].sort(
          (a, b) =>
            a.responseSeconds -
            b.responseSeconds,
        )[0]
      : null;
  }, [responseRows]);

  const busiestDay = useMemo(
    () =>
      responseRows.length > 0
        ? [...responseRows].sort(
            (a, b) =>
              b.received - a.received,
          )[0]
        : null,
    [responseRows],
  );

  const slowestDay = useMemo(() => {
    const eligible = responseRows.filter(
      (item) => item.responseSeconds > 0,
    );

    return eligible.length > 0
      ? [...eligible].sort(
          (a, b) =>
            b.responseSeconds -
            a.responseSeconds,
        )[0]
      : null;
  }, [responseRows]);

  const chartPoints = useMemo(() => {
    if (responseRows.length === 0) {
      return "";
    }

    return responseRows
      .map((item, index) => {
        const x =
          responseRows.length === 1
            ? 50
            : 7 +
              (index /
                (responseRows.length - 1)) *
                86;
        const y =
          84 -
          (item.responseSeconds /
            maxResponseSeconds) *
            64;

        return `${x},${Math.max(12, Math.min(84, y))}`;
      })
      .join(" ");
  }, [maxResponseSeconds, responseRows]);


  const responseRate =
    summary.received > 0
      ? Math.round(
          (summary.responded / summary.received) *
            100,
        )
      : 0;

  const resolutionRate =
    summary.received > 0
      ? Math.round(
          (summary.resolved / summary.received) *
            100,
        )
      : 0;

  // A workspace with no conversations has no SLA rate. Showing a
  // green 100% for "nothing happened" reads as a perfect score.
  const hasSlaRate =
    typeof summary.slaRate === "number";

  const slaRateLabel = hasSlaRate
    ? `${summary.slaRate}%`
    : "—";

  const slaFooterTone = !hasSlaRate
    ? "slate"
    : (summary.slaRate as number) >= 80
      ? "green"
      : (summary.slaRate as number) >= 60
        ? "amber"
        : "red";

  if (loading) {
    return (
      <section className="space-y-5">
        <div className="h-20 animate-pulse rounded-2xl bg-white" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse rounded-2xl bg-white"
            />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
          <div className="h-[430px] animate-pulse rounded-2xl bg-white" />
          <div className="h-[430px] animate-pulse rounded-2xl bg-white" />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-blue-600">
            Analytics
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-[28px]">
            Team performance
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor first response time, SLA health, and overall service performance.
          </p>
          {refreshing ? (
            <p className="mt-1 text-xs font-medium text-blue-600">
              Updating…
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {(
              ["7d", "30d", "90d"] as PeriodKey[]
            ).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`min-w-[58px] border-r border-slate-200 px-3 py-2.5 text-xs font-semibold transition last:border-r-0 ${
                  period === value
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <label className="flex h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-sm">
            <span>Target</span>
            <select
              value={slaMinutes}
              onChange={(event) =>
                setSlaMinutes(
                  Number(event.target.value),
                )
              }
              className="bg-transparent font-semibold text-slate-900 outline-none"
            >
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
            </select>
          </label>

          <div
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm"
            title={`Selected period: ${period}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
              <rect x="4" y="5.5" width="16" height="14" rx="2" />
              <path d="M8 3.5v4M16 3.5v4M4 9.5h16" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="First response time"
          value={formatDuration(
            summary.medianFirstResponseSeconds,
          )}
          helper={`Median · ${summary.responded} ${summary.responded === 1 ? "reply" : "replies"}`}
          footer={`↘ Avg. ${formatDuration(summary.avgFirstResponseSeconds)}`}
          footerTone="green"
          tone="blue"
          icon="clock"
        />
        <SummaryCard
          label="SLA met"
          value={slaRateLabel}
          helper={`${summary.slaMet} met · ${summary.slaMissed} missed`}
          footer={
            hasSlaRate
              ? `${summary.slaRate}% within ${slaMinutes} min target`
              : "No conversations in this period"
          }
          footerTone={slaFooterTone}
          tone="green"
          icon="check"
        />
        <SummaryCard
          label="Conversations"
          value={String(summary.received)}
          helper={`${summary.responded} responded · ${summary.waiting} waiting`}
          footer={`↑ ${responseRate}% response rate`}
          footerTone={responseRate >= 80 ? "green" : responseRate >= 50 ? "amber" : "red"}
          tone="violet"
          icon="chat"
        />
        <SummaryCard
          label="Resolution time"
          value={formatDuration(
            summary.avgResolutionSeconds,
          )}
          helper={`Average · ${summary.resolved} resolved / closed`}
          footer={`${summary.resolved > 0 ? "↑" : "•"} ${summary.resolved} resolved · ${resolutionRate}% of received`}
          footerTone={summary.resolved > 0 ? "green" : "slate"}
          tone="red"
          icon="timer"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-950">
                Response trend
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Daily conversation volume and average first response time.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              Daily
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-5 text-[10px] font-medium text-slate-500">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Conversations
            </span>
            <span className="flex items-center gap-2">
              <span className="h-[2px] w-4 bg-blue-500" />
              Avg. first response time
            </span>
          </div>

          {responseRows.length === 0 ? (
            <div className="mt-5 flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
              No customer messages in this period.
            </div>
          ) : (
            <div className="mt-4">
              <div className="relative h-[250px] overflow-hidden rounded-xl border border-slate-100 bg-white px-2 pt-4">
                <div className="pointer-events-none absolute inset-x-3 top-5 bottom-8 flex flex-col justify-between">
                  {[0, 1, 2, 3, 4].map((line) => (
                    <span key={line} className="border-t border-dashed border-slate-200" />
                  ))}
                </div>

                <div className="absolute inset-x-4 top-5 bottom-9 flex items-end justify-around gap-2">
                  {responseRows.map((item) => {
                    const height = Math.max(
                      8,
                      Math.round(
                        (item.received /
                          maxDailyReceived) *
                          72,
                      ),
                    );

                    return (
                      <div
                        key={`bar-${item.date}`}
                        className="flex h-full min-w-0 flex-1 items-end justify-center"
                      >
                        <div
                          className="w-[56%] max-w-12 rounded-t bg-blue-100"
                          style={{ height: `${height}%` }}
                          title={`${item.received} conversations`}
                        />
                      </div>
                    );
                  })}
                </div>

                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-x-4 top-5 h-[calc(100%-3.3rem)] w-[calc(100%-2rem)] overflow-visible"
                  aria-hidden="true"
                >
                  <polyline
                    points={chartPoints}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    vectorEffect="non-scaling-stroke"
                    className="text-blue-600"
                  />
                  {responseRows.map((item, index) => {
                    const x =
                      responseRows.length === 1
                        ? 50
                        : 7 +
                          (index /
                            (responseRows.length - 1)) *
                            86;
                    const y =
                      84 -
                      (item.responseSeconds /
                        maxResponseSeconds) *
                        64;

                    return (
                      <circle
                        key={`point-${item.date}`}
                        cx={x}
                        cy={Math.max(12, Math.min(84, y))}
                        r="1.4"
                        fill="currentColor"
                        className="text-blue-600"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>

                <div className="absolute inset-x-4 bottom-2 flex justify-around gap-1 text-center text-[9px] font-medium text-slate-400">
                  {responseRows.map((item) => (
                    <span key={`label-${item.date}`} className="min-w-0 flex-1 truncate">
                      {formatDate(`${item.date}T00:00:00`)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid overflow-hidden rounded-xl border border-slate-200 sm:grid-cols-3">
                <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 sm:border-b-0 sm:border-r">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    ↗
                  </span>
                  <div>
                    <p className="text-[10px] font-medium text-slate-400">Best day</p>
                    <p className="text-xs font-bold text-emerald-600">
                      {bestDay ? formatDate(`${bestDay.date}T00:00:00`) : "—"}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {bestDay ? formatDuration(bestDay.responseSeconds) : "No response data"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 sm:border-b-0 sm:border-r">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                    ▥
                  </span>
                  <div>
                    <p className="text-[10px] font-medium text-slate-400">Busiest day</p>
                    <p className="text-xs font-bold text-blue-600">
                      {busiestDay ? formatDate(`${busiestDay.date}T00:00:00`) : "—"}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {busiestDay ? `${busiestDay.received} conversations` : "No conversation data"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-500">
                    ↘
                  </span>
                  <div>
                    <p className="text-[10px] font-medium text-slate-400">Slowest day</p>
                    <p className="text-xs font-bold text-red-500">
                      {slowestDay ? formatDate(`${slowestDay.date}T00:00:00`) : "—"}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {slowestDay ? formatDuration(slowestDay.responseSeconds) : "No response data"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-sm font-bold text-slate-950">
                Needs attention
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Conversations with missed SLA or late first responses.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-600">
                {summary.slaMissed} missed
              </span>
              <span className="text-slate-400">›</span>
            </div>
          </div>

          {attention.length === 0 ? (
            <div className="flex min-h-[335px] flex-col items-center justify-center px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-xl font-bold text-emerald-600">
                ✓
              </span>
              <p className="mt-3 text-sm font-semibold text-slate-800">
                No SLA issues in this period.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Waiting and missed first responses will appear here.
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[360px] space-y-2 overflow-y-auto p-3 sm:p-4">
                {attention.map((item) => (
                  <div
                    key={`${item.conversationId}-${item.firstIncomingAt}`}
                    className="rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-bold text-violet-600">
                        {getInitial(item.customerName)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-slate-900">
                          {item.customerName}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {item.assignedName ?? "Unassigned"}
                        </p>
                        <p className="mt-1 truncate text-[10px] text-slate-400">
                          Customer message · {formatDateTime(item.firstIncomingAt)}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <StateBadge state={item.slaState} />
                        <p
                          className={`mt-2 text-sm font-bold ${
                            item.slaState === "missed"
                              ? "text-red-500"
                              : "text-amber-500"
                          }`}
                        >
                          {formatDuration(item.elapsedSeconds)}
                        </p>
                        <Link
                          href={`/dashboard/inbox?conversation=${encodeURIComponent(
                            item.conversationId,
                          )}`}
                          className="mt-2 inline-flex rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Reply
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Link
                href="/dashboard/analytics?view=conversation-reports"
                className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs font-semibold text-blue-600 hover:bg-slate-50 sm:px-5"
              >
                <span>View all missed ({attention.length})</span>
                <span aria-hidden="true">›</span>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-800">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
          i
        </span>
        <p>
          First response time is measured from when a customer sends a message to the first outgoing reply from your team. Spam conversations are excluded from these metrics.
        </p>
      </div>
    </section>
  );
}
