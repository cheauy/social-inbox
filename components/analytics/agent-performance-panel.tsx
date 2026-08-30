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

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds || 0));

  if (safe < 60) {
    return `${safe}s`;
  }

  const minutes = Math.floor(safe / 60);
  const secondsLeft = safe % 60;

  if (minutes < 60) {
    return secondsLeft
      ? `${minutes}m ${secondsLeft}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const minutesLeft = minutes % 60;

  return minutesLeft
    ? `${hours}h ${minutesLeft}m`
    : `${hours}h`;
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "A";
}

function roleLabel(role: string) {
  if (role === "owner") {
    return "Owner";
  }

  if (role === "admin") {
    return "Admin";
  }

  return "Agent";
}

function formatRange(period: PeriodKey) {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);

  const sameYear = start.getFullYear() === end.getFullYear();
  const startText = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
  }).format(start);
  const endText = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(end);

  return `${startText} – ${endText}`;
}

function SpeedIcon({
  tone,
  size = "small",
}: {
  tone: "fast" | "normal" | "slow" | "unknown";
  size?: "small" | "large";
}) {
  const color =
    tone === "fast"
      ? "#16A34A"
      : tone === "normal"
        ? "#F59E0B"
        : tone === "slow"
          ? "#EF4444"
          : "#94A3B8";

  const background =
    tone === "fast"
      ? "#F0FDF4"
      : tone === "normal"
        ? "#FFF7ED"
        : tone === "slow"
          ? "#FEF2F2"
          : "#F8FAFC";

  const boxClass =
    size === "large"
      ? "h-10 w-10 rounded-xl"
      : "h-5 w-5 rounded-md";

  const iconClass =
    size === "large" ? "h-7 w-7" : "h-4 w-4";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${boxClass}`}
      style={{ backgroundColor: background }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={iconClass}
      >
        <path d="M4.7 16.9a8.5 8.5 0 1 1 14.6 0" />
        <path d="M12 5.5v1.4" />
        <path d="m7.4 7.4 1 1" />
        <path d="M5.6 12H7" />
        <path d="m16.6 7.4-1 1" />
        <path d="M17 12h1.4" />
        <path d="m12 12 4-3" />
        <circle cx="12" cy="12" r="1.2" fill={color} stroke="none" />
      </svg>
    </span>
  );
}

