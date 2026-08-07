"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

type CustomerTag = {
  id: string;
  name: string;
  color: string;
};

type AssignedMember = {
  id: string;
  fullName: string;
  role: string;
  profilePictureUrl: string | null;
};

type LatestConversation = {
  id: string;
  status: string;
  assignedTo: string | null;
  lastMessageAt: string | null;

  assignedMember:
    | AssignedMember
    | null;

  socialAccount: {
    id: string;
    platform: string;
    accountName: string | null;
  } | null;
};

type CustomerRecord = {
  id: string;
  fullName: string;
  profilePictureUrl: string | null;
  platformUserId: string;

  phone: string | null;
  address: string | null;
  customerNote: string | null;

  createdAt: string;
  lastActiveAt: string | null;

  conversationCount: number;

  latestConversation:
    | LatestConversation
    | null;

  tags: CustomerTag[];
};

type CustomerSummary = {
  totalCustomers: number;
  activeToday: number;
  unassignedConversations: number;
};

type CustomerResponse = {
  success?: boolean;
  error?: string;

  customers?: CustomerRecord[];

  summary?: CustomerSummary;

  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type StatusFilter =
  | "all"
  | "open"
  | "pending"
  | "resolved"
  | "closed"
  | "spam";

type AssignmentFilter =
  | "all"
  | "unassigned"
  | "me";

type CustomerTypeFilter =
  | "all"
  | "without_phone"
  | "with_note"
  | "multiple_conversations"
  | "new_customers"
  | "returning_customers";

type SortOption =
  | "recently_active"
  | "oldest_activity"
  | "newest_customer"
  | "oldest_customer"
  | "most_conversations"
  | "name_asc"
  | "name_desc";

const PAGE_SIZE = 20;

function formatDate(
  value: string | null,
) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
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
      .toUpperCase() || "C"
  );
}

function getStatusClasses(
  status: string,
) {
  switch (status) {
    case "open":
      return "bg-emerald-100 text-emerald-700";

    case "pending":
      return "bg-amber-100 text-amber-700";

    case "resolved":
      return "bg-blue-100 text-blue-700";

    case "closed":
      return "bg-slate-100 text-slate-700";

    case "spam":
      return "bg-red-100 text-red-700";

    default:
      return "bg-slate-100 text-slate-600";
  }
}

function SummaryCard({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">
        {label}
      </p>

      <p className="mt-2 text-3xl font-bold text-slate-950">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-400">
        {description}
      </p>
    </div>
  );
}

