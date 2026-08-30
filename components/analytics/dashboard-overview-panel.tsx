"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type PeriodKey =
  | "today"
  | "yesterday";

type CustomerSummary = {
  totalCustomers: number;
  newCustomers: number;
  activeCustomers: number;
  returningCustomers: number;
  inactive30Days: number;
  openCustomers: number;
  messagesInPeriod: number;
  incomingMessages: number;
  outgoingMessages: number;
};

type ConversationSummary = {
  receivedConversations: number;
  resolvedConversations: number;
  resolutionRate:
    | number
    | null;
  currentOpen: number;
  currentPending: number;
  currentResolved: number;
  currentClosed: number;
  currentSpam: number;
  currentUnread: number;
  currentUnassigned: number;
  waitingOverSla: number;
  incomingMessages: number;
  outgoingMessages: number;
  totalMessages: number;
};

type WaitingConversation = {
  conversationId: string;
  customerName: string;
  profilePictureUrl:
    | string
    | null;
  assignedMemberName:
    | string
    | null;
  latestIncomingAt: string;
  status: string;
  unreadCount: number;
  waitingSeconds: number;
};

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
  slaRate:
    | number
    | null;
};

type AgentRow = {
  memberId: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl:
    | string
    | null;
  firstResponses: number;
  avgFirstResponseSeconds: number;
  medianFirstResponseSeconds: number;
  slaMet: number;
  slaMissed: number;
  slaRate:
    | number
    | null;
  outgoingMessages: number;
  conversationsReplied: number;
  resolvedActions: number;
};

type WorkloadMember = {
  memberId: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl:
    | string
    | null;
  openCount: number;
  pendingCount: number;
  activeCount: number;
  unreadCount: number;
  overdueReminders: number;
};

type CustomerResponse = {
  success?: boolean;
  error?: string;
  businessId?: string;
  analytics?: {
    summary?:
      Partial<CustomerSummary>;
  };
};

type DailyRow = {
  date: string;
  received: number;
  resolved: number;
};

type BusyHourRow = {
  hour: number;
  conversations: number;
};

type ChannelRow = {
  channel: string;
  conversations: number;
  incomingMessages: number;
};

type ConversationResponse = {
  success?: boolean;
  error?: string;
  businessId?: string;
  analytics?: {
    summary?:
      Partial<ConversationSummary>;
    waitingConversations?:
      WaitingConversation[];
    daily?: DailyRow[];
    busyHours?: BusyHourRow[];
    channels?: ChannelRow[];
  };
};

type AgentResponse = {
  success?: boolean;
  error?: string;
  businessId?: string;
  analytics?: {
    summary?:
      Partial<AgentSummary>;
    agents?: AgentRow[];
  };
};

type WorkloadResponse = {
  success?: boolean;
  error?: string;
  businessId?: string;
  currentMemberId?: string;
  currentMemberRole?: string;
  unassignedCount?: number;
  members?: WorkloadMember[];
};

const EMPTY_CUSTOMERS:
  CustomerSummary = {
    totalCustomers: 0,
    newCustomers: 0,
    activeCustomers: 0,
    returningCustomers: 0,
    inactive30Days: 0,
    openCustomers: 0,
    messagesInPeriod: 0,
    incomingMessages: 0,
    outgoingMessages: 0,
  };

const EMPTY_CONVERSATIONS:
  ConversationSummary = {
    receivedConversations: 0,
    resolvedConversations: 0,
    resolutionRate: null,
    currentOpen: 0,
    currentPending: 0,
    currentResolved: 0,
    currentClosed: 0,
    currentSpam: 0,
    currentUnread: 0,
    currentUnassigned: 0,
    waitingOverSla: 0,
    incomingMessages: 0,
    outgoingMessages: 0,
    totalMessages: 0,
  };