function metricIcon(icon: "reply" | "bolt" | "clock" | "shield") {
  if (icon === "reply") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
        <path d="M5 5h14v10H9l-4 4V5Z" strokeLinejoin="round" />
        <path d="M8 9h8M8 12h5" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === "bolt") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5" aria-hidden="true">
        <path d="m13 2-8 11h6l-1 9 9-12h-6V2Z" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === "clock") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-5 w-5" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <path d="M12 3 19 6v5c0 4.4-2.8 8.2-7 10-4.2-1.8-7-5.6-7-10V6l7-3Z" strokeLinejoin="round" />
      <path d="m9.5 12 1.7 1.7 3.5-3.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  helper,
  icon,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  icon: "reply" | "bolt" | "clock" | "shield";
  tone: "blue" | "green" | "purple" | "indigo";
}) {
  const palette = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-emerald-50 text-emerald-600",
    purple: "bg-violet-50 text-violet-600",
    indigo: "bg-indigo-50 text-indigo-600",
  }[tone];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${palette}`}>
          {metricIcon(icon)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-600">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{helper}</p>
        </div>
      </div>
    </div>
  );
}

function getSpeed(agent: AgentRow, slaMinutes: number) {
  if (agent.firstResponses < 3 || agent.slaRate === null) {
    return {
      label: "Need data",
      tone: "unknown" as const,
      classes: "bg-slate-100 text-slate-500",
    };
  }

  const targetSeconds = slaMinutes * 60;

  if (agent.avgFirstResponseSeconds <= targetSeconds / 2 && agent.slaRate >= 90) {
    return {
      label: "Fast",
      tone: "fast" as const,
      classes: "bg-emerald-100 text-emerald-700",
    };
  }

  if (agent.avgFirstResponseSeconds > targetSeconds || agent.slaRate < 70) {
    return {
      label: "Slow",
      tone: "slow" as const,
      classes: "bg-red-100 text-red-600",
    };
  }

  return {
    label: "Normal",
    tone: "normal" as const,
    classes: "bg-amber-100 text-amber-700",
  };
}

function PerformanceLine({
  agent,
  slaMinutes,
}: {
  agent: AgentRow;
  slaMinutes: number;
}) {
  if (agent.firstResponses < 1) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  // UI-only indicator built from the current verified agent metrics.
  // It is intentionally not labeled as historical trend because the
  // existing API does not return per-agent historical trend points.
  const target = Math.max(1, slaMinutes * 60);
  const responseRatio = Math.max(
    0,
    Math.min(2, agent.avgFirstResponseSeconds / target),
  );
  const responseScore = Math.max(0, 100 - responseRatio * 50);
  const slaScore = Math.max(0, Math.min(100, agent.slaRate ?? 0));
  const volumeScore = Math.max(0, Math.min(100, agent.firstResponses * 12));
  const blended = responseScore * 0.45 + slaScore * 0.4 + volumeScore * 0.15;

  const base = 22 - blended * 0.14;
  const points = [
    base + 5,
    base + 1,
    base + 3,
    base - 2,
    base,
    base - 5,
  ].map((value) => Math.max(4, Math.min(24, value)));

  const pointString = points
    .map((y, index) => `${4 + index * 13},${y}`)
    .join(" ");

  return (
    <svg
      viewBox="0 0 72 30"
      className="h-9 w-[78px]"
      aria-label="Current performance indicator"
    >
      <defs>
        <linearGradient
          id={`agent-performance-fill-${agent.memberId}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
        </linearGradient>
      </defs>

      <polygon
        points={`4,28 ${pointString} 69,28`}
        fill={`url(#agent-performance-fill-${agent.memberId})`}
      />
      <polyline
        points={pointString}
        fill="none"
        stroke="#2563EB"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="69"
        cy={points[5]}
        r="2.2"
        fill="#2563EB"
      />
    </svg>
  );
}

