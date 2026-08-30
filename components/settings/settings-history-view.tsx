"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

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
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
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
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
      <header>
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">
          {t("Workspace activity", "សកម្មភាពកន្លែងធ្វើការ")}
        </p>

        <h1 className="mt-2 text-[30px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[34px]">
          {t("Activity history", "ប្រវត្តិសកម្មភាព")}
        </h1>

        <p className="mt-1.5 text-sm leading-6 text-slate-600">
          {t("Review recent changes and activity logs across your workspace.", "ពិនិត្យមើលការផ្លាស់ប្តូរថ្មីៗ និងកំណត់ហេតុសកម្មភាពនៅទូទាំងកន្លែងធ្វើការរបស់អ្នក។")}
        </p>
      </header>

      <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,0.05)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              {t("Workspace activity", "សកម្មភាពកន្លែងធ្វើការ")}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {total} {t("recorded activities", "សកម្មភាពដែលបានកត់ត្រា")}
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
              placeholder={t("Search actor, customer or action...", "ស្វែងរកអ្នកធ្វើសកម្មភាព អតិថិជន ឬសកម្មភាព...")}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:w-72"
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
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
            >
              {filters.map((filter) => (
                <option
                  key={filter.value}
                  value={filter.value}
                >
                  {isKhmer ? ({ all: "សកម្មភាពទាំងអស់", status_changed: "ស្ថានភាព", assigned: "បានចាត់តាំង", unassigned: "បានដកការចាត់តាំង", tag_added: "បានបន្ថែមស្លាក", tag_removed: "បានដកស្លាក", note_added: "បានបន្ថែមចំណាំ", note_updated: "បានកែប្រែចំណាំ", note_deleted: "បានលុបចំណាំ", customer_updated: "បានកែប្រែអតិថិជន" } as const)[filter.value] : filter.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[22px] border border-slate-200 bg-white p-10 shadow-sm">
          <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
            {t("Loading history...", "កំពុងផ្ទុកប្រវត្តិ...")}
          </div>
        </section>
      ) : error ? (
        <section className="rounded-[22px] border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </section>
      ) : activities.length === 0 ? (
        <section className="rounded-[22px] border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl text-slate-500">
            ◷
          </div>

          <h3 className="mt-4 font-bold text-slate-900">
            {t("No history found", "រកមិនឃើញប្រវត្តិ")}
          </h3>

          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            {t("Activity records will appear here when team members update conversations and customers.", "កំណត់ត្រាសកម្មភាពនឹងបង្ហាញនៅទីនេះ នៅពេលសមាជិកក្រុមកែប្រែការសន្ទនា និងព័ត៌មានអតិថិជន។")}
          </p>
        </section>
      ) : (
        <section className="relative">
          <div className="pointer-events-none absolute bottom-4 left-[22px] top-4 hidden w-px bg-slate-200 sm:block" />

          <div className="space-y-2.5">
            {activities.map((activity) => {
              const style = getActivityStyle(
                activity.activity_type,
              );

              const metadata = activity.metadata;

              const tagName =
                (activity.activity_type ===
                  "tag_added" ||
                  activity.activity_type ===
                    "tag_removed") &&
                metadata &&
                typeof metadata === "object" &&
                "tag" in metadata &&
                metadata.tag &&
                typeof metadata.tag === "object" &&
                "name" in metadata.tag &&
                typeof metadata.tag.name === "string"
                  ? metadata.tag.name
                  : null;

              const isTagActivity =
                activity.activity_type ===
                  "tag_added" ||
                activity.activity_type ===
                  "tag_removed";

              const isAssignment =
                activity.activity_type ===
                  "assigned" ||
                activity.activity_type ===
                  "unassigned";

              return (
                <article
                  key={activity.id}
                  className="relative grid gap-3 rounded-[18px] border border-slate-200 bg-white px-4 py-3.5 shadow-[0_3px_12px_rgba(15,23,42,0.035)] transition hover:border-slate-300 hover:shadow-[0_5px_18px_rgba(15,23,42,0.06)] sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:items-start"
                >
                  <div className="relative z-10 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white ring-4 ring-slate-100">
                    {activity.actor_profile_picture_url ? (
                      <img
                        src={
                          activity.actor_profile_picture_url
                        }
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : isTagActivity ? (
                      <div className="flex h-full w-full items-center justify-center bg-emerald-50 text-emerald-600">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="h-5 w-5"
                          aria-hidden="true"
                        >
                          <path
                            d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82Z"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <circle
                            cx="8.5"
                            cy="7.5"
                            r="1"
                            fill="currentColor"
                            stroke="none"
                          />
                        </svg>
                      </div>
                    ) : isAssignment ? (
                      <div className="flex h-full w-full items-center justify-center bg-violet-50 text-sm font-bold text-violet-700">
                        {getInitial(
                          activity.actor_name,
                        )}
                      </div>
                    ) : (
                      <div
                        className={`flex h-full w-full items-center justify-center text-sm font-bold ${style.iconClass}`}
                      >
                        {style.icon}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-950">
                        {activity.actor_name}
                      </p>

                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${style.badgeClass}`}
                      >
                        {isKhmer ? ({ status_changed: "ស្ថានភាព", assigned: "បានចាត់តាំង", unassigned: "បានដកការចាត់តាំង", tag_added: "បានបន្ថែមស្លាក", tag_removed: "បានដកស្លាក", note_added: "បានបន្ថែមចំណាំ", note_updated: "បានកែប្រែចំណាំ", note_deleted: "បានលុបចំណាំ", customer_updated: "បានកែប្រែអតិថិជន" } as const)[activity.activity_type] : style.label}
                      </span>
                    </div>

                    {activity.description ? (
                      <p className="mt-1 text-sm leading-5 text-slate-600">
                        {activity.description}
                      </p>
                    ) : null}

                    {!isTagActivity ? (
                      <ActivityMetadata
                        activity={activity}
                      />
                    ) : null}

                    <p className="mt-1.5 text-xs text-blue-600">
                      {t("Customer:", "អតិថិជន៖")}{" "}
                      <span className="font-medium">
                        {activity.customer_name}
                      </span>
                    </p>
                  </div>

                  <div className="flex min-w-[150px] flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
                    {tagName ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          tagName.toLowerCase() === "vip"
                            ? "bg-blue-50 text-blue-600"
                            : tagName.toLowerCase() === "cod"
                              ? "bg-orange-50 text-orange-600"
                              : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {tagName}
                      </span>
                    ) : (
                      <span />
                    )}

                    <time className="whitespace-nowrap text-[11px] text-slate-400">
                      {formatDateTime(
                        activity.created_at,
                      )}
                    </time>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-[18px] border border-slate-200 bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {t("Showing", "កំពុងបង្ហាញ")} {activities.length} {t("of", "ក្នុងចំណោម")} {total} {t("activities", "សកម្មភាព")}
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
                className="inline-flex min-w-36 items-center justify-center rounded-xl border border-blue-200 bg-white px-5 py-2.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? (
                  <>
                    <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                    {t("Loading...", "កំពុងផ្ទុក...")}
                  </>
                ) : (
                  t("Load more", "ផ្ទុកបន្ថែម")
                )}
              </button>
            ) : (
              <span className="text-sm text-slate-400">
                {t("All activities loaded", "បានផ្ទុកសកម្មភាពទាំងអស់")}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  </div>
);
};
