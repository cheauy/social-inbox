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

function getPeriodLabel(
  period: PeriodKey,
) {
  return (
    PERIOD_OPTIONS.find(
      (item) =>
        item.value ===
        period,
    )?.label ??
    "Today"
  );
}

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

type DailyGrowthRow = {
  date: string;
  newCustomers: number;
};

type TopCustomer = {
  contactId: string;
  fullName: string;
  profilePictureUrl:
    | string
    | null;
  messages: number;
  incomingMessages: number;
  outgoingMessages: number;
  conversations: number;
  lastActivityAt:
    | string
    | null;
};

type TagBreakdown = {
  tagId: string;
  name: string;
  color: string;
  customers: number;
};

type ChannelBreakdown = {
  channel:
    | "messenger"
    | "comment"
    | string;
  messages: number;
  customers: number;
  conversations: number;
};

type CustomerInsightsResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  businessId?: string;
  analytics?: {
    summary?:
      Partial<CustomerSummary>;
    dailyGrowth?:
      DailyGrowthRow[];
    topCustomers?:
      TopCustomer[];
    tags?:
      TagBreakdown[];
    channels?:
      ChannelBreakdown[];
  };
};

const EMPTY_SUMMARY:
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

function formatCompactDate(
  date: string,
) {
  const parsed =
    new Date(`${date}T00:00:00`);

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return date;
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
    },
  ).format(parsed);
}

