"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type PeriodKey = "7d" | "30d" | "90d";

type AgentSummary = {
  totalOutgoing: number;
  attributedOutgoing: number;
  unattributedOutgoing: number;
  attributionRate: number;
  totalFirstResponses: number;
  attributedFirstResponses: number;
  unattributedFirstResponses: number;
  avgFirstResponseSeconds: number;
  slaMet: number;
  slaMissed: number;
  slaRate: number | null;
};

type AgentRow = {
  memberId: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl: string | null;
  firstResponses: number;
  avgFirstResponseSeconds: number;
  medianFirstResponseSeconds: number;
  slaMet: number;
  slaMissed: number;
  slaRate: number | null;
  outgoingMessages: number;
  conversationsReplied: number;
  resolvedActions: number;
};

type AgentAnalyticsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  businessId?: string;
  analytics?: {
    summary?: Partial<AgentSummary>;
    agents?: AgentRow[];
  };
};

const EMPTY_SUMMARY: AgentSummary = {
  totalOutgoing: 0,
  attributedOutgoing: 0,
  unattributedOutgoing: 0,
  attributionRate: 100,
  totalFirstResponses: 0,
  attributedFirstResponses: 0,
  unattributedFirstResponses: 0,
  avgFirstResponseSeconds: 0,
  slaMet: 0,
  slaMissed: 0,
  slaRate: null,
};

