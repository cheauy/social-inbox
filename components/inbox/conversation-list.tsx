"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { InboxConversation } from "@/types/inbox";
import type {
  StatusCounts,
  StatusFilter,
} from "@/components/inbox/inbox-view-types";
import {
  formatMessageTime,
  getInitial,
  getStatusClasses,
  getStatusLabel,
  statusOptions,
} from "@/components/inbox/inbox-utils";

type ConversationListProps = {
  conversations: InboxConversation[];
  activeConversationId: string | null;
  activeStatus: StatusFilter;
  statusCounts: StatusCounts;
};

const filterOptions: Array<{
  value: StatusFilter;
  label: string;
}> = [
  {
    value: "all",
    label: "All",
  },
  ...statusOptions,
];



function FilterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M4 6h16M7 12h10M10 18h4"
        strokeLinecap="round"
      />
    </svg>
  );
}


type InboxListFilter =
  | "all"
  | "unread"
  | "comment"
  | "assigned_to_me"
  | "unassigned"
  | "tag"
  ;


function AllConversationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function UnreadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />

      <path
        d="m4 7 8 6 8-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="18"
        cy="6"
        r="3"
        fill="currentColor"
        stroke="white"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M8 9h8M8 13h5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AssignedToMeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="4" />

      <path
        d="M3 21v-2a6 6 0 0 1 12 0v2"
        strokeLinecap="round"
      />

      <path
        d="m16 12 2 2 4-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UnassignedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="4" />

      <path
        d="M3 21v-2a6 6 0 0 1 10-4.4"
        strokeLinecap="round"
      />

      <path
        d="m16 16 5 5M21 16l-5 5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
    >
      <path
        d="M20 13L13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="9"
        cy="9"
        r="1.5"
      />
    </svg>
  );
}
export function ConversationList({
  conversations,
  activeConversationId,
  activeStatus,
  statusCounts,
}: ConversationListProps) {
  const [filterOpen, setFilterOpen] =
    useState(false);

  const [search, setSearch] =
    useState("");

  /*
   * Hydration-safe time rendering.
   *
   * formatMessageTime() uses the runtime locale/timezone.
   * The server and browser can format the same date differently
   * (for example "Jul 31" vs "31 Jul").
   * Render no localized timestamp during SSR/initial hydration,
   * then render the browser-local value after mount.
   */
  const [hydrated, setHydrated] =
    useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

const [
  inboxFilter,
  setInboxFilter,
] = useState<InboxListFilter>("all");


const [tagFilterOpen, setTagFilterOpen] = useState(false);
const [selectedTags, setSelectedTags] = useState<string[]>([]);

/*
 * V2.5.1 — these values come directly from the live
 * conversation rows, so the unread badge changes without
 * router.refresh().
 */
const totalUnreadCount =
  useMemo(
    () =>
      conversations.reduce(
        (total, conversation) =>
          total +
          Math.max(
            0,
            conversation.unread_count ??
              0,
          ),
        0,
      ),
    [conversations],
  );

const unreadConversationCount =
  useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          conversation.unread_count > 0,
      ).length,
    [conversations],
  );
  
