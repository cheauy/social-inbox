"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createClient,
} from "@/lib/supabase/client";

type PeriodKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d";

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

type StatusRow = {
  status: string;
  conversations: number;
};

type ChannelRow = {
  channel: string;
  conversations: number;
  incomingMessages: number;
};

type BusyHourRow = {
  hour: number;
  conversations: number;
};

type DailyRow = {
  date: string;
  received: number;
  resolved: number;
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

type ReportResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  businessId?: string;
  analytics?: {
    summary?:
      Partial<ConversationSummary>;
    statuses?: StatusRow[];
    channels?: ChannelRow[];
    busyHours?: BusyHourRow[];
    daily?: DailyRow[];
    waitingConversations?:
      WaitingConversation[];
  };
};

const PERIOD_OPTIONS: Array<{
  value: PeriodKey;
  label: string;
}> = [
  {
    value: "today",
    label: "Today",
  },
  {
    value: "yesterday",
    label: "Yesterday",
  },
  {
    value: "7d",
    label: "7 days",
  },
  {
    value: "30d",
    label: "30 days",
  },
  {
    value: "90d",
    label: "90 days",
  },
];

const SLA_OPTIONS = [
  5,
  10,
  15,
  30,
  60,
];

const EMPTY_SUMMARY:
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

      <p className="mt-1 text-xs leading-5 text-slate-500">
        {helper}
      </p>
    </div>
  );
}

