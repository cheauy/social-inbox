"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

type TimelineActivity = {
  id: string;
  conversation_id: string | null;
  contact_id: string | null;
  activity_type: string;
  title: string;
  description: string | null;
  actor_name: string | null;
  actor_profile_picture_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TimelineResponse = {
  success: boolean;
  activities?: TimelineActivity[];
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
};

type CustomerTimelineProps = {
  customerId: string;
};

function getActivityStyle(
  activityType: string,
) {
  switch (activityType) {
    case "customer_created":
      return {
        icon: "👤",
        iconClass:
          "bg-emerald-100 text-emerald-700",
      };

    case "customer_updated":
    case "customer_profile_updated":
      return {
        icon: "📝",
        iconClass:
          "bg-blue-100 text-blue-700",
      };

    case "tag_added":
      return {
        icon: "🏷️",
        iconClass:
          "bg-violet-100 text-violet-700",
      };

    case "tag_removed":
      return {
        icon: "🏷️",
        iconClass:
          "bg-rose-100 text-rose-700",
      };

    case "assigned":
    case "unassigned":
    case "assignment_changed":
      return {
        icon: "👤",
        iconClass:
          "bg-amber-100 text-amber-700",
      };

    case "status_changed":
      return {
        icon: "🔄",
        iconClass:
          "bg-cyan-100 text-cyan-700",
      };

    case "note_added":
    case "note_updated":
    case "internal_note_added":
    case "internal_note_updated":
      return {
        icon: "📌",
        iconClass:
          "bg-yellow-100 text-yellow-700",
      };

    case "note_deleted":
    case "internal_note_deleted":
      return {
        icon: "🗑️",
        iconClass:
          "bg-red-100 text-red-700",
      };

    case "message_received":
      return {
        icon: "💬",
        iconClass:
          "bg-sky-100 text-sky-700",
      };

    case "message_sent":
      return {
        icon: "📨",
        iconClass:
          "bg-indigo-100 text-indigo-700",
      };

    default:
      return {
        icon: "📄",
        iconClass:
          "bg-slate-100 text-slate-600",
      };
  }
}

function getRelativeTime(
  value: string,
) {
  const timestamp =
    new Date(value).getTime();

  if (
    Number.isNaN(timestamp)
  ) {
    return "Unknown time";
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        (Date.now() - timestamp) /
          1000,
      ),
    );

  if (seconds < 30) {
    return "Just now";
  }

  if (seconds < 60) {
    return `${seconds} sec ago`;
  }

  if (seconds < 3600) {
    const minutes =
      Math.floor(seconds / 60);

    return `${minutes} min ago`;
  }

  if (seconds < 86400) {
    const hours =
      Math.floor(seconds / 3600);

    return `${hours} hr ago`;
  }

  if (seconds < 172800) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  ).format(new Date(value));
}

function getGroupLabel(
  value: string,
) {
  const date = new Date(value);

  const today = new Date();

  const yesterday =
    new Date();

  yesterday.setDate(
    today.getDate() - 1,
  );

  if (
    date.toDateString() ===
    today.toDateString()
  ) {
    return "Today";
  }

  if (
    date.toDateString() ===
    yesterday.toDateString()
  ) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  ).format(date);
}