const filteredConversations =
  useMemo(() => {
    const keyword =
      search.trim().toLowerCase();

    return conversations.filter(
      (conversation) => {
        const name =
          conversation.contact?.full_name
            ?.toLowerCase() ?? "";

        const phone =
          conversation.contact?.phone
            ?.toLowerCase() ?? "";

        const matchesSearch =
          !keyword ||
          name.includes(keyword) ||
          phone.includes(keyword);

        if (!matchesSearch) {
          return false;
        }

        switch (inboxFilter) {
          case "unread":
            return conversation.unread_count > 0;

          case "comment":
            return false;

          case "assigned_to_me":
            return Boolean(
              conversation.assigned_to,
            );

          case "unassigned":
            return !conversation.assigned_to;

          default:
            return true;
        }
      },
    );
  }, [
    conversations,
    inboxFilter,
    search,
  ]);

  return (
  <section className="flex h-full min-h-0 w-full min-w-0 overflow-hidden border-r border-slate-200 bg-white">
    {/* Fixed icon rail */}
    <aside className="relative z-30 flex h-full w-16 shrink-0 flex-col overflow-visible border-r border-slate-200 bg-slate-50 py-3">
      {[
        {
          value: "all" as const,
          label: "All conversations",
          icon: <AllConversationIcon />,
        },
        {
          value: "unread" as const,
          label: "Unread",
          icon: <UnreadIcon />,
        },
        {
          value: "comment" as const,
          label: "Comment",
          icon: <CommentIcon />,
        },
        {
          value: "assigned_to_me" as const,
          label: "Assigned",
          icon: <AssignedToMeIcon />,
        },
        {
          value: "unassigned" as const,
          label: "Unassigned",
          icon: <UnassignedIcon />,
        },
        {
          value: "tag" as const,
          label: "Tag",
          icon: <TagIcon />,
        },
      ].map((filter) => {
        const isActive =
          inboxFilter === filter.value;

        return (
          <button
            key={filter.value}
            type="button"
            onClick={() =>
              setInboxFilter(filter.value)
            }
            className={`group relative mx-2 mb-1 flex h-12 shrink-0 items-center justify-center rounded-xl transition ${
              isActive
                ? "bg-blue-100 text-blue-700"
                : "text-slate-600 hover:bg-white hover:text-slate-900"
            }`}
            aria-label={filter.label}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              {filter.icon}
            </span>

            {
              filter.value ===
                "unread" &&
              totalUnreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-50 bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
                  {
                    totalUnreadCount >
                    99
                      ? "99+"
                      : totalUnreadCount
                  }
                </span>
              ) : null
            }

            {/* Hover label */}
            <span className="pointer-events-none absolute left-[58px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
              {filter.label}

              {
                filter.value ===
                  "unread" &&
                totalUnreadCount > 0
                  ? ` · ${totalUnreadCount} message${
                      totalUnreadCount ===
                      1
                        ? ""
                        : "s"
                    } in ${unreadConversationCount} chat${
                      unreadConversationCount ===
                      1
                        ? ""
                        : "s"
                    }`
                  : ""
              }

              <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
            </span>
          </button>

          
        );
      })}
    </aside>
{/* =========================
    TAG FILTER POPUP
========================= */}