export function AgentPerformancePanel() {
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [slaMinutes, setSlaMinutes] = useState(10);
  const [summary, setSummary] = useState<AgentSummary>(EMPTY_SUMMARY);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        const responseText = await response.text();

        let result: AgentAnalyticsResponse | null = null;

        if (responseText.trim()) {
          try {
            result = JSON.parse(responseText) as AgentAnalyticsResponse;
          } catch {
            throw new Error("Agent analytics API returned invalid JSON.");
          }
        }

        if (!response.ok || !result?.success) {
          throw new Error(
            result?.details || result?.error || "Unable to load agent performance.",
          );
        }

        setSummary({
          ...EMPTY_SUMMARY,
          ...(result.analytics?.summary ?? {}),
        });
        setAgents(result.analytics?.agents ?? []);
        setBusinessId(result.businessId ?? null);
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
    let channel: ReturnType<typeof supabase.channel> | null = null;

    function scheduleRefresh() {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadAnalytics(true);
      }, 250);
    }

    void supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (cancelled || sessionError || !data.session) {
        return;
      }

      await supabase.realtime.setAuth(data.session.access_token);

      if (cancelled) {
        return;
      }

      channel = supabase
        .channel(`tenh-agent-performance-v2-14-1-${businessId}`)
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
            table: "conversation_activity",
            filter: `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("[Tenh Agent Analytics V2.14.1] ✅ REALTIME READY");
          }
        });
    });

    return () => {
      cancelled = true;

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, loadAnalytics]);

  const bestResponseMemberId = useMemo(() => {
    const eligible = agents.filter((agent) => agent.firstResponses > 0);

    if (!eligible.length) {
      return null;
    }

    return [...eligible].sort(
      (first, second) => first.avgFirstResponseSeconds - second.avgFirstResponseSeconds,
    )[0]?.memberId ?? null;
  }, [agents]);

  const leaderboard = useMemo(
    () =>
      [...agents].sort((first, second) => {
        const firstHas = first.firstResponses >= 3;
        const secondHas = second.firstResponses >= 3;

        if (firstHas !== secondHas) {
          return firstHas ? -1 : 1;
        }

        if (firstHas && secondHas) {
          return (
            first.avgFirstResponseSeconds - second.avgFirstResponseSeconds ||
            (second.slaRate ?? -1) - (first.slaRate ?? -1)
          );
        }

        return second.firstResponses - first.firstResponses;
      }),
    [agents],
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
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {(["7d", "30d", "90d"] as PeriodKey[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`min-w-[68px] border-r border-slate-200 px-4 py-3 text-sm font-semibold transition last:border-r-0 ${
                  period === value
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {value === "7d" ? "7 days" : value === "30d" ? "30 days" : "90 days"}
              </button>
            ))}
          </div>

          <label className="flex h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-500 shadow-sm">
            <span>SLA target</span>
            <select
              value={slaMinutes}
              onChange={(event) => setSlaMinutes(Number(event.target.value))}
              className="bg-transparent text-sm font-bold text-slate-900 outline-none"
            >
              <option value={5}>5 min</option>
              <option value={10}>10 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
            </select>
          </label>

          <div className="flex h-[46px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-600 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 text-slate-500" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
            </svg>
            <span>{formatRange(period)}</span>
          </div>

          {refreshing ? (
            <span className="text-xs font-medium text-blue-600">Updating…</span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Attributed replies"
          value={`${summary.attributionRate}%`}
          helper={`${summary.attributedOutgoing} of ${summary.totalOutgoing} outgoing replies tracked`}
          icon="reply"
          tone="blue"
        />
        <MetricCard
          label="First responses"
          value={String(summary.attributedFirstResponses)}
          helper={`${summary.unattributedFirstResponses} historical / unattributed`}
          icon="bolt"
          tone="green"
        />
        <MetricCard
          label="Avg first response"
          value={
            summary.attributedFirstResponses > 0
              ? formatDuration(summary.avgFirstResponseSeconds)
              : "—"
          }
          helper="Attributed first responses only"
          icon="clock"
          tone="purple"
        />
        <MetricCard
          label="SLA met"
          value={summary.slaRate === null ? "—" : `${summary.slaRate}%`}
          helper={`${summary.slaMet} met · ${summary.slaMissed} missed`}
          icon="shield"
          tone="indigo"
        />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">i</span>
        <p>
          <span className="font-semibold">Tracking coverage:</span>{" "}
          {summary.attributedOutgoing} of {summary.totalOutgoing} outgoing replies in this period identify the Tenh Chat sender.
          {summary.unattributedOutgoing > 0
            ? " Older replies are intentionally not guessed."
            : " Sender attribution is fully tracked for outgoing replies in the selected period."}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-bold text-slate-950">Agent leaderboard</h3>
          </div>

          {leaderboard.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No active team members found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Speed</th>
                    <th className="px-4 py-3">Avg first response</th>
                    <th className="px-4 py-3">SLA met</th>
                    <th className="px-4 py-3">First responses</th>
                    <th className="px-4 py-3">Trend (avg)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leaderboard.map((agent, index) => {
                    const speed = getSpeed(agent, slaMinutes);
                    const hasFirstResponses = agent.firstResponses > 0;
                    return (
                      <tr key={agent.memberId} className={index === 0 ? "bg-blue-50/50" : "bg-white"}>
                        <td className="px-4 py-4 font-bold text-blue-600">{index + 1}</td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            {agent.profilePictureUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={agent.profilePictureUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                            ) : (
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700">
                                {getInitial(agent.fullName)}
                              </span>
                            )}
                            <span className="max-w-[150px] truncate font-semibold text-slate-900">{agent.fullName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{roleLabel(agent.role)}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${speed.classes}`}>
                            <SpeedIcon tone={speed.tone} />
                            {speed.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-semibold text-slate-700">
                          {hasFirstResponses ? formatDuration(agent.avgFirstResponseSeconds) : "—"}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`font-bold ${
                            agent.slaRate === null
                              ? "text-slate-400"
                              : agent.slaRate >= 90
                                ? "text-emerald-600"
                                : agent.slaRate >= 70
                                  ? "text-amber-600"
                                  : "text-red-600"
                          }`}>
                            {agent.slaRate === null ? "—" : `${agent.slaRate}%`}
                          </span>
                          {agent.slaRate !== null ? (
                            <span className="ml-1 text-[10px] text-slate-400">({agent.slaMet}/{agent.slaMet + agent.slaMissed})</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 font-semibold text-slate-700">{agent.firstResponses}</td>
                        <td className="px-4 py-4 text-blue-500"><PerformanceLine agent={agent} slaMinutes={slaMinutes} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-bold text-slate-950">How speed is judged</h3>
            <div className="mt-3 space-y-2">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                <div className="flex items-start gap-2">
                  <SpeedIcon tone="fast" size="large" />
                  <div>
                    <p className="font-bold text-emerald-800">Fast</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-emerald-700">Average response is at or below half of the SLA target and SLA met is 90% or higher.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <SpeedIcon tone="normal" size="large" />
                  <div>
                    <p className="font-bold text-amber-800">Normal</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-amber-700">Performance is between Fast and Slow and generally within an acceptable range.</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-red-100 bg-red-50 p-3">
                <div className="flex items-start gap-2">
                  <SpeedIcon tone="slow" size="large" />
                  <div>
                    <p className="font-bold text-red-700">Slow</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-red-600">Average response is slower than the SLA target, or SLA met falls below 70%.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-600">i</span>
            <div>
              <p className="font-semibold text-slate-900">Empty-state rule</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">At least 3 verified first responses are required before a speed label is shown.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="font-bold text-slate-950">Detailed comparison</h3>
        </div>

        {agents.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No active team members found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">First responses</th>
                  <th className="px-4 py-3">Avg first response</th>
                  <th className="px-4 py-3">SLA met</th>
                  <th className="px-4 py-3">Outgoing</th>
                  <th className="px-4 py-3">Conversations</th>
                  <th className="px-4 py-3">Status actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((agent) => (
                  <tr key={agent.memberId}>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {agent.profilePictureUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={agent.profilePictureUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700">{getInitial(agent.fullName)}</span>
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-semibold text-slate-900">{agent.fullName}</span>
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-600">{roleLabel(agent.role)}</span>
                            {agent.memberId === bestResponseMemberId && agent.firstResponses > 0 ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">Fastest response</span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-slate-400">{agent.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-700">{agent.firstResponses}</td>
                    <td className="px-4 py-4 font-semibold text-slate-700">{agent.firstResponses > 0 ? formatDuration(agent.avgFirstResponseSeconds) : "—"}</td>
                    <td className="px-4 py-4">
                      <span className={agent.slaRate === null ? "text-slate-400" : agent.slaRate >= 90 ? "font-bold text-emerald-600" : agent.slaRate >= 70 ? "font-bold text-amber-600" : "font-bold text-red-600"}>
                        {agent.slaRate === null ? "—" : `${agent.slaRate}%`}
                      </span>
                      <span className="ml-1 text-[10px] text-slate-400">({agent.slaMet}/{agent.slaMet + agent.slaMissed})</span>
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-700">{agent.outgoingMessages}</td>
                    <td className="px-4 py-4 font-semibold text-slate-700">{agent.conversationsReplied}</td>
                    <td className="px-4 py-4 font-semibold text-slate-700">{agent.resolvedActions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