function formatDuration(
  seconds: number,
) {
  if (
    !Number.isFinite(
      seconds,
    ) ||
    seconds < 0
  ) {
    return "—";
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes =
    Math.floor(
      seconds / 60,
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

function formatHour(
  hour: number,
) {
  const normalized =
    ((hour % 24) + 24) %
    24;

  const start =
    new Date(
      Date.UTC(
        2026,
        0,
        1,
        normalized,
      ),
    );

  const end =
    new Date(
      Date.UTC(
        2026,
        0,
        1,
        (normalized + 1) %
          24,
      ),
    );

  const formatter =
    new Intl.DateTimeFormat(
      "en",
      {
        hour: "numeric",
        hour12: true,
        timeZone: "UTC",
      },
    );

  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatCompactDate(
  value: string,
) {
  const date =
    new Date(
      `${value}T00:00:00`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
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

function statusLabel(
  value: string,
) {
  if (!value) {
    return "Unknown";
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function channelLabel(
  channel: string,
) {
  return channel === "comment"
    ? "Facebook comments"
    : "Messenger";
}

function getInitial(
  value: string,
) {
  return (
    value
      .trim()
      .charAt(0)
      .toUpperCase() ||
    "C"
  );
}

function statusClasses(
  status: string,
) {
  switch (status) {
    case "open":
      return "bg-emerald-50 text-emerald-700";
    case "pending":
      return "bg-amber-50 text-amber-700";
    case "resolved":
      return "bg-blue-50 text-blue-700";
    case "closed":
      return "bg-slate-100 text-slate-600";
    case "spam":
      return "bg-red-50 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function ConversationReportsPanel() {
  const [period, setPeriod] =
    useState<PeriodKey>(
      "today",
    );

  const [
    slaMinutes,
    setSlaMinutes,
  ] =
    useState(10);

  const [
    summary,
    setSummary,
  ] =
    useState<ConversationSummary>(
      EMPTY_SUMMARY,
    );

  const [
    statuses,
    setStatuses,
  ] =
    useState<StatusRow[]>(
      [],
    );

  const [
    channels,
    setChannels,
  ] =
    useState<ChannelRow[]>(
      [],
    );

  const [
    busyHours,
    setBusyHours,
  ] =
    useState<BusyHourRow[]>(
      [],
    );

  const [daily, setDaily] =
    useState<DailyRow[]>(
      [],
    );

  const [
    waitingConversations,
    setWaitingConversations,
  ] =
    useState<
      WaitingConversation[]
    >([]);

  const [
    businessId,
    setBusinessId,
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

  const [error, setError] =
    useState<
      string | null
    >(null);

  const refreshTimerRef =
    useRef<
      ReturnType<
        typeof setTimeout
      > | null
    >(null);

  const loadReport =
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

        setError(null);

        try {
          const params =
            new URLSearchParams({
              period,
              slaMinutes:
                String(
                  slaMinutes,
                ),
              tzOffsetMinutes:
                String(
                  new Date()
                    .getTimezoneOffset(),
                ),
            });

          const response =
            await fetch(
              `/api/analytics/conversations?${params.toString()}`,
              {
                cache:
                  "no-store",
              },
            );

          const result =
            (await response.json()) as
              ReportResponse;

          if (
            !response.ok ||
            !result.success
          ) {
            throw new Error(
              result.error ??
                "Unable to load conversation reports.",
            );
          }

          const analytics =
            result.analytics ??
            {};

          setSummary({
            ...EMPTY_SUMMARY,
            ...(analytics.summary ??
              {}),
          });

          setStatuses(
            analytics.statuses ??
              [],
          );

          setChannels(
            analytics.channels ??
              [],
          );

          setBusyHours(
            analytics.busyHours ??
              [],
          );

          setDaily(
            analytics.daily ??
              [],
          );

          setWaitingConversations(
            analytics.waitingConversations ??
              [],
          );

          setBusinessId(
            result.businessId ??
              null,
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load conversation reports.",
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [
        period,
        slaMinutes,
      ],
    );

  const scheduleRefresh =
    useCallback(() => {
      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current,
        );
      }

      refreshTimerRef.current =
        setTimeout(
          () => {
            void loadReport(
              true,
            );
          },
          400,
        );
    }, [loadReport]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    return () => {
      if (
        refreshTimerRef.current
      ) {
        clearTimeout(
          refreshTimerRef.current,
        );
      }
    };
  }, []);

  useEffect(() => {
    if (!businessId) {
      return;
    }

    const supabase =
      createClient();

    const channel =
      supabase
        .channel(
          `tenh-conversation-reports-${businessId}`,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "messages",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "conversations",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "conversation_activity",
            filter:
              `business_id=eq.${businessId}`,
          },
          scheduleRefresh,
        )
        .subscribe(
          (status) => {
            if (
              status ===
              "SUBSCRIBED"
            ) {
              console.log(
                "[Tenh Conversation Reports V2.16] ✅ REALTIME READY",
              );
            }
          },
        );

    return () => {
      void supabase
        .removeChannel(
          channel,
        );
    };
  }, [
    businessId,
    scheduleRefresh,
  ]);

  const maxBusyHour =
    useMemo(
      () =>
        Math.max(
          1,
          ...busyHours.map(
            (item) =>
              item.conversations,
          ),
        ),
      [busyHours],
    );

  const maxDaily =
    useMemo(
      () =>
        Math.max(
          1,
          ...daily.map(
            (item) =>
              Math.max(
                item.received,
                item.resolved,
              ),
          ),
        ),
      [daily],
    );

  const totalChannelConversations =
    useMemo(
      () =>
        channels.reduce(
          (
            total,
            item,
          ) =>
            total +
            item.conversations,
          0,
        ),
      [channels],
    );

  if (
    loading &&
    !refreshing
  ) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Loading conversation reports...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Conversation reports
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Review conversation volume, resolution, status, channel mix, busy hours, and customers waiting for a reply.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              {PERIOD_OPTIONS.map(
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
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                      item.value ===
                      period
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
          </div>
        </div>

        {refreshing ? (
          <p className="mt-3 text-xs font-medium text-blue-600">
            Updating report...
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Conversations received"
          value={String(
            summary.receivedConversations,
          )}
          helper="Unique conversations with a customer message in this period"
        />

        <MetricCard
          label="Resolved"
          value={String(
            summary.resolvedConversations,
          )}
          helper="Received conversations with a recorded resolved / closed action"
        />

        <MetricCard
          label="Resolution rate"
          value={
            summary.resolutionRate ===
            null
              ? "—"
              : `${summary.resolutionRate}%`
          }
          helper="Resolved conversations ÷ conversations received"
        />

        <MetricCard
          label="Waiting > SLA"
          value={String(
            summary.waitingOverSla,
          )}
          helper={`No later team reply within ${slaMinutes} minutes`}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Still open"
          value={String(
            summary.currentOpen,
          )}
          helper="Current Open status in the selected conversation cohort"
        />

        <MetricCard
          label="Pending"
          value={String(
            summary.currentPending,
          )}
          helper="Current Pending status"
        />

        <MetricCard
          label="Unread"
          value={String(
            summary.currentUnread,
          )}
          helper="Currently unread conversations"
        />

        <MetricCard
          label="Unassigned"
          value={String(
            summary.currentUnassigned,
          )}
          helper="Currently not assigned to an agent"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-950">
                Conversation volume
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                Received vs resolved conversations by local calendar day.
              </p>
            </div>

            <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                Received
              </span>

              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Resolved
              </span>
            </div>
          </div>

          {daily.length ===
          0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              No conversation activity in this period.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {daily.map(
                (item) => {
                  const receivedWidth =
                    Math.max(
                      item.received >
                        0
                        ? 3
                        : 0,
                      Math.round(
                        (item.received /
                          maxDaily) *
                          100,
                      ),
                    );

                  const resolvedWidth =
                    Math.max(
                      item.resolved >
                        0
                        ? 3
                        : 0,
                      Math.round(
                        (item.resolved /
                          maxDaily) *
                          100,
                      ),
                    );

                  return (
                    <div
                      key={
                        item.date
                      }
                      className="grid grid-cols-[64px_minmax(0,1fr)_84px] items-center gap-3"
                    >
                      <span className="text-xs font-medium text-slate-500">
                        {formatCompactDate(
                          item.date,
                        )}
                      </span>

                      <div className="space-y-1.5">
                        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{
                              width:
                                `${receivedWidth}%`,
                            }}
                          />
                        </div>

                        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{
                              width:
                                `${resolvedWidth}%`,
                            }}
                          />
                        </div>
                      </div>

                      <span className="text-right text-[11px] font-semibold text-slate-600">
                        {item.received} /{" "}
                        {item.resolved}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">
            Message volume
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            All saved customer and team messages in this period.
          </p>

          <div className="mt-5 grid gap-3">
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                Incoming
              </p>
              <p className="mt-1 text-2xl font-bold text-blue-950">
                {
                  summary.incomingMessages
                }
              </p>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                Outgoing
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-950">
                {
                  summary.outgoingMessages
                }
              </p>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <span className="text-sm font-semibold text-slate-600">
                Total messages
              </span>
              <span className="text-lg font-bold text-slate-950">
                {
                  summary.totalMessages
                }
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">
            Current status
          </h3>

          <p className="mt-1 text-xs leading-5 text-slate-500">
            Current state of conversations that received a customer message in this period.
          </p>

          {statuses.length ===
          0 ? (
            <p className="mt-5 text-sm text-slate-500">
              No conversations in this period.
            </p>
          ) : (
            <div className="mt-5 space-y-2.5">
              {statuses.map(
                (item) => (
                  <div
                    key={
                      item.status
                    }
                    className="flex items-center justify-between gap-3"
                  >
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClasses(
                        item.status,
                      )}`}
                    >
                      {statusLabel(
                        item.status,
                      )}
                    </span>

                    <span className="font-bold text-slate-950">
                      {
                        item.conversations
                      }
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">
            Channel
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            Where received conversations came from.
          </p>

          {channels.length ===
          0 ? (
            <p className="mt-5 text-sm text-slate-500">
              No channel activity.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {channels.map(
                (item) => {
                  const percentage =
                    totalChannelConversations >
                    0
                      ? Math.round(
                          (item.conversations /
                            totalChannelConversations) *
                            100,
                        )
                      : 0;

                  return (
                    <div
                      key={
                        item.channel
                      }
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm font-semibold text-slate-700">
                          {channelLabel(
                            item.channel,
                          )}
                        </span>

                        <span className="text-sm font-bold text-slate-950">
                          {percentage}%
                        </span>
                      </div>

                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{
                            width:
                              `${Math.max(
                                percentage,
                                item.conversations >
                                  0
                                  ? 2
                                  : 0,
                              )}%`,
                          }}
                        />
                      </div>

                      <p className="mt-1 text-[11px] text-slate-500">
                        {
                          item.conversations
                        }{" "}
                        conversations ·{" "}
                        {
                          item.incomingMessages
                        }{" "}
                        customer messages
                      </p>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">
            Busiest hours
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            Local hour when conversations first received a customer message.
          </p>

          {busyHours.length ===
          0 ? (
            <p className="mt-5 text-sm text-slate-500">
              No busy-hour data.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {busyHours.map(
                (item) => {
                  const width =
                    Math.max(
                      4,
                      Math.round(
                        (item.conversations /
                          maxBusyHour) *
                          100,
                      ),
                    );

                  return (
                    <div
                      key={
                        item.hour
                      }
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-600">
                          {formatHour(
                            item.hour,
                          )}
                        </span>

                        <span className="text-xs font-bold text-slate-950">
                          {
                            item.conversations
                          }
                        </span>
                      </div>

                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{
                            width:
                              `${width}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-950">
              Needs attention
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Open or pending conversations whose latest customer message has waited longer than the selected SLA.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-red-50 px-3 py-1.5 text-red-700">
              Waiting &gt; SLA{" "}
              {
                summary.waitingOverSla
              }
            </span>

            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-amber-700">
              Unread{" "}
              {
                summary.currentUnread
              }
            </span>

            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">
              Unassigned{" "}
              {
                summary.currentUnassigned
              }
            </span>
          </div>
        </div>

        {waitingConversations.length ===
        0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No conversations are over the selected SLA in this period.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {waitingConversations.map(
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

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-950">
                        {
                          conversation.customerName
                        }
                      </span>

                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusClasses(
                          conversation.status,
                        )}`}
                      >
                        {statusLabel(
                          conversation.status,
                        )}
                      </span>

                      {conversation.unreadCount >
                      0 ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                          {
                            conversation.unreadCount
                          }{" "}
                          unread
                        </span>
                      ) : null}
                    </span>

                    <span className="mt-1 block text-xs text-slate-500">
                      {conversation.assignedMemberName
                        ? `Assigned to ${conversation.assignedMemberName}`
                        : "Unassigned"}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold text-red-600">
                      {formatDuration(
                        conversation.waitingSeconds,
                      )}
                    </span>

                    <span className="mt-0.5 block text-[11px] text-slate-400">
                      waiting
                    </span>
                  </span>
                </Link>
              ),
            )}
          </div>
        )}
      </section>

      <p className="px-1 text-[11px] leading-5 text-slate-400">
        “Current status”, “Unread”, and “Unassigned” use the conversation&apos;s current Inbox state. Resolution counts use recorded status-change activity within the selected period.
      </p>
    </div>
  );
}