const EMPTY_AGENT_SUMMARY:
  AgentSummary = {
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

const SLA_OPTIONS = [
  5,
  10,
  15,
  30,
  60,
];

async function readJson<T>(
  response: Response,
) {
  const text =
    await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(
      text,
    ) as T;
  } catch {
    return null;
  }
}

async function requestJson<T>(
  url: string,
): Promise<{
  ok: boolean;
  data: T | null;
  error: string | null;
}> {
  try {
    const response =
      await fetch(
        url,
        {
          cache:
            "no-store",
        },
      );

    const data =
      await readJson<T>(
        response,
      );

    if (!response.ok) {
      const maybeError =
        data as {
          error?: string;
        } | null;

      return {
        ok: false,
        data,
        error:
          maybeError?.error ??
          `Request failed with ${response.status}.`,
      };
    }

    return {
      ok: true,
      data,
      error: null,
    };
  } catch (
    error
  ) {
    return {
      ok: false,
      data: null,
      error:
        error instanceof
          Error
          ? error.message
          : "Request failed.",
    };
  }
}

function formatDuration(
  seconds:
    | number
    | null
    | undefined,
) {
  if (
    seconds === null ||
    seconds === undefined ||
    !Number.isFinite(
      seconds,
    ) ||
    seconds <= 0
  ) {
    return "—";
  }

  const rounded =
    Math.round(seconds);

  if (rounded < 60) {
    return `${rounded}s`;
  }

  const minutes =
    Math.floor(
      rounded / 60,
    );

  if (minutes < 60) {
    const remaining =
      rounded % 60;

    return remaining
      ? `${minutes}m ${remaining}s`
      : `${minutes}m`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );
  const remainingMinutes =
    minutes % 60;

  return remainingMinutes
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

function formatWaiting(
  seconds: number,
) {
  const minutes =
    Math.max(
      1,
      Math.floor(
        seconds / 60,
      ),
    );

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours =
    Math.floor(
      minutes / 60,
    );
  const remainder =
    minutes % 60;

  if (hours < 24) {
    return remainder
      ? `${hours}h ${remainder}m`
      : `${hours}h`;
  }

  const days =
    Math.floor(
      hours / 24,
    );
  const hourRemainder =
    hours % 24;

  return hourRemainder
    ? `${days}d ${hourRemainder}h`
    : `${days}d`;
}

function getInitial(
  value: string,
) {
  return (
    value
      .trim()
      .charAt(0)
      .toUpperCase() ||
    "T"
  );
}


type DashboardIconName =
  | "customers"
  | "conversation"
  | "clock"
  | "mail"
  | "timer"
  | "check"
  | "reply"
  | "activity"
  | "refresh"
  | "workload"
  | "reminder";

function DashboardIcon({
  name,
  className = "h-5 w-5",
}: {
  name: DashboardIconName;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (name === "customers") {
    return (
      <svg {...common}>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  }

  if (name === "conversation") {
    return (
      <svg {...common}>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4z" />
        <path d="M8 9h.01M12 9h.01M16 9h.01" />
      </svg>
    );
  }

  if (name === "clock" || name === "timer") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.6 2.6L16.5 9" />
      </svg>
    );
  }

  if (name === "reply") {
    return (
      <svg {...common}>
        <path d="m9 7-5 5 5 5" />
        <path d="M20 17a7 7 0 0 0-7-7H4" />
      </svg>
    );
  }

  if (name === "activity") {
    return (
      <svg {...common}>
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg {...common}>
        <path d="M20 11a8 8 0 1 0 2 5.5" />
        <path d="M20 4v7h-7" />
      </svg>
    );
  }

  if (name === "reminder") {
    return (
      <svg {...common}>
        <path d="M9 3h6M10 2h4" />
        <rect x="5" y="5" width="14" height="16" rx="2" />
        <path d="M9 10h6M9 14h4" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M16 11h6M19 8v6" />
    </svg>
  );
}

type IconTone =
  | "blue"
  | "violet"
  | "amber"
  | "emerald"
  | "rose";

function iconToneClasses(
  tone: IconTone,
) {
  if (tone === "violet") {
    return "bg-violet-50 text-violet-600";
  }

  if (tone === "amber") {
    return "bg-amber-50 text-amber-600";
  }

  if (tone === "emerald") {
    return "bg-emerald-50 text-emerald-600";
  }

  if (tone === "rose") {
    return "bg-rose-50 text-rose-600";
  }

  return "bg-blue-50 text-blue-600";
}

function MetricCard({
  label,
  value,
  helper,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  helper: string;
  icon: DashboardIconName;
  tone?: IconTone;
}) {
  return (
    <div className="min-h-[154px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconToneClasses(
            tone,
          )}`}
        >
          <DashboardIcon name={icon} />
        </span>

        <p className="text-sm font-semibold text-slate-500">
          {label}
        </p>
      </div>

      <p className="mt-3 text-3xl font-bold leading-none text-slate-950">
        {value}
      </p>

      <p className="mt-4 text-xs leading-5 text-slate-500">
        {helper}
      </p>
    </div>
  );
}

function SmallStat({
  label,
  value,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  icon?: DashboardIconName;
  tone?: IconTone;
}) {
  return (
    <div className="min-w-0 px-3 py-2 text-center">
      {icon ? (
        <span
          className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${iconToneClasses(
            tone,
          )}`}
        >
          <DashboardIcon
            name={icon}
            className="h-4.5 w-4.5"
          />
        </span>
      ) : null}

      <p className={`${icon ? "mt-3" : ""} text-xl font-bold text-slate-950`}>
        {value}
      </p>

      <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">
        {label}
      </p>
    </div>
  );
}



type DashboardRangeKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d";

function clampPercent(
  value: number,
) {
  return Math.max(
    0,
    Math.min(100, value),
  );
}

/**
 * Format an ISO date as a short axis label in the caller's timezone.
 */
function shortDateLabel(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatHourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;

  if (normalized === 0) {
    return "12 AM";
  }

  if (normalized === 12) {
    return "12 PM";
  }

  return normalized < 12
    ? `${normalized} AM`
    : `${normalized - 12} PM`;
}

function MiniSparkline({
  values,
  colorClass,
}: {
  values: number[];
  colorClass: string;
}) {
  const width = 120;
  const height = 34;
  const maxValue = Math.max(...values, 1);

  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - (value / maxValue) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`h-9 w-full ${colorClass}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatTrendCard({
  label,
  value,
  helper,
  icon,
  tone,
  series,
  colorClass,
}: {
  label: string;
  value: string;
  helper: string;
  icon: DashboardIconName;
  tone: IconTone;
  series?: number[];
  colorClass: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${iconToneClasses(tone)}`}>
          <DashboardIcon name={icon} className="h-4.5 w-4.5" />
        </span>

        <p className="text-sm font-semibold text-slate-600">{label}</p>
      </div>

      <p className="mt-4 text-[30px] font-bold leading-none text-slate-950">{value}</p>
      <p className="mt-3 text-xs leading-5 text-slate-500">{helper}</p>

      {series && series.length > 0 ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <MiniSparkline values={series} colorClass={colorClass} />
        </div>
      ) : null}
    </div>
  );
}