function formatDateTime(
  value: string | null,
) {
  if (!value) {
    return "No activity";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "No activity";
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

function getInitial(
  name: string,
) {
  return (
    name
      .trim()
      .charAt(0)
      .toUpperCase() ||
    "C"
  );
}

function channelLabel(
  channel: string,
) {
  return channel === "comment"
    ? "Facebook comments"
    : "Messenger";
}

export function CustomerInsightsPanel() {
  const [period, setPeriod] =
    useState<PeriodKey>(
      "today",
    );
  const [summary, setSummary] =
    useState<CustomerSummary>(
      EMPTY_SUMMARY,
    );
  const [
    dailyGrowth,
    setDailyGrowth,
  ] = useState<
    DailyGrowthRow[]
  >([]);
  const [
    topCustomers,
    setTopCustomers,
  ] = useState<
    TopCustomer[]
  >([]);
  const [tags, setTags] =
    useState<
      TagBreakdown[]
    >([]);
  const [
    channels,
    setChannels,
  ] = useState<
    ChannelBreakdown[]
  >([]);
  const [
    businessId,
    setBusinessId,
  ] = useState<
    string | null
  >(null);
  const [loading, setLoading] =
    useState(true);
  const [
    refreshing,
    setRefreshing,
  ] = useState(false);
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

  const loadInsights =
    useCallback(
      async (
        silent = false,
      ) => {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError(null);

        try {
          const params =
            new URLSearchParams({
              period,
              tzOffsetMinutes:
                String(
                  new Date()
                    .getTimezoneOffset(),
                ),
            });

          const response =
            await fetch(
              `/api/analytics/customers?${params.toString()}`,
              {
                cache:
                  "no-store",
              },
            );

          const result =
            (await response.json()) as
              CustomerInsightsResponse;

          if (
            !response.ok ||
            !result.success
          ) {
            throw new Error(
              result.error ??
                "Unable to load customer insights.",
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

          setDailyGrowth(
            analytics.dailyGrowth ??
              [],
          );

          setTopCustomers(
            analytics.topCustomers ??
              [],
          );

          setTags(
            analytics.tags ??
              [],
          );

          setChannels(
            analytics.channels ??
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
              : "Unable to load customer insights.",
          );
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [period],
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
        setTimeout(() => {
          void loadInsights(
            true,
          );
        }, 400);
    }, [loadInsights]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

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
          `tenh-customer-insights-${businessId}`,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "contacts",
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
        .subscribe(
          (status) => {
            if (
              status ===
              "SUBSCRIBED"
            ) {
              console.log(
                "[Tenh Customer Insights V2.15] ✅ REALTIME READY",
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

  const maxGrowth =
    useMemo(
      () =>
        Math.max(
          1,
          ...dailyGrowth.map(
            (item) =>
              item.newCustomers,
          ),
        ),
      [dailyGrowth],
    );

  const totalChannelMessages =
    useMemo(
      () =>
        channels.reduce(
          (
            total,
            item,
          ) =>
            total +
            item.messages,
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
        Loading customer insights...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-950">
            Customer insights
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Track customer growth, activity, returning customers, tags, and channel mix.
          </p>
        </div>

        <div className="flex max-w-full flex-wrap gap-1 self-start rounded-xl border border-slate-200 bg-slate-50 p-1">
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
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
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
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total customers"
          value={String(
            summary.totalCustomers,
          )}
          helper={`${summary.openCustomers} currently have open / pending conversations`}
        />

        <MetricCard
          label="New customers"
          value={String(
            summary.newCustomers,
          )}
          helper={`Created during ${getPeriodLabel(period).toLowerCase()}`}
        />

        <MetricCard
          label="Returning"
          value={String(
            summary.returningCustomers,
          )}
          helper="Existing customers active again during this period"
        />

        <MetricCard
          label="Active customers"
          value={String(
            summary.activeCustomers,
          )}
          helper={`${summary.messagesInPeriod} messages in this period`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-950">
                Customer growth
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                New customer profiles created each day.
              </p>
            </div>

            {refreshing ? (
              <span className="text-xs font-medium text-blue-600">
                Updating...
              </span>
            ) : null}
          </div>

          {dailyGrowth.length ===
          0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              No new customers in this period.
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {dailyGrowth.map(
                (item) => {
                  const width =
                    Math.max(
                      5,
                      Math.round(
                        (item.newCustomers /
                          maxGrowth) *
                          100,
                      ),
                    );

                  return (
                    <div
                      key={
                        item.date
                      }
                      className="grid grid-cols-[64px_minmax(0,1fr)_44px] items-center gap-3"
                    >
                      <span className="text-xs font-medium text-slate-500">
                        {formatCompactDate(
                          item.date,
                        )}
                      </span>

                      <div className="h-9 overflow-hidden rounded-lg bg-slate-100">
                        <div
                          className="flex h-full items-center rounded-lg bg-blue-100 px-3 text-xs font-semibold text-blue-700"
                          style={{
                            width:
                              `${width}%`,
                          }}
                        >
                          {item.newCustomers}
                        </div>
                      </div>

                      <span className="text-right text-xs font-semibold text-slate-700">
                        {
                          item.newCustomers
                        }
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
            Customer health
          </h3>

          <p className="mt-1 text-xs text-slate-500">
            Quick signals for follow-up and retention.
          </p>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <span className="text-sm font-semibold text-emerald-800">
                Active this period
              </span>
              <span className="text-lg font-bold text-emerald-800">
                {
                  summary.activeCustomers
                }
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
              <span className="text-sm font-semibold text-blue-800">
                Returning customers
              </span>
              <span className="text-lg font-bold text-blue-800">
                {
                  summary.returningCustomers
                }
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
              <span className="text-sm font-semibold text-amber-800">
                Inactive 30+ days
              </span>
              <span className="text-lg font-bold text-amber-800">
                {
                  summary.inactive30Days
                }
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  Customer messages
                </span>

                <span className="font-bold text-slate-950">
                  {
                    summary.incomingMessages
                  }
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  Team replies
                </span>

                <span className="font-bold text-slate-950">
                  {
                    summary.outgoingMessages
                  }
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(330px,0.85fr)]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-base font-bold text-slate-950">
              Most active customers
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Ranked by saved messages during the selected period.
            </p>
          </div>

          {topCustomers.length ===
          0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500">
              No customer activity in this period.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {topCustomers.map(
                (
                  customer,
                  index,
                ) => (
                  <Link
                    key={
                      customer.contactId
                    }
                    href={`/dashboard/customers/${customer.contactId}`}
                    className="flex items-center gap-3 px-5 py-4 transition hover:bg-slate-50"
                  >
                    <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-400">
                      #
                      {index +
                        1}
                    </span>

                    {customer.profilePictureUrl ? (
                      <img
                        src={
                          customer.profilePictureUrl
                        }
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                        {getInitial(
                          customer.fullName,
                        )}
                      </span>
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-950">
                        {
                          customer.fullName
                        }
                      </span>

                      <span className="mt-0.5 block text-xs text-slate-500">
                        {
                          customer.messages
                        }{" "}
                        messages ·{" "}
                        {
                          customer.conversations
                        }{" "}
                        conversation
                        {customer.conversations ===
                        1
                          ? ""
                          : "s"}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block text-xs font-semibold text-slate-700">
                        {
                          customer.incomingMessages
                        }{" "}
                        received
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {formatDateTime(
                          customer.lastActivityAt,
                        )}
                      </span>
                    </span>
                  </Link>
                ),
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-950">
              Channel activity
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Messenger vs Facebook Comment activity from the current conversation source.
            </p>

            {channels.length ===
            0 ? (
              <p className="mt-5 text-sm text-slate-500">
                No channel activity in this period.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {channels.map(
                  (item) => {
                    const percentage =
                      totalChannelMessages >
                      0
                        ? Math.round(
                            (item.messages /
                              totalChannelMessages) *
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
                            {
                              percentage
                            }
                            %
                          </span>
                        </div>

                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{
                              width:
                                `${Math.max(
                                  percentage,
                                  2,
                                )}%`,
                            }}
                          />
                        </div>

                        <p className="mt-1 text-[11px] text-slate-500">
                          {
                            item.messages
                          }{" "}
                          messages ·{" "}
                          {
                            item.customers
                          }{" "}
                          customers
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
              Customer tags
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Current active tag distribution.
            </p>

            {tags.length ===
            0 ? (
              <p className="mt-5 text-sm text-slate-500">
                No customer tags assigned yet.
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {tags.map(
                  (tag) => (
                    <div
                      key={
                        tag.tagId
                      }
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              tag.color,
                          }}
                        />

                        <span className="truncate text-sm font-semibold text-slate-700">
                          {
                            tag.name
                          }
                        </span>
                      </span>

                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                        {
                          tag.customers
                        }
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