{tagFilterOpen ? (
  <>
    <button
      type="button"
      className="fixed inset-0 z-30 cursor-default"
      onClick={() =>
        setTagFilterOpen(false)
      }
    />

    <div className="absolute left-16 top-3 z-40 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">

      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-bold">
          Filter by tags
        </h2>
      </div>

      <div className="max-h-[450px] overflow-y-auto p-3">

        {/* VIP */}
        <button className="mb-2 flex w-full items-center justify-between rounded-xl px-3 py-3 hover:bg-slate-50">

          <div className="flex items-center gap-3">

            <input type="checkbox" />

            <span
              className="h-3 w-3 rounded-full"
              style={{
                background: "#7C3AED",
              }}
            />

            <span>VIP</span>

          </div>

          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
            12
          </span>

        </button>

        {/* High Value */}
        <button className="mb-2 flex w-full items-center justify-between rounded-xl px-3 py-3 hover:bg-slate-50">

          <div className="flex items-center gap-3">

            <input type="checkbox" />

            <span
              className="h-3 w-3 rounded-full"
              style={{
                background: "#EC4899",
              }}
            />

            <span>High Value</span>

          </div>

          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
            6
          </span>

        </button>

      </div>

      <div className="flex gap-3 border-t border-slate-200 p-4">

        <button
          className="flex-1 rounded-xl border py-2"
          onClick={() =>
            setSelectedTags([])
          }
        >
          Reset
        </button>

        <button
          className="flex-1 rounded-xl bg-blue-600 py-2 text-white"
          onClick={() =>
            setTagFilterOpen(false)
          }
        >
          Apply
        </button>

      </div>

    </div>
  </>
) : null}
    {/* Search and conversations */}
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Search header */}
      <div className="relative shrink-0 border-b border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
                aria-hidden="true"
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
            </span>

            <input
              type="search"
              placeholder="Search name or phone number..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-3 text-[13px] outline-none transition placeholder:text-[12px] placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <button
            type="button"
            onClick={() =>
              setFilterOpen(
                (current) => !current,
              )
            }
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition ${
              filterOpen ||
              activeStatus !== "all"
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            aria-label="Filter conversations"
            aria-expanded={filterOpen}
          >
            <FilterIcon />

            {activeStatus !== "all" ? (
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-600" />
            ) : null}
          </button>
        </div>

        {filterOpen ? (
          <>
            <button
              type="button"
              aria-label="Close filters"
              onClick={() =>
                setFilterOpen(false)
              }
              className="fixed inset-0 z-30 cursor-default"
            />

            <div className="absolute right-3 top-[64px] z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">
                  Filter conversations
                </p>
              </div>

              <div className="p-2">
                {filterOptions.map(
                  (filter) => {
                    const isActive =
                      filter.value ===
                      activeStatus;

                    const href =
                      filter.value === "all"
                        ? "/dashboard/inbox"
                        : `/dashboard/inbox?status=${filter.value}`;

                    return (
                      <Link
                        key={filter.value}
                        href={href}
                        onClick={() =>
                          setFilterOpen(false)
                        }
                        className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition ${
                          isActive
                            ? "bg-blue-50 font-semibold text-blue-700"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              filter.value ===
                              "all"
                                ? "bg-slate-700"
                                : filter.value ===
                                    "open"
                                  ? "bg-emerald-500"
                                  : filter.value ===
                                      "pending"
                                    ? "bg-amber-500"
                                    : filter.value ===
                                        "resolved"
                                      ? "bg-blue-500"
                                      : filter.value ===
                                          "closed"
                                        ? "bg-slate-400"
                                        : "bg-red-500"
                            }`}
                          />

                          {filter.label}
                        </span>

                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            isActive
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {
                            statusCounts[
                              filter.value
                            ]
                          }
                        </span>
                      </Link>
                    );
                  },
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {activeStatus !== "all" ? (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              Showing:
            </span>

            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                  activeStatus,
                )}`}
              >
                {getStatusLabel(
                  activeStatus,
                )}
              </span>

              <Link
                href="/dashboard/inbox"
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Clear
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {/* Conversation list */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {filteredConversations.length ===
        0 ? (
          <div className="p-8 text-center">
            <p className="font-medium text-slate-800">
              No conversations found
            </p>

            <p className="mt-1 text-sm text-slate-500">
              {search.trim()
                ? "No customer matches this name or phone number."
                : "No conversations match this filter."}
            </p>
          </div>
        ) : (
          filteredConversations.map(
            (conversation) => {
              const customerName =
                conversation.contact
                  ?.full_name ??
                "Facebook customer";

              const isActive =
                conversation.id ===
                activeConversationId;

              const query =
                new URLSearchParams();

              query.set(
                "conversation",
                conversation.id,
              );

              if (
                activeStatus !== "all"
              ) {
                query.set(
                  "status",
                  activeStatus,
                );
              }

              return (
               <Link
                        key={conversation.id}
                        href={`/dashboard/inbox?${query.toString()}`}
                        className={`flex min-h-[88px] items-center gap-3 border-b border-slate-100 px-3 py-2 transition ${
                          isActive
                            ? "bg-blue-100"
                            : "hover:bg-slate-50"
                        }`}
                      >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                    {getInitial(
                      customerName,
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">
                        {customerName}
                      </p>

                      <span className="shrink-0 text-xs text-slate-400">
                        {hydrated
                          ? formatMessageTime(
                              conversation.last_message_at,
                            )
                          : ""}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-slate-500">
                        {conversation.last_message_text ??
                          "No messages"}
                      </p>

                      {conversation.unread_count >
                      0 ? (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                          {
                            conversation.unread_count
                          }
                        </span>
                      ) : null}
                    </div>

                    {(conversation.contact
                      ?.tags?.length ??
                      0) > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {(conversation.contact
                          ?.tags ??
                          [])
                          .slice(0, 2)
                          .map((tag) => (
                            <span
                              key={tag.id}
                              className="max-w-28 truncate rounded-full px-2 py-0.5 text-xs font-medium text-white"
                              style={{
                                backgroundColor:
                                  tag.color,
                              }}
                            >
                              {tag.name}
                            </span>
                          ))}

                        {(conversation.contact
                          ?.tags?.length ??
                          0) > 2 ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            +
                            {(conversation
                              .contact
                              ?.tags
                              ?.length ??
                              0) - 2}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Link>
              );
            },
          )
        )}
      </div>
    </div>
  </section>
);
}