export function CustomerTimeline({
  customerId,
}: CustomerTimelineProps) {
  const [
    activities,
    setActivities,
  ] = useState<
    TimelineActivity[]
  >([]);

  const [loading, setLoading] =
    useState(true);

  const [
    loadingMore,
    setLoadingMore,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [hasMore, setHasMore] =
    useState(false);

  const [
    nextCursor,
    setNextCursor,
  ] = useState<string | null>(
    null,
  );

  async function loadTimeline(
    cursor?: string,
  ) {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const params =
        new URLSearchParams({
          limit: "20",
        });

      if (cursor) {
        params.set(
          "cursor",
          cursor,
        );
      }

      const response =
        await fetch(
          `/api/customers/${encodeURIComponent(
            customerId,
          )}/timeline?${params.toString()}`,
          {
            cache: "no-store",
          },
        );

      const text =
        await response.text();

      const result =
        text.trim()
          ? (JSON.parse(
              text,
            ) as TimelineResponse)
          : null;

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            "Unable to load customer history.",
        );
      }

      const nextActivities =
        result.activities ?? [];

      setActivities(
        (current) =>
          cursor
            ? [
                ...current,
                ...nextActivities,
              ]
            : nextActivities,
      );

      setHasMore(
        Boolean(result.hasMore),
      );

      setNextCursor(
        result.nextCursor ?? null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load customer history.",
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    setActivities([]);
    setHasMore(false);
    setNextCursor(null);

    void loadTimeline();
  }, [customerId]);

  const groupedActivities =
    useMemo(() => {
      return activities.reduce<
        Record<
          string,
          TimelineActivity[]
        >
      >(
        (
          groups,
          activity,
        ) => {
          const group =
            getGroupLabel(
              activity.created_at,
            );

          if (!groups[group]) {
            groups[group] = [];
          }

          groups[group].push(
            activity,
          );

          return groups;
        },
        {},
      );
    }, [activities]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        {[1, 2, 3].map(
          (item) => (
            <div
              key={item}
              className="flex animate-pulse gap-4"
            >
              <div className="h-10 w-10 rounded-full bg-slate-200" />

              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 rounded bg-slate-200" />
                <div className="h-3 w-full max-w-md rounded bg-slate-100" />
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (
    activities.length === 0
  ) {
    return (
      <div className="px-8 py-14 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-3xl">
          ◷
        </div>

        <h3 className="mt-5 text-lg font-bold text-slate-900">
          No update histories
        </h3>

        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          Customer updates,
          assignments, status changes,
          notes and tags will appear
          here automatically.
        </p>
      </div>
    );
  }

  return (
    <div>
      {Object.entries(
        groupedActivities,
      ).map(
        ([group, items]) => (
          <section key={group}>
            <div className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50/95 px-6 py-3 backdrop-blur">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {group}
              </p>
            </div>

            <div>
              {items.map(
                (
                  activity,
                  index,
                ) => {
                  const style =
                    getActivityStyle(
                      activity.activity_type,
                    );

                  const content = (
                    <div className="relative flex gap-4 px-6 py-5 transition hover:bg-slate-50">
                      {index <
                      items.length -
                        1 ? (
                        <div className="absolute bottom-0 left-[43px] top-14 w-px bg-slate-200" />
                      ) : null}

                      <div
                        className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${style.iconClass}`}
                      >
                        {style.icon}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <h3 className="font-semibold text-slate-900">
                            {activity.title}
                          </h3>

                          <time className="shrink-0 text-xs text-slate-400">
                            {getRelativeTime(
                              activity.created_at,
                            )}
                          </time>
                        </div>

                        {activity.description ? (
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            {
                              activity.description
                            }
                          </p>
                        ) : null}

                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                          {activity.actor_profile_picture_url ? (
                            <img
                              src={
                                activity.actor_profile_picture_url
                              }
                              alt=""
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          ) : (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                              {(
                                activity.actor_name ??
                                "S"
                              )
                                .charAt(0)
                                .toUpperCase()}
                            </span>
                          )}

                          <span>
                            {activity.actor_name ??
                              "System"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );

                  return activity.conversation_id ? (
                    <Link
                      key={
                        activity.id
                      }
                      href={`/dashboard/inbox?conversation=${activity.conversation_id}`}
                      className="block"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      key={
                        activity.id
                      }
                    >
                      {content}
                    </div>
                  );
                },
              )}
            </div>
          </section>
        ),
      )}

      {hasMore ? (
        <div className="border-t border-slate-200 p-5">
          <button
            type="button"
            onClick={() => {
              if (nextCursor) {
                void loadTimeline(
                  nextCursor,
                );
              }
            }}
            disabled={
              loadingMore ||
              !nextCursor
            }
            className="flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            {loadingMore
              ? "Loading..."
              : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}