function ConversationActivityChart({
  bars,
  resolved,
  avgLine,
  labels,
}: {
  bars: number[];
  resolved: number[];
  avgLine: number[];
  labels: string[];
}) {
  const width = 520;
  const height = 260;
  const chartTop = 18;
  const chartBottom = 210;
  const chartHeight = chartBottom - chartTop;
  const maxBar = Math.max(...bars, ...resolved, 1);
  const maxLine = Math.max(...avgLine, 1);
  const groupWidth = width / Math.max(1, bars.length);
  const linePoints = avgLine
    .map((value, index) => {
      const x = groupWidth * index + groupWidth / 2;
      const y = chartBottom - (value / maxLine) * (chartHeight - 18);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] w-full" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((row) => {
        const y = chartTop + (chartHeight / 4) * row;
        return (
          <line
            key={row}
            x1="0"
            x2={width}
            y1={y}
            y2={y}
            stroke="#E2E8F0"
            strokeDasharray="4 4"
          />
        );
      })}

      {bars.map((value, index) => {
        const x = groupWidth * index + groupWidth * 0.2;
        const primaryHeight = (value / maxBar) * (chartHeight - 12);
        const resolvedHeight = (resolved[index] / maxBar) * (chartHeight - 12);
        return (
          <g key={index}>
            <rect
              x={x}
              y={chartBottom - primaryHeight}
              width={groupWidth * 0.2}
              height={primaryHeight}
              rx="4"
              fill="#7AA7FF"
              fillOpacity="0.9"
            />
            <rect
              x={x + groupWidth * 0.24}
              y={chartBottom - resolvedHeight}
              width={groupWidth * 0.14}
              height={resolvedHeight}
              rx="4"
              fill="#62C89E"
              fillOpacity="0.95"
            />
            <text x={groupWidth * index + groupWidth / 2} y="242" textAnchor="middle" fontSize="11" fill="#94A3B8">
              {labels[index]}
            </text>
          </g>
        );
      })}

      <polyline
        points={linePoints}
        fill="none"
        stroke="#F59E0B"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {avgLine.map((value, index) => {
        const x = groupWidth * index + groupWidth / 2;
        const y = chartBottom - (value / maxLine) * (chartHeight - 18);
        return (
          <circle key={`dot-${index}`} cx={x} cy={y} r="4.5" fill="#F59E0B" />
        );
      })}

      <text x="0" y="16" fontSize="11" fill="#94A3B8">20</text>
      <text x={width - 4} y="16" textAnchor="end" fontSize="11" fill="#94A3B8">20m</text>
      <text x={width - 4} y="126" textAnchor="end" fontSize="11" fill="#94A3B8">10m</text>
      <text x={width - 4} y="212" textAnchor="end" fontSize="11" fill="#94A3B8">0m</text>
    </svg>
  );
}

