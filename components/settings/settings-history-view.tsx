"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type ActivityType =
  | "status_changed"
  | "assigned"
  | "unassigned"
  | "tag_added"
  | "tag_removed"
  | "note_added"
  | "note_updated"
  | "note_deleted"
  | "customer_updated";

type ActivityRecord = {
  id: string;
  business_id: string;
  conversation_id: string;
  contact_id: string | null;
  actor_member_id: string | null;

  activity_type: ActivityType;

  title: string;
  description: string | null;

  customer_name: string;
  actor_name: string;

  actor_profile_picture_url:
    | string
    | null;

  metadata:
    | Record<string, unknown>
    | null;

  created_at: string;
};

type HistoryResponse = {
  success?: boolean;
  error?: string;

  activities?: ActivityRecord[];

  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

const filters: Array<{
  value: "all" | ActivityType;
  label: string;
}> = [
  {
    value: "all",
    label: "All activities",
  },
  {
    value: "status_changed",
    label: "Status",
  },
  {
    value: "assigned",
    label: "Assigned",
  },
  {
    value: "unassigned",
    label: "Unassigned",
  },
  {
    value: "tag_added",
    label: "Tag added",
  },
  {
    value: "tag_removed",
    label: "Tag removed",
  },
  {
    value: "note_added",
    label: "Note added",
  },
  {
    value: "note_updated",
    label: "Note updated",
  },
  {
    value: "note_deleted",
    label: "Note deleted",
  },
  {
    value: "customer_updated",
    label: "Customer updated",
  },
];

function formatDateTime(
  value: string,
) {
  return new Intl.DateTimeFormat(
    "en",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(new Date(value));
}

function getInitial(
  name: string,
) {
  return (
    name
      .trim()
      .charAt(0)
      .toUpperCase() || "U"
  );
}

function getActivityStyle(
  activityType: ActivityType,
) {
  switch (activityType) {
    case "status_changed":
      return {
        label: "Status",
        icon: "↻",
        iconClass:
          "bg-blue-100 text-blue-700",
        badgeClass:
          "bg-blue-50 text-blue-700",
      };

    case "assigned":
    case "unassigned":
      return {
        label:
          activityType === "assigned"
            ? "Assigned"
            : "Unassigned",
        icon: "👥",
        iconClass:
          "bg-violet-100 text-violet-700",
        badgeClass:
          "bg-violet-50 text-violet-700",
      };

    case "tag_added":
    case "tag_removed":
      return {
        label:
          activityType === "tag_added"
            ? "Tag added"
            : "Tag removed",
        icon: "◇",
        iconClass:
          "bg-emerald-100 text-emerald-700",
        badgeClass:
          "bg-emerald-50 text-emerald-700",
      };

    case "note_added":
    case "note_updated":
    case "note_deleted":
      return {
        label:
          activityType === "note_added"
            ? "Note added"
            : activityType ===
                "note_updated"
              ? "Note updated"
              : "Note deleted",
        icon: "✎",
        iconClass:
          "bg-amber-100 text-amber-700",
        badgeClass:
          "bg-amber-50 text-amber-700",
      };

    case "customer_updated":
      return {
        label: "Customer updated",
        icon: "●",
        iconClass:
          "bg-indigo-100 text-indigo-700",
        badgeClass:
          "bg-indigo-50 text-indigo-700",
      };
  }
}

function ActivityMetadata({
  activity,
}: {
  activity: ActivityRecord;
}) {
  const metadata =
    activity.metadata;

  if (!metadata) {
    return null;
  }

  if (
    activity.activity_type ===
      "status_changed" &&
    typeof metadata.oldStatus ===
      "string" &&
    typeof metadata.newStatus ===
      "string"
  ) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium capitalize text-slate-600">
          {metadata.oldStatus}
        </span>

        <span className="text-slate-400">
          →
        </span>

        <span className="rounded-lg bg-blue-100 px-2.5 py-1 font-medium capitalize text-blue-700">
          {metadata.newStatus}
        </span>
      </div>
    );
  }

  if (
    activity.activity_type ===
      "tag_added" ||
    activity.activity_type ===
      "tag_removed"
  ) {
    const tag =
      metadata.tag;

    if (
      tag &&
      typeof tag === "object" &&
      "name" in tag &&
      typeof tag.name === "string"
    ) {
      return (
        <div className="mt-3">
          <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700">
            {tag.name}
          </span>
        </div>
      );
    }
  }

  if (
    activity.activity_type ===
      "customer_updated" &&
    Array.isArray(
      metadata.changedFields,
    )
  ) {
    return (
      <div className="mt-3 space-y-2">
        {metadata.changedFields.map(
          (
            item,
            index,
          ) => {
            if (
              !item ||
              typeof item !==
                "object"
            ) {
              return null;
            }

            const field =
              item as {
                label?: unknown;
                oldValue?: unknown;
                newValue?: unknown;
              };

            return (
              <div
                key={index}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
              >
                <p className="font-semibold text-slate-700">
                  {typeof field.label ===
                  "string"
                    ? field.label
                    : "Changed field"}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-slate-500">
                  <span>
                    {typeof field.oldValue ===
                      "string" &&
                    field.oldValue
                      ? field.oldValue
                      : "Empty"}
                  </span>

                  <span>→</span>

                  <span className="font-medium text-slate-800">
                    {typeof field.newValue ===
                      "string" &&
                    field.newValue
                      ? field.newValue
                      : "Empty"}
                  </span>
                </div>
              </div>
            );
          },
        )}
      </div>
    );
  }

  return null;
}

