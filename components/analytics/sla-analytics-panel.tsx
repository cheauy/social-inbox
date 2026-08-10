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
  slaRate: number;
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
  slaRate: 100,
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

function SummaryCard({
  label,
  value,
  helper,
  danger = false,
  good = false,
}: {
  label: string;
  value: string;
  helper: string;
  danger?: boolean;
  good?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-bold ${
          danger
            ? "text-red-600"
            : good
              ? "text-emerald-600"
              : "text-slate-950"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {helper}
      </p>
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
      <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700">
        SLA missed
      </span>
    );
  }

  return (
    <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">
      Waiting
    </span>
  );
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

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex min-h-[260px] items-center justify-center text-sm text-slate-500">
          Loading response analytics...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-950">
                SLA & response time
              </h2>
              {refreshing ? (
                <span className="text-xs font-medium text-blue-600">
                  Updating…
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Measures the first reply after a customer message enters the selected period.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(
                ["7d", "30d", "90d"] as PeriodKey[]
              ).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setPeriod(value)
                  }
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    period === value
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {value === "7d"
                    ? "7 days"
                    : value === "30d"
                      ? "30 days"
                      : "90 days"}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
              SLA target
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
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="First response"
          value={formatDuration(
            summary.avgFirstResponseSeconds,
          )}
          helper={`Median ${formatDuration(
            summary.medianFirstResponseSeconds,
          )}`}
        />
        <SummaryCard
          label="SLA met"
          value={`${summary.slaRate}%`}
          helper={`${summary.slaMet} met · ${summary.slaMissed} missed`}
          good={
            summary.slaMissed === 0 &&
            summary.received > 0
          }
          danger={summary.slaRate < 80}
        />
        <SummaryCard
          label="Conversations received"
          value={String(summary.received)}
          helper={`${summary.responded} responded · ${summary.waiting} waiting`}
        />
        <SummaryCard
          label="Resolution time"
          value={formatDuration(
            summary.avgResolutionSeconds,
          )}
          helper={`${summary.resolved} resolved / closed`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-950">
                Response trend
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Daily conversation volume and average first response.
              </p>
            </div>
          </div>

          {daily.length === 0 ? (
            <div className="mt-5 flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
              No customer messages in this period.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {daily.map((item) => {
                const width = Math.max(
                  4,
                  Math.round(
                    (item.received /
                      maxDailyReceived) *
                      100,
                  ),
                );

                return (
                  <div
                    key={item.date}
                    className="grid grid-cols-[58px_minmax(0,1fr)_92px] items-center gap-3"
                  >
                    <span className="text-xs font-medium text-slate-500">
                      {formatDate(
                        `${item.date}T00:00:00`,
                      )}
                    </span>

                    <div className="h-8 overflow-hidden rounded-lg bg-slate-100">
                      <div
                        className="flex h-full items-center rounded-lg bg-blue-100 px-2 text-[11px] font-semibold text-blue-700"
                        style={{
                          width: `${width}%`,
                          minWidth: "38px",
                        }}
                      >
                        {item.received}
                      </div>
                    </div>

                    <span className="text-right text-xs font-semibold text-slate-700">
                      {formatDuration(
                        item.avgFirstResponseSeconds,
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-950">
                Needs attention
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Waiting or late first responses.
              </p>
            </div>

            {summary.slaMissed > 0 ? (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700">
                {summary.slaMissed} missed
              </span>
            ) : null}
          </div>

          {attention.length === 0 ? (
            <div className="mt-5 flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50 text-center text-sm font-medium text-emerald-700">
              No SLA issues in this period.
            </div>
          ) : (
            <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {attention.map((item) => (
                <Link
                  key={`${item.conversationId}-${item.firstIncomingAt}`}
                  href={`/dashboard/inbox?conversation=${encodeURIComponent(
                    item.conversationId,
                  )}`}
                  className="block rounded-xl border border-slate-200 p-3 transition hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.customerName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {item.assignedName
                          ? `Assigned to ${item.assignedName}`
                          : "Unassigned"}
                      </p>
                    </div>
                    <StateBadge
                      state={item.slaState}
                    />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500">
                        Customer message
                      </p>
                      <p className="text-xs font-medium text-slate-700">
                        {formatDateTime(
                          item.firstIncomingAt,
                        )}
                      </p>
                    </div>
                    <p
                      className={`text-sm font-bold ${
                        item.slaState === "missed"
                          ? "text-red-600"
                          : "text-amber-600"
                      }`}
                    >
                      {formatDuration(
                        item.elapsedSeconds,
                      )}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
       
        a conversation enters the selected period when it receives an incoming customer message. First-response time is measured to the first outgoing reply after that message. Spam conversations are excluded.
      </div>
    </section>
  );
}