function HourBars({
  values,
  peakIndex,
}: {
  values: number[];
  peakIndex: number | null;
}) {
  const maxValue = Math.max(...values, 1);
  const labels = ["12 AM", "4 AM", "8 AM", "12 PM", "4 PM", "8 PM", "12 AM"];

  return (
    <div>
      <div className="mt-5 flex h-40 items-end gap-[3px]">
        {values.map((value, index) => {
          // Highlight the hour that is actually busiest, rather than a
          // fixed position in the array.
          const highlight = peakIndex === index;
          return (
            <div key={index} className="flex flex-1 flex-col items-center justify-end" title={`${formatHourLabel(index)} · ${value}`}>
              <div
                className={`w-full rounded-t-sm ${highlight ? "bg-blue-700" : "bg-blue-200"}`}
                style={{ height: `${value === 0 ? 2 : Math.max(6, (value / maxValue) * 118)}px` }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[11px] text-slate-400">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({
  segments,
}: {
  segments: { className: string; width: number }[];
}) {
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
      {segments.map((segment, index) => (
        <span
          key={index}
          className={segment.className}
          style={{ width: `${segment.width}%` }}
        />
      ))}
    </div>
  );
}

export function DashboardOverviewPanel({
  onOpenChannelPerformance,
}: {
  onOpenChannelPerformance?: () => void;
}) {
  const [rangeView, setRangeView] = useState<DashboardRangeKey>("today");
  const effectivePeriod: PeriodKey = rangeView === "yesterday" ? "yesterday" : "today";

  const [slaMinutes, setSlaMinutes] = useState(10);
  const [customers, setCustomers] = useState<CustomerSummary>(EMPTY_CUSTOMERS);
  const [conversations, setConversations] = useState<ConversationSummary>(EMPTY_CONVERSATIONS);
  const [waitingConversations, setWaitingConversations] = useState<WaitingConversation[]>([]);
  const [agentSummary, setAgentSummary] = useState<AgentSummary>(EMPTY_AGENT_SUMMARY);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [workloadMembers, setWorkloadMembers] = useState<WorkloadMember[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [busyHours, setBusyHours] = useState<BusyHourRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [currentMemberRole, setCurrentMemberRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const mountedRef = useRef(true);

  const loadOverview = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const tzOffsetMinutes = new Date().getTimezoneOffset();

    const [customerResult, conversationResult, agentResult, workloadResult] = await Promise.all([
      requestJson<CustomerResponse>(`/api/analytics/customers?period=${effectivePeriod}&tzOffsetMinutes=${tzOffsetMinutes}`),
      requestJson<ConversationResponse>(`/api/analytics/conversations?period=${effectivePeriod}&slaMinutes=${slaMinutes}&tzOffsetMinutes=${tzOffsetMinutes}`),
      // Previously hardcoded to period=7d, so a "Today" dashboard showed
      // 7 days of agent data beside 1 day of conversation data.
      requestJson<AgentResponse>(`/api/analytics/agents?period=${effectivePeriod}&slaMinutes=${slaMinutes}&tzOffsetMinutes=${tzOffsetMinutes}`),
      requestJson<WorkloadResponse>("/api/team/workload"),
    ]);

    if (!mountedRef.current) {
      return;
    }

    const nextWarnings: string[] = [];

    if (customerResult.ok && customerResult.data?.success) {
      setCustomers({ ...EMPTY_CUSTOMERS, ...(customerResult.data.analytics?.summary ?? {}) });
    } else {
      nextWarnings.push(`Customers: ${customerResult.error ?? customerResult.data?.error ?? "Unavailable"}`);
    }

    if (conversationResult.ok && conversationResult.data?.success) {
      setConversations({ ...EMPTY_CONVERSATIONS, ...(conversationResult.data.analytics?.summary ?? {}) });
      // These were fetched and thrown away; the charts invented their
      // own shapes instead of using them.
      setDaily(conversationResult.data.analytics?.daily ?? []);
      setBusyHours(conversationResult.data.analytics?.busyHours ?? []);
      setChannels(conversationResult.data.analytics?.channels ?? []);
      setWaitingConversations(conversationResult.data.analytics?.waitingConversations ?? []);
    } else {
      nextWarnings.push(`Conversations: ${conversationResult.error ?? conversationResult.data?.error ?? "Unavailable"}`);
    }

    if (agentResult.ok && agentResult.data?.success) {
      setAgentSummary({ ...EMPTY_AGENT_SUMMARY, ...(agentResult.data.analytics?.summary ?? {}) });
      setAgents(agentResult.data.analytics?.agents ?? []);
    } else {
      nextWarnings.push(`Team performance: ${agentResult.error ?? agentResult.data?.error ?? "Unavailable"}`);
    }

    if (workloadResult.ok && workloadResult.data?.success) {
      setWorkloadMembers(workloadResult.data.members ?? []);
      setUnassignedCount(Math.max(0, workloadResult.data.unassignedCount ?? 0));
      setCurrentMemberRole(workloadResult.data.currentMemberRole ?? null);
    } else {
      nextWarnings.push(`Team workload: ${workloadResult.error ?? workloadResult.data?.error ?? "Unavailable"}`);
    }

    setWarnings(nextWarnings);
    setLoading(false);
    setRefreshing(false);
  }, [effectivePeriod, slaMinutes]);

  useEffect(() => {
    mountedRef.current = true;
    void loadOverview(false);
    return () => {
      mountedRef.current = false;
    };
  }, [loadOverview]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadOverview(true);
    }, 30_000);

    function onFocus() {
      void loadOverview(true);
    }

    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadOverview]);

  const totalOverdueReminders = useMemo(
    () => workloadMembers.reduce((total, member) => total + member.overdueReminders, 0),
    [workloadMembers],
  );

  const periodLabel = effectivePeriod === "today" ? "Today" : "Yesterday";
  const topSummaryTotal = Math.max(1, unassignedCount + conversations.waitingOverSla + conversations.currentUnread + totalOverdueReminders);

  const topSummaryItems = [
    {
      label: "Unassigned",
      value: unassignedCount,
      helper: "Needs owner",
      icon: "customers" as DashboardIconName,
      tone: "amber" as IconTone,
      actionHref: "/dashboard/inbox?assigned=unassigned",
    },
    {
      label: "Waiting > SLA",
      value: conversations.waitingOverSla,
      helper: `Over ${slaMinutes} min`,
      icon: "clock" as DashboardIconName,
      tone: "rose" as IconTone,
      actionHref: "/dashboard/inbox?view=sla",
    },
    {
      label: "Unread",
      value: conversations.currentUnread,
      helper: "New messages",
      icon: "mail" as DashboardIconName,
      tone: "violet" as IconTone,
      actionHref: "/dashboard/inbox?filter=unread",
    },
    {
      label: "Overdue",
      value: totalOverdueReminders,
      helper: "Past due follow-ups",
      icon: "reminder" as DashboardIconName,
      tone: "rose" as IconTone,
      actionHref: "/dashboard/inbox?view=reminders",
    },
  ];

  // Real per-day values straight from the API.
  const conversationSeries = daily.map((point) => point.received);
  const resolvedSeries = daily.map((point) => point.resolved);
  const dailyLabels = daily.map((point) => shortDateLabel(point.date));
  const receivedSeries = conversationSeries;

  const atGlanceCards = [
    {
      label: "Conversations",
      value: String(conversations.receivedConversations),
      helper: `${conversations.resolvedConversations} resolved`,
      icon: "conversation" as DashboardIconName,
      tone: "blue" as IconTone,
      series: receivedSeries,
      colorClass: "text-blue-500",
    },
    {
      label: "First responses",
      value: agentSummary.attributedFirstResponses > 0 ? String(agentSummary.attributedFirstResponses) : "No data yet",
      helper: `${Math.max(0, Math.round(agentSummary.avgFirstResponseSeconds / 60))}m ${Math.max(0, agentSummary.avgFirstResponseSeconds % 60)}s · Target ${slaMinutes}m`,
      icon: "reply" as DashboardIconName,
      tone: "emerald" as IconTone,
      // The agents endpoint returns no per-day series, so no sparkline
      // rather than an invented one.
      series: undefined,
      colorClass: "text-blue-300",
    },
    {
      label: "SLA met",
      value: agentSummary.slaRate === null ? "—" : `${agentSummary.slaRate}%`,
      helper: agentSummary.slaRate === null ? "No data yet" : `${agentSummary.slaMet} met · ${agentSummary.slaMissed} missed`,
      icon: "check" as DashboardIconName,
      tone: "amber" as IconTone,
      series: undefined,
      colorClass: "text-amber-500",
    },
    {
      label: "New customers",
      value: String(customers.newCustomers),
      helper: `${customers.returningCustomers} returning`,
      icon: "customers" as DashboardIconName,
      tone: "emerald" as IconTone,
      series: undefined,
      colorClass: "text-emerald-500",
    },
  ];

  // 24 real hourly buckets, zero-filled for hours with no activity.
  const hourlyCounts = Array.from({ length: 24 }, (_, hour) => {
    const match = busyHours.find(
      (row) => Number(row.hour) === hour,
    );

    return match ? Number(match.conversations) || 0 : 0;
  });

  const hasHourlyData = hourlyCounts.some((value) => value > 0);

  const peakHour = hasHourlyData
    ? hourlyCounts.indexOf(Math.max(...hourlyCounts))
    : null;

  // These used to be status counts wearing channel labels: "Messenger"
  // showed currentOpen, "Comments" showed currentUnread, "TikTok" showed
  // unassignedCount. The API returns a real channel breakdown.
  const CHANNEL_DOTS = ["bg-blue-600", "bg-violet-500", "bg-cyan-500", "bg-emerald-500", "bg-amber-500"];

  const channelRows = channels.length > 0
    ? channels.map((row, index) => ({
        label: row.channel,
        value: Number(row.conversations) || 0,
        dotClass: CHANNEL_DOTS[index % CHANNEL_DOTS.length],
      }))
    : ([] as { label: string; value: number; dotClass: string }[]);

  const channelTotal = Math.max(1, channelRows.reduce((sum, item) => sum + item.value, 0));
  const channelSegments = channelRows.map((item, index) => ({
    className: CHANNEL_DOTS[index % CHANNEL_DOTS.length].replace("bg-", "bg-"),
    width: clampPercent((item.value / channelTotal) * 100),
  }));

  const customerTotal = Math.max(1, customers.totalCustomers);
  const customerSegments = [
    { className: "bg-emerald-500", width: clampPercent((customers.activeCustomers / customerTotal) * 100) },
    { className: "bg-teal-500", width: clampPercent((customers.returningCustomers / customerTotal) * 100) },
    { className: "bg-slate-300", width: clampPercent((customers.inactive30Days / customerTotal) * 100) },
  ];

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex animate-pulse flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="h-8 w-44 rounded bg-slate-200" />
            <div className="h-4 w-96 max-w-full rounded bg-slate-200" />
          </div>
          <div className="h-10 w-[440px] max-w-full rounded-xl bg-slate-200" />
        </div>
        <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-[188px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
          <div className="h-[430px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="h-[430px] animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-current-member-role={currentMemberRole ?? undefined}>
      <header className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-semibold text-blue-600">Analytics</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.02em] text-slate-950">Dashboard</h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
            Inbox health, conversations, and customers.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="inline-flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {([
              { value: "today", label: "Today" },
              { value: "yesterday", label: "Yesterday" },
              { value: "7d", label: "7d" },
              { value: "30d", label: "30d" },
            ] as const).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setRangeView(item.value)}
                className={`min-w-[74px] px-4 py-2.5 text-sm font-semibold transition ${
                  rangeView === item.value
                    ? "bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.28)]"
                    : "bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-600 shadow-sm">
            <span className="font-semibold">SLA</span>
            <select
              value={slaMinutes}
              onChange={(event) => setSlaMinutes(Number(event.target.value))}
              className="bg-transparent font-bold text-slate-900 outline-none"
            >
              {SLA_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} min
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void loadOverview(true)}
            disabled={refreshing}
            className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
          >
            <DashboardIcon name="refresh" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {warnings.length > 0 ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">Some dashboard sources could not be loaded.</p>
          <div className="mt-2 space-y-1">
            {warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-700">• {warning}</p>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <span>Right now — not affected by the date filter</span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-0 md:grid-cols-[repeat(4,minmax(0,1fr))_220px]">
          {topSummaryItems.map((item, index) => (
            <div key={item.label} className={`flex items-center gap-4 px-5 py-5 ${index < topSummaryItems.length - 1 ? "border-b border-slate-100 md:border-b-0 md:border-r" : "border-b border-slate-100 md:border-b-0 md:border-r"}`}>
              <span className={`flex h-12 w-12 items-center justify-center rounded-full ${iconToneClasses(item.tone)}`}>
                <DashboardIcon name={item.icon} className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-500">{item.label}</p>
                <p className="mt-1 text-[34px] font-bold leading-none text-slate-950">{item.value}</p>
                <p className="mt-2 text-xs text-slate-500">{item.helper}</p>
              </div>
            </div>
          ))}

          <div className="flex flex-col items-stretch justify-center gap-3 px-5 py-5">
            <Link
              href="/dashboard/inbox?assigned=unassigned"
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Assign {unassignedCount} →
            </Link>
            <p className="text-center text-xs text-slate-500">
              {topSummaryTotal} urgent item{topSummaryTotal === 1 ? "" : "s"} across inbox right now.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-slate-950">Today at a glance</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {atGlanceCards.map((card) => (
            <StatTrendCard
              key={card.label}
              label={card.label}
              value={card.value}
              helper={card.helper}
              icon={card.icon}
              tone={card.tone}
              series={card.series}
              colorClass={card.colorClass}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_360px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Conversation activity</h2>
              <p className="mt-1 text-xs text-slate-500">Last 7 days</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm">{rangeView === "30d" ? "30 days" : "7 days"}</div>
          </div>

          <div className="mt-4 flex flex-wrap gap-5 text-xs text-slate-500">
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" />Received</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Resolved</span>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Reply time (avg)</span>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-100 p-3">
            {daily.length > 0 ? (
              <ConversationActivityChart
                bars={conversationSeries}
                resolved={resolvedSeries}
                avgLine={[]}
                labels={dailyLabels}
              />
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No conversation activity in this period yet.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Message volume</h2>
              <p className="mt-1 text-xs text-slate-500">{periodLabel}</p>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {[
              { label: "Incoming", value: conversations.incomingMessages, helper: "All channels", icon: "mail" as DashboardIconName, tone: "blue" as IconTone },
              { label: "Outgoing", value: conversations.outgoingMessages, helper: "By agents", icon: "reply" as DashboardIconName, tone: "emerald" as IconTone },
              { label: "Total messages", value: conversations.totalMessages, helper: "Incoming + Outgoing", icon: "conversation" as DashboardIconName, tone: "violet" as IconTone },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-4 rounded-2xl border border-slate-100 px-4 py-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${iconToneClasses(item.tone)}`}>
                  <DashboardIcon name={item.icon} className="h-4.5 w-4.5" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-600">{item.label}</p>
                  <p className="mt-2 text-[34px] font-bold leading-none text-slate-950">{item.value}</p>
                  <p className="mt-2 text-xs text-slate-500">{item.helper}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-950">Channels</h2>
              <p className="mt-1 text-xs text-slate-500">{periodLabel}</p>
            </div>
          </div>

          <div className="mt-5">
            <ProgressBar segments={channelSegments} />
          </div>

          <div className="mt-5 space-y-4">
            {channelRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <span className={`h-3 w-3 rounded-full ${row.dotClass}`} />
                  {row.label}
                </span>
                <span className="text-sm font-semibold text-slate-500">
                  {row.value} ({Math.round((row.value / channelTotal) * 100)}%)
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenChannelPerformance}
            className="mt-6 inline-flex text-sm font-semibold text-blue-600 hover:underline"
          >
            View channel performance →
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Busiest hours</h2>
            <p className="mt-1 text-xs text-slate-500">When customers first message</p>
          </div>

          {hasHourlyData ? (
            <>
              <HourBars
                values={hourlyCounts}
                peakIndex={peakHour}
              />

              <p className="mt-5 text-sm font-medium text-slate-600">
                {formatHourLabel(peakHour ?? 0)} is your peak — staff it
              </p>
            </>
          ) : (
            <p className="mt-8 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No messages in this period yet.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-400">Customers — all time</p>
            <p className="mt-2 text-[34px] font-bold leading-none text-slate-950">{customers.totalCustomers}</p>
            <p className="mt-2 text-xs text-slate-500">Total customers</p>
          </div>

        </div>

        <div className="mt-5">
          <ProgressBar segments={customerSegments} />
        </div>

        <div className="mt-4 flex flex-wrap gap-5 text-sm text-slate-500">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Active 30d {customers.activeCustomers} ({Math.round((customers.activeCustomers / customerTotal) * 100)}%)</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-teal-500" />Returning {customers.returningCustomers} ({Math.round((customers.returningCustomers / customerTotal) * 100)}%)</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" />Inactive 30d+ {customers.inactive30Days} ({Math.round((customers.inactive30Days / customerTotal) * 100)}%)</span>
        </div>
      </section>
    </div>
  );
}