function formatDuration(
  seconds: number,
) {
  const safe = Math.max(
    0,
    Math.round(seconds || 0),
  );

  if (safe < 60) {
    return `${safe}s`;
  }

  const minutes = Math.floor(
    safe / 60,
  );
  const secondsLeft = safe % 60;

  if (minutes < 60) {
    return secondsLeft
      ? `${minutes}m ${secondsLeft}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(
    minutes / 60,
  );
  const minutesLeft = minutes % 60;

  return minutesLeft
    ? `${hours}h ${minutesLeft}m`
    : `${hours}h`;
}

function getInitial(
  name: string,
) {
  return (
    name.trim().charAt(0).toUpperCase() ||
    "A"
  );
}

function roleLabel(
  role: string,
) {
  if (role === "owner") {
    return "Owner";
  }

  if (role === "admin") {
    return "Admin";
  }

  return "Agent";
}


type SpeedStatus =
  | "fast"
  | "normal"
  | "slow"
  | "need-data";

function getAgentSpeedStatus(
  agent: AgentRow,
  slaMinutes: number,
): SpeedStatus {
  /*
   * V2.14.2: avoid judging an agent from only one or two
   * attributed first replies. Three is the minimum sample used
   * before showing Fast / Normal / Slow.
   */
  if (agent.firstResponses < 3) {
    return "need-data";
  }

  const targetSeconds =
    Math.max(slaMinutes, 1) * 60;
  const slaRate =
    agent.slaRate ?? 0;

  if (
    agent.avgFirstResponseSeconds <=
      targetSeconds * 0.5 &&
    slaRate >= 90
  ) {
    return "fast";
  }

  if (
    agent.avgFirstResponseSeconds >
      targetSeconds ||
    slaRate < 70
  ) {
    return "slow";
  }

  return "normal";
}

function speedStatusCopy(
  status: SpeedStatus,
) {
  if (status === "fast") {
    return {
      label: "Fast",
      dot: "bg-emerald-500",
      badge:
        "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (status === "slow") {
    return {
      label: "Slow",
      dot: "bg-red-500",
      badge:
        "border-red-200 bg-red-50 text-red-700",
    };
  }

  if (status === "normal") {
    return {
      label: "Normal",
      dot: "bg-amber-500",
      badge:
        "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  return {
    label: "Need more data",
    dot: "bg-slate-300",
    badge:
      "border-slate-200 bg-slate-50 text-slate-500",
  };
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {helper}
      </p>
    </div>
  );
}

export function AgentPerformancePanel() {
  const [period, setPeriod] =
    useState<PeriodKey>("7d");
  const [slaMinutes, setSlaMinutes] =
    useState(10);
  const [summary, setSummary] =
    useState<AgentSummary>(
      EMPTY_SUMMARY,
    );
  const [agents, setAgents] =
    useState<AgentRow[]>([]);
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
        });

        const response = await fetch(
          `/api/analytics/agents?${params.toString()}`,
          {
            cache: "no-store",
          },
        );

        const responseText =
          await response.text();

        let result:
          | AgentAnalyticsResponse
          | null = null;

        if (responseText.trim()) {
          try {
            result = JSON.parse(
              responseText,
            ) as AgentAnalyticsResponse;
          } catch {
            throw new Error(
              "Agent analytics API returned invalid JSON.",
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
              "Unable to load agent performance.",
          );
        }

        setSummary({
          ...EMPTY_SUMMARY,
          ...(result.analytics?.summary ?? {}),
        });
        setAgents(
          result.analytics?.agents ?? [],
        );
        setBusinessId(
          result.businessId ?? null,
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load agent performance.",
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
      .then(async ({
        data,
        error: sessionError,
      }) => {
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
            `tenh-agent-performance-v2-14-1-${businessId}`,
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
              event: "INSERT",
              schema: "public",
              table:
                "conversation_activity",
              filter: `business_id=eq.${businessId}`,
            },
            scheduleRefresh,
          )
          .subscribe((status) => {
            if (
              status === "SUBSCRIBED"
            ) {
              console.log(
                "[Tenh Agent Analytics V2.14.2] ✅ REALTIME READY",
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
        void supabase.removeChannel(
          channel,
        );
      }
    };
  }, [businessId, loadAnalytics]);

  const rankedAgents = useMemo(() => {
    return agents
      .filter(
        (agent) =>
          agent.firstResponses >= 3,
      )
      .map((agent) => ({
        agent,
        speedStatus:
          getAgentSpeedStatus(
            agent,
            slaMinutes,
          ),
      }))
      .sort((first, second) => {
        const statusOrder: Record<
          Exclude<
            SpeedStatus,
            "need-data"
          >,
          number
        > = {
          fast: 0,
          normal: 1,
          slow: 2,
        };

        const firstOrder =
          statusOrder[
            first.speedStatus as Exclude<
              SpeedStatus,
              "need-data"
            >
          ];
        const secondOrder =
          statusOrder[
            second.speedStatus as Exclude<
              SpeedStatus,
              "need-data"
            >
          ];

        if (firstOrder !== secondOrder) {
          return firstOrder - secondOrder;
        }

        const firstSla =
          first.agent.slaRate ?? 0;
        const secondSla =
          second.agent.slaRate ?? 0;

        if (firstSla !== secondSla) {
          return secondSla - firstSla;
        }

        return (
          first.agent
            .avgFirstResponseSeconds -
          second.agent
            .avgFirstResponseSeconds
        );
      });
  }, [agents, slaMinutes]);

  const rankByMemberId = useMemo(() => {
    return new Map(
      rankedAgents.map(
        (item, index) => [
          item.agent.memberId,
          index + 1,
        ],
      ),
    );
  }, [rankedAgents]);

  const slowAgents = useMemo(
    () =>
      rankedAgents.filter(
        (item) =>
          item.speedStatus === "slow",
      ),
    [rankedAgents],
  );

  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex min-h-[260px] items-center justify-center text-sm text-slate-500">
          Loading agent performance...
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
                Agent response performance
              </h2>
              {refreshing ? (
                <span className="text-xs font-medium text-blue-600">
                  Updating…
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Shows verified per-agent response speed, SLA health, and a clear Fast / Normal / Slow ranking for Owner/Admin.
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
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="bg-transparent font-semibold text-slate-900 outline-none"
              >
                <option value={5}>
                  5 min
                </option>
                <option value={10}>
                  10 min
                </option>
                <option value={15}>
                  15 min
                </option>
                <option value={30}>
                  30 min
                </option>
                <option value={60}>
                  1 hour
                </option>
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
        <MetricCard
          label="Attributed replies"
          value={`${summary.attributionRate}%`}
          helper={`${summary.attributedOutgoing} of ${summary.totalOutgoing} outgoing replies tracked`}
        />
        <MetricCard
          label="First responses"
          value={String(
            summary.attributedFirstResponses,
          )}
          helper={`${summary.unattributedFirstResponses} historical/unattributed`}
        />
        <MetricCard
          label="Avg first response"
          value={
            summary.attributedFirstResponses > 0
              ? formatDuration(
                  summary.avgFirstResponseSeconds,
                )
              : "—"
          }
          helper="Attributed first responses only"
        />
        <MetricCard
          label="SLA met"
          value={
            summary.slaRate === null
              ? "—"
              : `${summary.slaRate}%`
          }
          helper={`${summary.slaMet} met · ${summary.slaMissed} missed`}
        />
      </div>

      {summary.unattributedOutgoing > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">
            Tracking coverage:
          </span>{" "}
          {summary.attributedOutgoing} of {summary.totalOutgoing} outgoing replies in this period identify the Tenh Chat sender. Older replies are intentionally not guessed. New replies become accurate after the V2.14.1 send-route patches are installed.
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="font-semibold">
            Sender attribution is fully tracked
          </span>{" "}
          for outgoing replies in the selected period.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-950">
                  Response speed ranking
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Owner/Admin view of who is responding fast, normally, or slowly.
                </p>
              </div>

              {slowAgents.length > 0 ? (
                <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                  {slowAgents.length} need{slowAgents.length === 1 ? "s" : ""} attention
                </span>
              ) : rankedAgents.length > 0 ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  No slow agents
                </span>
              ) : null}
            </div>
          </div>

          {rankedAgents.length === 0 ? (
            <div className="px-5 py-6">
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm text-blue-800">
                <p className="font-semibold">
                  Need a little more data
                </p>
                <p className="mt-1 leading-5">
                  Each agent needs at least 3 verified first responses before Tenh Chat labels them Fast, Normal, or Slow. This prevents judging staff from only one reply.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {rankedAgents.map(
                ({
                  agent,
                  speedStatus,
                }, index) => {
                  const speed =
                    speedStatusCopy(
                      speedStatus,
                    );

                  return (
                    <div
                      key={agent.memberId}
                      className="grid gap-3 px-5 py-4 sm:grid-cols-[44px_minmax(0,1fr)_auto_auto] sm:items-center"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">
                        #{index + 1}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">
                          {agent.fullName}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {agent.firstResponses} verified first responses
                        </p>
                      </div>

                      <div className="sm:text-right">
                        <p className="text-sm font-bold text-slate-950">
                          {formatDuration(
                            agent.avgFirstResponseSeconds,
                          )}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          avg response
                        </p>
                      </div>

                      <span
                        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${speed.badge}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${speed.dot}`}
                        />
                        {speed.label}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-slate-950">
            How speed is judged
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Uses the selected {slaMinutes}-minute SLA target and verified first responses only.
          </p>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Fast
              </p>
              <p className="mt-1 text-xs leading-5 text-emerald-700">
                Average response is at or below half of the SLA target and SLA met is 90% or higher.
              </p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                Normal
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-700">
                Performance is between Fast and Slow. The agent is generally within an acceptable range.
              </p>
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                Slow
              </p>
              <p className="mt-1 text-xs leading-5 text-red-700">
                Average response is slower than the SLA target, or SLA met falls below 70%.
              </p>
            </div>
          </div>

          <p className="mt-4 text-[11px] leading-5 text-slate-400">
            At least 3 verified first responses are required before a speed label is shown.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-bold text-slate-950">
            Agent comparison
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Response speed is based only on first replies that have a verified Tenh Chat sender.
          </p>
        </div>

        {agents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No active team members found.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {agents.map((agent) => {
              const hasFirstResponses =
                agent.firstResponses > 0;
              const speedStatus =
                getAgentSpeedStatus(
                  agent,
                  slaMinutes,
                );
              const speed =
                speedStatusCopy(
                  speedStatus,
                );
              const rank =
                rankByMemberId.get(
                  agent.memberId,
                ) ?? null;

              return (
                <div
                  key={agent.memberId}
                  className="grid gap-4 px-5 py-5 xl:grid-cols-[minmax(220px,1.2fr)_repeat(6,minmax(90px,1fr))] xl:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {agent.profilePictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={
                          agent.profilePictureUrl
                        }
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700">
                        {getInitial(
                          agent.fullName,
                        )}
                      </div>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-slate-950">
                          {agent.fullName}
                        </p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {roleLabel(
                            agent.role,
                          )}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${speed.badge}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${speed.dot}`}
                          />
                          {speed.label}
                        </span>
                        {rank ? (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            Rank #{rank}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {agent.email}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 xl:hidden">
                      First responses
                    </p>
                    <p className="font-bold text-slate-950">
                      {agent.firstResponses}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      first replies
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 xl:hidden">
                      Avg response
                    </p>
                    <p className="font-bold text-slate-950">
                      {hasFirstResponses
                        ? formatDuration(
                            agent.avgFirstResponseSeconds,
                          )
                        : "—"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      median {hasFirstResponses
                        ? formatDuration(
                            agent.medianFirstResponseSeconds,
                          )
                        : "—"}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 xl:hidden">
                      SLA
                    </p>
                    <p className={`font-bold ${
                      agent.slaRate === null
                        ? "text-slate-400"
                        : agent.slaRate >= 90
                          ? "text-emerald-600"
                          : agent.slaRate >= 70
                            ? "text-amber-600"
                            : "text-red-600"
                    }`}>
                      {agent.slaRate === null
                        ? "—"
                        : `${agent.slaRate}%`}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {agent.slaMet} met · {agent.slaMissed} missed
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 xl:hidden">
                      Replies
                    </p>
                    <p className="font-bold text-slate-950">
                      {agent.outgoingMessages}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      outgoing
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 xl:hidden">
                      Customers
                    </p>
                    <p className="font-bold text-slate-950">
                      {agent.conversationsReplied}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      conversations
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 xl:hidden">
                      Resolved
                    </p>
                    <p className="font-bold text-slate-950">
                      {agent.resolvedActions}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      status actions
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
