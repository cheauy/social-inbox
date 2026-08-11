"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createClient,
} from "@/lib/supabase/client";

type TimelineItem = {
  id: string;
  type: string;
  createdAt: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  actorProfilePictureUrl: string | null;
  conversationId: string | null;
  channel: "messenger" | "comment" | null;
  pageName: string | null;
};

type TimelineResponse = {
  success?: boolean;
  error?: string;
  items?: TimelineItem[];
};

type CustomerTimelineProps = {
  contactId: string;
  showHeader?: boolean;
};

type TimelineGroup = {
  key: string;
  label: string;
  items: TimelineItem[];
};

const INITIAL_VISIBLE_ITEMS = 8;

function startOfDay(
  date: Date,
) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
}

function formatDayLabel(
  value: string,
) {
  const date = new Date(value);
  const today =
    startOfDay(new Date());
  const target =
    startOfDay(date);
  const difference =
    Math.round(
      (today.getTime() -
        target.getTime()) /
        86_400_000,
    );

  if (difference === 0) {
    return "Today";
  }

  if (difference === 1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() ===
        today.getFullYear()
          ? undefined
          : "numeric",
    },
  ).format(date);
}

function formatTime(
  value: string,
) {
  return new Intl.DateTimeFormat(
    "en",
    {
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(new Date(value));
}

function getDayKey(
  value: string,
) {
  const date = new Date(value);

  return [
    date.getFullYear(),
    String(
      date.getMonth() + 1,
    ).padStart(2, "0"),
    String(
      date.getDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function buildGroups(
  items: TimelineItem[],
): TimelineGroup[] {
  const groups =
    new Map<
      string,
      TimelineGroup
    >();

  for (const item of items) {
    const key = getDayKey(
      item.createdAt,
    );
    const existing =
      groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      label: formatDayLabel(
        item.createdAt,
      ),
      items: [item],
    });
  }

  return Array.from(
    groups.values(),
  );
}

function getActivityStyle(
  type: string,
) {
  if (
    type === "tag_added" ||
    type === "tag_removed"
  ) {
    return "bg-violet-50 text-violet-600";
  }

  if (
    type === "assigned" ||
    type === "unassigned"
  ) {
    return "bg-blue-50 text-blue-600";
  }

  if (type === "status_changed") {
    return "bg-amber-50 text-amber-600";
  }

  if (
    type.includes("note")
  ) {
    return "bg-slate-100 text-slate-600";
  }

  if (
    type === "customer_created" ||
    type === "customer_updated" ||
    type === "customer_profile_updated"
  ) {
    return "bg-emerald-50 text-emerald-600";
  }

  if (type.startsWith("reminder_")) {
    return "bg-orange-50 text-orange-600";
  }

  if (
    type.startsWith("customer_file_") ||
    type.startsWith("customer_link_")
  ) {
    return "bg-indigo-50 text-indigo-600";
  }

  return "bg-cyan-50 text-cyan-600";
}

function TimelineIcon({
  type,
}: {
  type: string;
}) {
  if (
    type === "tag_added" ||
    type === "tag_removed"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M4 5h8l8 8-7 7-8-8z" />
        <circle cx="9" cy="9" r="1.2" />
      </svg>
    );
  }

  if (
    type === "assigned" ||
    type === "unassigned"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.7-3.2 2.5-5 5.5-5s4.8 1.8 5.5 5" />
        <path d="M17 9v6M14 12h6" />
      </svg>
    );
  }

  if (type === "status_changed") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M7 7h10M14 4l3 3-3 3" />
        <path d="M17 17H7M10 14l-3 3 3 3" />
      </svg>
    );
  }

  if (type.includes("note")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M5 4h14v16H5z" />
        <path d="M8 9h8M8 13h8M8 17h5" />
      </svg>
    );
  }

  if (
    type === "customer_created" ||
    type === "customer_updated" ||
    type === "customer_profile_updated"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" />
      </svg>
    );
  }

  if (type.startsWith("reminder_")) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="7" />
        <path d="M12 8v4l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 3 6 5M16 3l2 2" strokeLinecap="round" />
      </svg>
    );
  }

  if (
    type.startsWith("customer_file_") ||
    type.startsWith("customer_link_")
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-4 w-4"
        aria-hidden="true"
      >
        {type.startsWith("customer_link_") ? (
          <>
            <path d="M10 13.5 14 9.5" strokeLinecap="round" />
            <path d="M8 17H7a5 5 0 0 1 0-10h3" strokeLinecap="round" />
            <path d="M16 7h1a5 5 0 1 1 0 10h-3" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M6 3h8l4 4v14H6z" strokeLinejoin="round" />
            <path d="M14 3v5h5" strokeLinejoin="round" />
          </>
        )}
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 5h14v10H9l-4 4z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

function ActivitySource({
  item,
}: {
  item: TimelineItem;
}) {
  if (
    !item.pageName &&
    !item.channel
  ) {
    return null;
  }

  const channelLabel =
    item.channel === "comment"
      ? "Facebook comment"
      : item.channel === "messenger"
        ? "Messenger"
        : null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      {item.pageName ? (
        <span className="font-medium text-slate-500">
          {item.pageName}
        </span>
      ) : null}

      {item.pageName &&
      channelLabel ? (
        <span>•</span>
      ) : null}

      {channelLabel ? (
        <span>{channelLabel}</span>
      ) : null}
    </div>
  );
}