export function CustomersView() {
  const [customers, setCustomers] =
    useState<CustomerRecord[]>([]);

  const [summary, setSummary] =
    useState<CustomerSummary>({
      totalCustomers: 0,
      activeToday: 0,
      unassignedConversations: 0,
    });

  const [search, setSearch] =
    useState("");

  const [status, setStatus] =
    useState<StatusFilter>("all");

  const [assignment, setAssignment] =
    useState<AssignmentFilter>("all");

  const [
    customerType,
    setCustomerType,
  ] = useState<CustomerTypeFilter>(
    "all",
  );

  const [sort, setSort] =
    useState<SortOption>(
      "recently_active",
    );

  const [page, setPage] =
    useState(1);

  const [total, setTotal] =
    useState(0);

  const [totalPages, setTotalPages] =
    useState(1);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const queryString =
    useMemo(() => {
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

      params.set(
        "status",
        status,
      );

      params.set(
        "assignment",
        assignment,
      );

      params.set(
        "customerType",
        customerType,
      );

      params.set(
        "sort",
        sort,
      );

      if (search.trim()) {
        params.set(
          "search",
          search.trim(),
        );
      }

      return params.toString();
    }, [
      page,
      search,
      status,
      assignment,
      customerType,
      sort,
    ]);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers() {
      setLoading(true);
      setError(null);

      try {
        const response =
          await fetch(
            `/api/customers?${queryString}`,
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
              ) as CustomerResponse)
            : null;

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ??
              `Unable to load customers. Server returned ${response.status}.`,
          );
        }

        if (cancelled) {
          return;
        }

        setCustomers(
          result.customers ?? [],
        );

        setSummary(
          result.summary ?? {
            totalCustomers: 0,
            activeToday: 0,
            unassignedConversations: 0,
          },
        );

        setTotal(
          result.pagination?.total ??
            0,
        );

        setTotalPages(
          result.pagination
            ?.totalPages ?? 1,
        );
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load customers.",
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    const timeout =
      window.setTimeout(
        () => {
          void loadCustomers();
        },
        search.trim() ? 350 : 0,
      );

    return () => {
      cancelled = true;

      window.clearTimeout(
        timeout,
      );
    };
  }, [queryString, search]);

  function resetFilters() {
    setSearch("");
    setStatus("all");
    setAssignment("all");
    setCustomerType("all");
    setSort("recently_active");
    setPage(1);
  }

  const hasFilters =
    Boolean(search.trim()) ||
    status !== "all" ||
    assignment !== "all" ||
    customerType !== "all" ||
    sort !== "recently_active";

  const firstRecord =
    total === 0
      ? 0
      : (page - 1) *
          PAGE_SIZE +
        1;

  const lastRecord =
    Math.min(
      page * PAGE_SIZE,
      total,
    );

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
  <div className="w-full p-4 space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">
              Customers
            </h1>

            <p className="mt-2 text-sm text-slate-500">
              Search, review, and manage customers across your connected channels.
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryCard
            label="Total customers"
            value={
              summary.totalCustomers
            }
            description="Customers in this workspace"
          />

          <SummaryCard
            label="Active today"
            value={
              summary.activeToday
            }
            description="Customers active since midnight"
          />

          <SummaryCard
            label="Unassigned"
            value={
              summary.unassignedConversations
            }
            description="Conversations without an assignee"
          />
        </div>

        {/* Customer list */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Filters */}
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative min-w-0 flex-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="7"
                  />

                  <path
                    d="m20 20-3.5-3.5"
                    strokeLinecap="round"
                  />
                </svg>

                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(
                      event.target.value,
                    );

                    setPage(1);
                  }}
                  placeholder="Search name, phone or Facebook ID..."
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              <select
                value={status}
                onChange={(event) => {
                  setStatus(
                    event.target
                      .value as StatusFilter,
                  );

                  setPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              >
                <option value="all">
                  All statuses
                </option>

                <option value="open">
                  Open
                </option>

                <option value="pending">
                  Pending
                </option>

                <option value="resolved">
                  Resolved
                </option>

                <option value="closed">
                  Closed
                </option>

                <option value="spam">
                  Spam
                </option>
              </select>

              <select
                value={assignment}
                onChange={(event) => {
                  setAssignment(
                    event.target
                      .value as AssignmentFilter,
                  );

                  setPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              >
                <option value="all">
                  All assignments
                </option>

                <option value="me">
                  Assigned to me
                </option>

                <option value="unassigned">
                  Unassigned
                </option>
              </select>

              <select
                value={customerType}
                onChange={(event) => {
                  setCustomerType(
                    event.target
                      .value as CustomerTypeFilter,
                  );

                  setPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              >
                <option value="all">
                  All customers
                </option>

                <option value="without_phone">
                  Without phone
                </option>

                <option value="with_note">
                  With customer note
                </option>

                <option value="multiple_conversations">
                  Multiple conversations
                </option>

                <option value="new_customers">
                  New customers
                </option>

                <option value="returning_customers">
                  Returning customers
                </option>
              </select>

              <select
                value={sort}
                onChange={(event) => {
                  setSort(
                    event.target
                      .value as SortOption,
                  );

                  setPage(1);
                }}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              >
                <option value="recently_active">
                  Recently active
                </option>

                <option value="oldest_activity">
                  Oldest activity
                </option>

                <option value="newest_customer">
                  Newest customer
                </option>

                <option value="oldest_customer">
                  Oldest customer
                </option>

                <option value="most_conversations">
                  Most conversations
                </option>

                <option value="name_asc">
                  Name A–Z
                </option>

                <option value="name_desc">
                  Name Z–A
                </option>
              </select>

              {hasFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-96 items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                Loading customers...
              </div>
            </div>
          ) : error ? (
            <div className="p-6">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            </div>
          ) : customers.length ===
            0 ? (
            <div className="flex min-h-96 flex-col items-center justify-center p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl text-blue-700">
                👥
              </div>

              <h2 className="mt-4 text-lg font-bold text-slate-900">
                No customers found
              </h2>

              <p className="mt-2 max-w-md text-sm text-slate-500">
                Customers will appear here after they contact one of your connected pages.
              </p>

              {hasFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Customer
                      </th>

                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Phone
                      </th>

                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Tags
                      </th>

                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Conversations
                      </th>

                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Assigned
                      </th>

                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Last active
                      </th>

                      <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                        Status
                      </th>

                      <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {customers.map(
                      (customer) => {
                        const latest =
                          customer.latestConversation;

                        return (
                          <tr
                            key={
                              customer.id
                            }
                            className="transition hover:bg-slate-50"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                {customer.profilePictureUrl ? (
                                  <img
                                    src={
                                      customer.profilePictureUrl
                                    }
                                    alt=""
                                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                                    {getInitial(
                                      customer.fullName,
                                    )}
                                  </div>
                                )}

                                <div className="min-w-0">
                                  <p className="max-w-52 truncate font-semibold text-slate-900">
                                    {
                                      customer.fullName
                                    }
                                  </p>

                                  <p className="mt-0.5 max-w-52 truncate text-xs text-slate-400">
                                    Facebook ID:{" "}
                                    {
                                      customer.platformUserId
                                    }
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                              {customer.phone ??
                                "Not added"}
                            </td>

                            <td className="px-5 py-4">
                              <div className="flex max-w-60 flex-wrap gap-1.5">
                                {customer.tags.length >
                                0 ? (
                                  customer.tags
                                    .slice(0, 3)
                                    .map(
                                      (
                                        tag,
                                      ) => (
                                        <span
                                          key={
                                            tag.id
                                          }
                                          className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                                        >
                                          {
                                            tag.name
                                          }
                                        </span>
                                      ),
                                    )
                                ) : (
                                  <span className="text-sm text-slate-400">
                                    No tags
                                  </span>
                                )}

                                {customer.tags.length >
                                3 ? (
                                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                                    +
                                    {customer
                                      .tags
                                      .length -
                                      3}
                                  </span>
                                ) : null}
                              </div>
                            </td>

                            <td className="whitespace-nowrap px-5 py-4">
                              <span className="font-semibold text-slate-900">
                                {
                                  customer.conversationCount
                                }
                              </span>
                            </td>

                            <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">
                              {latest
                                ?.assignedMember
                                ?.fullName ??
                                "Unassigned"}
                            </td>

                            <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                              {formatDate(
                                customer.lastActiveAt,
                              )}
                            </td>

                            <td className="whitespace-nowrap px-5 py-4">
                              {latest ? (
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                                    latest.status,
                                  )}`}
                                >
                                  {
                                    latest.status
                                  }
                                </span>
                              ) : (
                                <span className="text-sm text-slate-400">
                                  No conversation
                                </span>
                              )}
                            </td>

                            <td className="whitespace-nowrap px-5 py-4 text-right">
                              <Link
                                href={`/dashboard/customers/${customer.id}`}
                                className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                              >
                                View
                              </Link>
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 lg:hidden">
                {customers.map(
                  (customer) => {
                    const latest =
                      customer.latestConversation;

                    return (
                      <article
                        key={customer.id}
                        className="p-5"
                      >
                        <div className="flex items-start gap-3">
                          {customer.profilePictureUrl ? (
                            <img
                              src={
                                customer.profilePictureUrl
                              }
                              alt=""
                              className="h-11 w-11 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                              {getInitial(
                                customer.fullName,
                              )}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-slate-900">
                              {
                                customer.fullName
                              }
                            </p>

                            <p className="mt-1 truncate text-xs text-slate-400">
                              {
                                customer.platformUserId
                              }
                            </p>
                          </div>

                          {latest ? (
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                                latest.status,
                              )}`}
                            >
                              {latest.status}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-xs text-slate-400">
                              Phone
                            </p>

                            <p className="mt-1 font-medium text-slate-700">
                              {customer.phone ??
                                "Not added"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs text-slate-400">
                              Conversations
                            </p>

                            <p className="mt-1 font-medium text-slate-700">
                              {
                                customer.conversationCount
                              }
                            </p>
                          </div>

                          <div>
                            <p className="text-xs text-slate-400">
                              Assigned
                            </p>

                            <p className="mt-1 font-medium text-slate-700">
                              {latest
                                ?.assignedMember
                                ?.fullName ??
                                "Unassigned"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs text-slate-400">
                              Last active
                            </p>

                            <p className="mt-1 font-medium text-slate-700">
                              {formatDate(
                                customer.lastActiveAt,
                              )}
                            </p>
                          </div>
                        </div>

                        <Link
                          href={`/dashboard/customers/${customer.id}`}
                          className="mt-4 flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          View customer
                        </Link>
                      </article>
                    );
                  },
                )}
              </div>
            </>
          )}

          {!loading &&
          !error &&
          customers.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Showing {firstRecord}–
                {lastRecord} of {total} customers
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setPage(
                      (current) =>
                        Math.max(
                          current - 1,
                          1,
                        ),
                    )
                  }
                  disabled={page <= 1}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setPage(
                      (current) =>
                        Math.min(
                          current + 1,
                          totalPages,
                        ),
                    )
                  }
                  disabled={
                    page >= totalPages
                  }
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}