export function SettingsHistoryView() {
  const [activities, setActivities] =
    useState<ActivityRecord[]>([]);

  const [search, setSearch] =
    useState("");

  const [
    selectedActivityType,
    setSelectedActivityType,
  ] = useState<
    "all" | ActivityType
  >("all");

const PAGE_SIZE = 10;

const [page, setPage] =
  useState(1);

const [loadingMore, setLoadingMore] =
  useState(false);

const [hasMore, setHasMore] =
  useState(false);

  const [total, setTotal] =
    useState(0);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

const queryString = useMemo(() => {
  const params =
    new URLSearchParams();

  params.set(
    "page",
    String(page),
  );

  params.set(
    "pageSize",
    String(PAGE_SIZE),
  );

  if (search.trim()) {
    params.set(
      "search",
      search.trim(),
    );
  }

  if (
    selectedActivityType !== "all"
  ) {
    params.set(
      "activityType",
      selectedActivityType,
    );
  }

  return params.toString();
}, [
  page,
  search,
  selectedActivityType,
]);

useEffect(() => {
  let cancelled = false;

  async function loadHistory() {
    if (page === 1) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    setError(null);

    try {
      const response =
        await fetch(
          `/api/settings/history?${queryString}`,
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
            ) as HistoryResponse)
          : null;

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            `Unable to load history. Server returned ${response.status}.`,
        );
      }

      if (cancelled) {
        return;
      }

      const nextActivities =
        result.activities ?? [];

      setActivities((current) => {
        if (page === 1) {
          return nextActivities;
        }

        const merged = [
          ...current,
          ...nextActivities,
        ];

        return Array.from(
          new Map(
            merged.map(
              (activity) => [
                activity.id,
                activity,
              ],
            ),
          ).values(),
        );
      });

      const nextTotal =
        result.pagination?.total ?? 0;

      setTotal(nextTotal);

      const loadedCount =
        page === 1
          ? nextActivities.length
          : (page - 1) *
              PAGE_SIZE +
            nextActivities.length;

      setHasMore(
        loadedCount < nextTotal,
      );
    } catch (loadError) {
      if (cancelled) {
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load history.",
      );
    } finally {
      if (!cancelled) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  const timeout =
    window.setTimeout(
      () => {
        void loadHistory();
      },
      search && page === 1
        ? 350
        : 0,
    );

  return () => {
    cancelled = true;

    window.clearTimeout(
      timeout,
    );
  };
}, [
  queryString,
  page,
  search,
]);

function changeActivityType(
  value: "all" | ActivityType,
) {
  setActivities([]);
  setSelectedActivityType(value);
  setPage(1);
  setHasMore(false);
}
return (
<div className="min-h-screen bg-slate-100">    
    <div className="w-full space-y-4 p-4">
     {/* Fixed page header */}
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">
          History
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Review recent changes and activity logs across your workspace.
        </p>
      </div>

      {/* Main activity card */}
<div className="mt-4 flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">        {/* Fixed toolbar */}
        <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-bold text-slate-950">
              Workspace activity
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {total} recorded activities
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search actor, customer or action..."
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:w-72"
            />

            <select
              value={selectedActivityType}
              onChange={(event) =>
                changeActivityType(
                  event.target.value as
                    | "all"
                    | ActivityType,
                )
              }
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              {filters.map((filter) => (
                <option
                  key={filter.value}
                  value={filter.value}
                >
                  {filter.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable content */}
<div className="divide-y divide-slate-100">  
            {loading ? (
            <div className="flex min-h-full items-center justify-center p-8">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                Loading history...
              </div>
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            </div>
          ) : activities.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl text-slate-500">
                ◷
              </div>

              <h3 className="mt-4 font-bold text-slate-900">
                No history found
              </h3>

              <p className="mt-2 max-w-sm text-sm text-slate-500">
                Activity records will appear here when team members update conversations and customers.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
  {activities.map(
    (activity) => {
      const style =
        getActivityStyle(
          activity.activity_type,
        );

      return (
        <article
          key={activity.id}
          className="flex gap-3 px-4 py-3 transition hover:bg-slate-50"
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${style.iconClass}`}
          >
            {style.icon}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-950">
                    {
                      activity.actor_name
                    }
                  </p>

                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badgeClass}`}
                  >
                    {style.label}
                  </span>
                </div>

                {activity.description ? (
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    {
                      activity.description
                    }
                  </p>
                ) : null}
              </div>

              <time className="shrink-0 text-[11px] text-slate-400">
                {formatDateTime(
                  activity.created_at,
                )}
              </time>
            </div>

            <ActivityMetadata
              activity={activity}
            />

            <div className="mt-2 text-xs text-slate-400">
              Customer:{" "}
              <strong className="font-medium text-slate-600">
                {
                  activity.customer_name
                }
              </strong>
            </div>
          </div>
        </article>
      );
    },
  )}
</div>
          )}
        </div>

{!loading &&
!error &&
activities.length > 0 ? (
  <div className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-5 py-3">
    <p className="text-sm text-slate-500">
      Showing{" "}
      {activities.length} of{" "}
      {total} activities
    </p>

    {hasMore ? (
      <button
        type="button"
        onClick={() =>
          setPage(
            (current) =>
              current + 1,
          )
        }
        disabled={loadingMore}
        className="inline-flex min-w-36 items-center justify-center rounded-lg border border-blue-200 bg-white px-5 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
      >
        {loadingMore ? (
          <>
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

            Loading...
          </>
        ) : (
          "Load more"
        )}
      </button>
    ) : (
      <span className="text-sm text-slate-400">
        All activities loaded
      </span>
    )}
  </div>
) : null}
      </div>
    </div>
  </div>
)
};