export function CustomerTimeline({
  contactId,
  showHeader = true,
}: CustomerTimelineProps) {
  const supabase = useMemo(
    () => createClient(),
    [],
  );

  const [items, setItems] =
    useState<TimelineItem[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState<string | null>(null);
  const [showAll, setShowAll] =
    useState(false);

  const loadTimeline =
    useCallback(
      async (
        silent = false,
      ) => {
        if (!silent) {
          setLoading(true);
        }

        setError(null);

        if (!contactId.trim()) {
          setItems([]);
          setError(
            "Customer information is unavailable.",
          );

          if (!silent) {
            setLoading(false);
          }
          return;
        }

        try {
          const response =
            await fetch(
              `/api/customers/${encodeURIComponent(
                contactId,
              )}/timeline`,
              {
                cache: "no-store",
              },
            );

          const result =
            (await response.json()) as
              TimelineResponse;

          if (
            !response.ok ||
            !result.success
          ) {
            throw new Error(
              result.error ??
                "Unable to load customer timeline.",
            );
          }

          setItems(
            result.items ?? [],
          );
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load customer timeline.",
          );
        } finally {
          if (!silent) {
            setLoading(false);
          }
        }
      },
      [contactId],
    );

  useEffect(() => {
    setShowAll(false);
    void loadTimeline();
  }, [loadTimeline]);

  useEffect(() => {
    if (!contactId.trim()) {
      return;
    }

    const channel = supabase
      .channel(
        `tenh-customer-timeline-${contactId}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table:
            "conversation_activity",
          filter:
            `contact_id=eq.${contactId}`,
        },
        () => {
          void loadTimeline(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table:
            "conversations",
          filter:
            `contact_id=eq.${contactId}`,
        },
        () => {
          void loadTimeline(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table:
            "conversation_reminders",
          filter:
            `contact_id=eq.${contactId}`,
        },
        () => {
          void loadTimeline(true);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_files",
          filter:
            `contact_id=eq.${contactId}`,
        },
        () => {
          void loadTimeline(true);
        },
      )
      .subscribe();

    const handleReminderChanged = () => {
      void loadTimeline(true);
    };

    window.addEventListener(
      "tenh-reminder-changed",
      handleReminderChanged,
    );

    return () => {
      window.removeEventListener(
        "tenh-reminder-changed",
        handleReminderChanged,
      );

      void supabase.removeChannel(
        channel,
      );
    };
  }, [
    contactId,
    loadTimeline,
    supabase,
  ]);

  const visibleItems =
    showAll
      ? items
      : items.slice(
          0,
          INITIAL_VISIBLE_ITEMS,
        );

  const groups =
    buildGroups(visibleItems);

  return (
    <section className={showHeader ? "border-t border-slate-200 pt-5" : ""}>
      {showHeader ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Customer timeline
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Customer and team activity only
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadTimeline()
            }
            disabled={loading}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              void loadTimeline()
            }
            disabled={loading}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map(
            (item) => (
              <div
                key={item}
                className="flex gap-3"
              >
                <div className="h-8 w-8 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ),
          )}
        </div>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() =>
              void loadTimeline()
            }
            className="mt-2 text-xs font-semibold text-red-700 underline"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No customer activity yet.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {groups.map(
            (group) => (
              <div
                key={group.key}
              >
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.label}
                </p>

                <div className="space-y-0">
                  {group.items.map(
                    (
                      item,
                      index,
                    ) => (
                      <div
                        key={item.id}
                        className="relative flex gap-3 pb-4 last:pb-0"
                      >
                        {index <
                        group.items.length -
                          1 ? (
                          <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-slate-200" />
                        ) : null}

                        <div
                          className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getActivityStyle(
                            item.type,
                          )}`}
                        >
                          <TimelineIcon
                            type={
                              item.type
                            }
                          />
                        </div>

                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium leading-5 text-slate-800">
                              {item.title}
                            </p>

                            <span className="shrink-0 text-[11px] text-slate-400">
                              {formatTime(
                                item.createdAt,
                              )}
                            </span>
                          </div>

                          {item.detail ? (
                            <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
                              {item.detail}
                            </p>
                          ) : null}

                          {item.actorName ? (
                            <p className="mt-1 text-[11px] text-slate-400">
                              by{" "}
                              <span className="font-medium text-slate-500">
                                {item.actorName}
                              </span>
                            </p>
                          ) : null}

                          <ActivitySource
                            item={item}
                          />
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ),
          )}

          {items.length >
          INITIAL_VISIBLE_ITEMS ? (
            <button
              type="button"
              onClick={() =>
                setShowAll(
                  (current) =>
                    !current,
                )
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              {showAll
                ? "Show less"
                : `Show all ${items.length} activities`}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
