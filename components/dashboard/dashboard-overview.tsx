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

type ConversationResponse = {
  success?: boolean;
  error?: string;
  businessId?: string;
  analytics?: {
    summary?:
      Partial<ConversationSummary>;
    waitingConversations?:
      WaitingConversation[];
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

function MetricCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper: string;
  tone?:
    | "default"
    | "danger"
    | "warning"
    | "good";
}) {
  const valueClass =
    tone === "danger"
      ? "text-red-600"
      : tone ===
          "warning"
        ? "text-amber-600"
        : tone ===
            "good"
          ? "text-emerald-600"
          : "text-slate-950";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>

      <p
        className={`mt-2 text-2xl font-bold ${valueClass}`}
      >
        {value}
      </p>

      <p className="mt-1 text-xs leading-5 text-slate-500">
        {helper}
      </p>
    </div>
  );
}

function SmallStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-lg font-bold text-slate-950">
        {value}
      </p>

      <p className="mt-0.5 text-[11px] font-medium text-slate-500">
        {label}
      </p>
    </div>
  );
}

export function DashboardOverview() {
  const [
    period,
    setPeriod,
  ] =
    useState<PeriodKey>(
      "today",
    );

  const [
    slaMinutes,
    setSlaMinutes,
  ] =
    useState(10);

  const [
    customers,
    setCustomers,
  ] =
    useState<CustomerSummary>(
      EMPTY_CUSTOMERS,
    );

  const [
    conversations,
    setConversations,
  ] =
    useState<ConversationSummary>(
      EMPTY_CONVERSATIONS,
    );

  const [
    waitingConversations,
    setWaitingConversations,
  ] =
    useState<
      WaitingConversation[]
    >([]);

  const [
    agentSummary,
    setAgentSummary,
  ] =
    useState<AgentSummary>(
      EMPTY_AGENT_SUMMARY,
    );

  const [
    agents,
    setAgents,
  ] =
    useState<
      AgentRow[]
    >([]);

  const [
    workloadMembers,
    setWorkloadMembers,
  ] =
    useState<
      WorkloadMember[]
    >([]);

  const [
    unassignedCount,
    setUnassignedCount,
  ] =
    useState(0);

  const [
    currentMemberRole,
    setCurrentMemberRole,
  ] =
    useState<
      string | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    refreshing,
    setRefreshing,
  ] =
    useState(false);

  const [
    warnings,
    setWarnings,
  ] =
    useState<
      string[]
    >([]);

  const mountedRef =
    useRef(true);

  const loadOverview =
    useCallback(
      async (
        silent = false,
      ) => {
        if (silent) {
          setRefreshing(
            true,
          );
        } else {
          setLoading(
            true,
          );
        }

        const tzOffsetMinutes =
          new Date()
            .getTimezoneOffset();

        const [
          customerResult,
          conversationResult,
          agentResult,
          workloadResult,
        ] =
          await Promise.all([
            requestJson<CustomerResponse>(
              `/api/analytics/customers?period=${period}&tzOffsetMinutes=${tzOffsetMinutes}`,
            ),

            requestJson<ConversationResponse>(
              `/api/analytics/conversations?period=${period}&slaMinutes=${slaMinutes}&tzOffsetMinutes=${tzOffsetMinutes}`,
            ),

            requestJson<AgentResponse>(
              `/api/analytics/agents?period=7d&slaMinutes=${slaMinutes}`,
            ),

            requestJson<WorkloadResponse>(
              "/api/team/workload",
            ),
          ]);

        if (!mountedRef.current) {
          return;
        }

        const nextWarnings:
          string[] = [];

        if (
          customerResult.ok &&
          customerResult.data
            ?.success
        ) {
          setCustomers({
            ...EMPTY_CUSTOMERS,
            ...(customerResult.data
              .analytics
              ?.summary ??
              {}),
          });
        } else {
          nextWarnings.push(
            `Customer insights: ${
              customerResult.error ??
              customerResult.data
                ?.error ??
              "Unavailable"
            }`,
          );
        }

        if (
          conversationResult.ok &&
          conversationResult
            .data?.success
        ) {
          setConversations({
            ...EMPTY_CONVERSATIONS,
            ...(conversationResult
              .data.analytics
              ?.summary ??
              {}),
          });

          setWaitingConversations(
            conversationResult
              .data.analytics
              ?.waitingConversations ??
              [],
          );
        } else {
          nextWarnings.push(
            `Conversation reports: ${
              conversationResult.error ??
              conversationResult
                .data?.error ??
              "Unavailable"
            }`,
          );
        }

        if (
          agentResult.ok &&
          agentResult.data
            ?.success
        ) {
          setAgentSummary({
            ...EMPTY_AGENT_SUMMARY,
            ...(agentResult.data
              .analytics
              ?.summary ??
              {}),
          });

          setAgents(
            agentResult.data
              .analytics
              ?.agents ??
              [],
          );
        } else {
          nextWarnings.push(
            `Agent performance: ${
              agentResult.error ??
              agentResult.data
                ?.error ??
              "Unavailable"
            }`,
          );
        }

        if (
          workloadResult.ok &&
          workloadResult.data
            ?.success
        ) {
          setWorkloadMembers(
            workloadResult.data
              .members ??
              [],
          );

          setUnassignedCount(
            Math.max(
              0,
              workloadResult.data
                .unassignedCount ??
                0,
            ),
          );

          setCurrentMemberRole(
            workloadResult.data
              .currentMemberRole ??
              null,
          );
        } else {
          nextWarnings.push(
            `Team workload: ${
              workloadResult.error ??
              workloadResult.data
                ?.error ??
              "Unavailable"
            }`,
          );
        }

        setWarnings(
          nextWarnings,
        );

        setLoading(false);
        setRefreshing(false);
      },
      [
        period,
        slaMinutes,
      ],
    );

  useEffect(() => {
    mountedRef.current =
      true;

    void loadOverview(
      false,
    );

    return () => {
      mountedRef.current =
        false;
    };
  }, [loadOverview]);

  useEffect(() => {
    const interval =
      window.setInterval(
        () => {
          void loadOverview(
            true,
          );
        },
        30_000,
      );

    function onFocus() {
      void loadOverview(
        true,
      );
    }

    window.addEventListener(
      "focus",
      onFocus,
    );

    return () => {
      window.clearInterval(
        interval,
      );

      window.removeEventListener(
        "focus",
        onFocus,
      );
    };
  }, [loadOverview]);

  const fastestAgent =
    useMemo(
      () => {
        const eligible =
          agents
            .filter(
              (agent) =>
                agent.firstResponses >
                  0 &&
                agent.avgFirstResponseSeconds >
                  0,
            )
            .sort(
              (
                first,
                second,
              ) =>
                first.avgFirstResponseSeconds -
                second.avgFirstResponseSeconds,
            );

        return (
          eligible[0] ??
          null
        );
      },
      [agents],
    );

  const totalOverdueReminders =
    useMemo(
      () =>
        workloadMembers.reduce(
          (
            total,
            member,
          ) =>
            total +
            member.overdueReminders,
          0,
        ),
      [workloadMembers],
    );

  const totalActiveWorkload =
    useMemo(
      () =>
        workloadMembers.reduce(
          (
            total,
            member,
          ) =>
            total +
            member.activeCount,
          0,
        ),
      [workloadMembers],
    );

  const sortedWorkload =
    useMemo(
      () =>
        [
          ...workloadMembers,
        ].sort(
          (
            first,
            second,
          ) =>
            second.activeCount -
              first.activeCount ||
            second.unreadCount -
              first.unreadCount ||
            first.fullName.localeCompare(
              second.fullName,
            ),
        ),
      [workloadMembers],
    );

  const periodLabel =
    period === "today"
      ? "Today"
      : "Yesterday";

  if (loading) {
    return (
      <main className="h-[calc(100vh-72px)] overflow-y-auto bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto w-full max-w-7xl">
          <div className="animate-pulse space-y-5">
            <div className="h-20 rounded-2xl bg-white" />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map(
                (item) => (
                  <div
                    key={item}
                    className="h-28 rounded-2xl bg-white"
                  />
                ),
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="h-80 rounded-2xl bg-white" />
              <div className="h-80 rounded-2xl bg-white" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-[calc(100vh-72px)] overflow-y-auto bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
              Dashboard
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-950">
                Business overview
              </h1>

              {currentMemberRole ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {currentMemberRole}
                </span>
              ) : null}
            </div>

            <p className="mt-1 text-sm text-slate-500">
              One view of customers, conversations, team response, workload, and items needing attention.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {(
                [
                  {
                    value:
                      "today",
                    label:
                      "Today",
                  },
                  {
                    value:
                      "yesterday",
                    label:
                      "Yesterday",
                  },
                ] as const
              ).map(
                (item) => (
                  <button
                    key={
                      item.value
                    }
                    type="button"
                    onClick={() =>
                      setPeriod(
                        item.value,
                      )
                    }
                    className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                      period ===
                      item.value
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {
                      item.label
                    }
                  </button>
                ),
              )}
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              <span className="font-medium">
                SLA
              </span>

              <select
                value={
                  slaMinutes
                }
                onChange={(
                  event,
                ) =>
                  setSlaMinutes(
                    Number(
                      event.target.value,
                    ),
                  )
                }
                className="bg-transparent font-semibold text-slate-900 outline-none"
              >
                {SLA_OPTIONS.map(
                  (minutes) => (
                    <option
                      key={
                        minutes
                      }
                      value={
                        minutes
                      }
                    >
                      {minutes} min
                    </option>
                  ),
                )}
              </select>
            </label>

            <button
              type="button"
              onClick={() =>
                void loadOverview(
                  true,
                )
              }
              disabled={
                refreshing
              }
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
            >
              {refreshing
                ? "Refreshing..."
                : "Refresh"}
            </button>
          </div>
        </section>

        {warnings.length >
        0 ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-900">
              Some dashboard sources could not be loaded.
            </p>

            <div className="mt-2 space-y-1">
              {warnings.map(
                (warning) => (
                  <p
                    key={
                      warning
                    }
                    className="text-xs text-amber-700"
                  >
                    •{" "}
                    {
                      warning
                    }
                  </p>
                ),
              )}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="New customers"
            value={String(
              customers.newCustomers,
            )}
            helper={`${periodLabel} · ${customers.activeCustomers} active customers`}
            tone={
              customers.newCustomers >
              0
                ? "good"
                : "default"
            }
          />

          <MetricCard
            label="Conversations received"
            value={String(
              conversations.receivedConversations,
            )}
            helper={`${conversations.resolvedConversations} resolved · ${conversations.resolutionRate ?? 0}% resolution`}
          />

          <MetricCard
            label="Waiting > SLA"
            value={String(
              conversations.waitingOverSla,
            )}
            helper={`Latest customer message waiting longer than ${slaMinutes} min`}
            tone={
              conversations.waitingOverSla >
              0
                ? "danger"
                : "good"
            }
          />

          <MetricCard
            label="Unread"
            value={String(
              conversations.currentUnread,
            )}
            helper={`${conversations.currentUnassigned} unassigned in ${periodLabel.toLowerCase()}'s conversation group`}
            tone={
              conversations.currentUnread >
              0
                ? "warning"
                : "good"
            }
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">
                  Team
                </p>

                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  Response performance
                </h2>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Verified agent response results from the last 7 days. The SLA selector above also applies here.
                </p>
              </div>

              <Link
                href="/dashboard/analytics?view=agent-performance"
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Open agent analytics
              </Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SmallStat
                label="Avg first response"
                value={formatDuration(
                  agentSummary.avgFirstResponseSeconds,
                )}
              />

              <SmallStat
                label="SLA met"
                value={
                  agentSummary.slaRate ===
                  null
                    ? "—"
                    : `${agentSummary.slaRate}%`
                }
              />

              <SmallStat
                label="Verified first responses"
                value={String(
                  agentSummary.attributedFirstResponses,
                )}
              />

              <SmallStat
                label="Reply attribution"
                value={`${agentSummary.attributionRate}%`}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Fastest verified agent
              </p>

              {fastestAgent ? (
                <div className="mt-3 flex items-center gap-3">
                  {fastestAgent.profilePictureUrl ? (
                    <img
                      src={
                        fastestAgent.profilePictureUrl
                      }
                      alt=""
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">
                      {getInitial(
                        fastestAgent.fullName,
                      )}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-950">
                      {
                        fastestAgent.fullName
                      }
                    </p>

                    <p className="mt-0.5 text-xs text-slate-500">
                      Avg first response{" "}
                      {formatDuration(
                        fastestAgent.avgFirstResponseSeconds,
                      )}{" "}
                      ·{" "}
                      {
                        fastestAgent.firstResponses
                      }{" "}
                      verified first response
                      {fastestAgent.firstResponses ===
                      1
                        ? ""
                        : "s"}
                    </p>
                  </div>

                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                    Fastest
                  </span>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                  Need more verified first-response data before ranking an agent.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-600">
                  Customers
                </p>

                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  Customer activity
                </h2>
              </div>

              <Link
                href="/dashboard/analytics?view=customer-insights"
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Open insights
              </Link>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <SmallStat
                label={`New ${periodLabel.toLowerCase()}`}
                value={String(
                  customers.newCustomers,
                )}
              />

              <SmallStat
                label={`Active ${periodLabel.toLowerCase()}`}
                value={String(
                  customers.activeCustomers,
                )}
              />

              <SmallStat
                label="Returning"
                value={String(
                  customers.returningCustomers,
                )}
              />

              <SmallStat
                label="Inactive 30+ days"
                value={String(
                  customers.inactive30Days,
                )}
              />
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-600">
                  Total customers
                </span>

                <span className="font-bold text-slate-950">
                  {
                    customers.totalCustomers
                  }
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-600">
                  Customer messages
                </span>

                <span className="font-bold text-slate-950">
                  {
                    customers.incomingMessages
                  }
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-600">
                  Team replies
                </span>

                <span className="font-bold text-slate-950">
                  {
                    customers.outgoingMessages
                  }
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Operations
                </p>

                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  Team workload
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Current active Inbox workload, not limited by the Today / Yesterday filter.
                </p>
              </div>

              <Link
                href="/dashboard/analytics?view=team-workload"
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Full workload
              </Link>
            </div>

            <div className="grid gap-3 border-b border-slate-100 bg-slate-50 px-5 py-4 sm:grid-cols-3">
              <SmallStat
                label="Active assigned"
                value={String(
                  totalActiveWorkload,
                )}
              />

              <SmallStat
                label="Unassigned"
                value={String(
                  unassignedCount,
                )}
              />

              <SmallStat
                label="Overdue reminders"
                value={String(
                  totalOverdueReminders,
                )}
              />
            </div>

            {sortedWorkload.length ===
            0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">
                No active team members found.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {sortedWorkload.map(
                  (
                    member,
                  ) => (
                    <div
                      key={
                        member.memberId
                      }
                      className="flex items-center gap-3 px-5 py-4"
                    >
                      {member.profilePictureUrl ? (
                        <img
                          src={
                            member.profilePictureUrl
                          }
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                          {getInitial(
                            member.fullName,
                          )}
                        </span>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {
                              member.fullName
                            }
                          </p>

                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                            {
                              member.role
                            }
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-slate-500">
                          {
                            member.openCount
                          }{" "}
                          open ·{" "}
                          {
                            member.pendingCount
                          }{" "}
                          pending ·{" "}
                          {
                            member.unreadCount
                          }{" "}
                          unread
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-lg font-bold text-slate-950">
                          {
                            member.activeCount
                          }
                        </p>

                        <p className="text-[10px] font-medium text-slate-400">
                          active
                        </p>
                      </div>

                      {member.overdueReminders >
                      0 ? (
                        <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-700">
                          {
                            member.overdueReminders
                          }{" "}
                          overdue
                        </span>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-red-600">
                  Attention
                </p>

                <h2 className="mt-1 text-lg font-bold text-slate-950">
                  Needs attention
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  The most urgent waiting conversations for {periodLabel.toLowerCase()}.
                </p>
              </div>

              <Link
                href="/dashboard/analytics?view=conversation-reports"
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Conversation reports
              </Link>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <span
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  conversations.waitingOverSla >
                  0
                    ? "bg-red-100 text-red-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                Waiting &gt; SLA{" "}
                {
                  conversations.waitingOverSla
                }
              </span>

              <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-700">
                Unassigned current{" "}
                {
                  unassignedCount
                }
              </span>

              <span className="rounded-full bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700">
                Overdue reminders{" "}
                {
                  totalOverdueReminders
                }
              </span>
            </div>

            {waitingConversations.length ===
            0 ? (
              <div className="px-5 py-10 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                  ✓
                </div>

                <p className="mt-3 font-semibold text-slate-800">
                  No SLA-waiting conversations in this period
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Check unassigned conversations or overdue reminders if those counters are still above zero.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {waitingConversations
                  .slice(
                    0,
                    5,
                  )
                  .map(
                    (
                      conversation,
                    ) => (
                      <Link
                        key={
                          conversation.conversationId
                        }
                        href={`/dashboard/inbox?conversation=${encodeURIComponent(
                          conversation.conversationId,
                        )}`}
                        className="flex items-center gap-3 px-5 py-4 transition hover:bg-slate-50"
                      >
                        {conversation.profilePictureUrl ? (
                          <img
                            src={
                              conversation.profilePictureUrl
                            }
                            alt=""
                            className="h-10 w-10 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                            {getInitial(
                              conversation.customerName,
                            )}
                          </span>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {
                              conversation.customerName
                            }
                          </p>

                          <p className="mt-1 truncate text-xs text-slate-500">
                            {conversation.assignedMemberName
                              ? `Assigned to ${conversation.assignedMemberName}`
                              : "Unassigned"}
                            {conversation.unreadCount >
                            0
                              ? ` · ${conversation.unreadCount} unread`
                              : ""}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-red-600">
                            {formatWaiting(
                              conversation.waitingSeconds,
                            )}
                          </p>

                          <p className="mt-0.5 text-[10px] font-medium text-slate-400">
                            waiting
                          </p>
                        </div>
                      </Link>
                    ),
                  )}
              </div>
            )}
          </div>
        </section>

     
      </div>
    </main>
  );
}
