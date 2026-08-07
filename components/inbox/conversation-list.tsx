"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

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

type InboxListFilter =
  | "all"
  | "unread"
  | "comment"
  | "assigned_to_me"
  | "unassigned"
  | "tag";

type AvailableTag = {
  id: string;
  name: string;
  color: string;
  count: number;
};

const filterOptions: Array<{
  value: StatusFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  ...statusOptions,
];

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
      <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
    </svg>
  );
}

function AllConversationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function UnreadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="6" r="3" fill="currentColor" stroke="white" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9h8M8 13h5" strokeLinecap="round" />
    </svg>
  );
}

function AssignedToMeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M3 21v-2a6 6 0 0 1 12 0v2" strokeLinecap="round" />
      <path d="m16 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UnassignedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M3 21v-2a6 6 0 0 1 10-4.4" strokeLinecap="round" />
      <path d="m16 16 5 5M21 16l-5 5" strokeLinecap="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
      <path d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.5" />
    </svg>
  );
}

function MessagePreviewIcon({
  type,
}: {
  type:
    | InboxConversation["latest_message_type"];
}) {
  if (type === "audio") {
    return (
      <span aria-hidden="true">
        🎤
      </span>
    );
  }

  if (type === "image") {
    return (
      <span aria-hidden="true">
        📷
      </span>
    );
  }

  if (type === "video") {
    return (
      <span aria-hidden="true">
        🎥
      </span>
    );
  }

  if (type === "file") {
    return (
      <span aria-hidden="true">
        📄
      </span>
    );
  }

  if (type === "sticker") {
    return (
      <span aria-hidden="true">
        😊
      </span>
    );
  }

  return null;
}

function getMessagePreview(
  conversation: InboxConversation,
) {
  switch (
    conversation.latest_message_type
  ) {
    case "audio":
      return "Sent a voice message";

    case "image":
      return "Sent a photo";

    case "video":
      return "Sent a video";

    case "file":
      return "Sent a file";

    case "sticker":
      return "Sent a sticker";

    case "unknown":
      return (
        conversation.last_message_text ??
        "Unsupported message"
      );

    case "text":
    default:
      return (
        conversation.last_message_text ??
        "No messages"
      );
  }
}

function formatStableMessageTime(
  value: string | null,
) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path
        d="m14 4 6 6-3 1-4 4-1 5-3-3-5 3 3-5 4-4 1-3 2-4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
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
  const router = useRouter();

  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [inboxFilter, setInboxFilter] = useState<InboxListFilter>("all");
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [draftSelectedTags, setDraftSelectedTags] = useState<string[]>([]);
  const [
  mounted,
  setMounted,
] = useState(false);

useEffect(() => {
  setMounted(true);
}, []);
  const availableTags = useMemo<AvailableTag[]>(() => {
    const tags = new Map<string, AvailableTag>();

    for (const conversation of conversations) {
      for (const tag of conversation.contact?.tags ?? []) {
        const current = tags.get(tag.id);

        if (current) {
          current.count += 1;
        } else {
          tags.set(tag.id, {
            id: tag.id,
            name: tag.name,
            color: tag.color,
            count: 1,
          });
        }
      }
    }

    return Array.from(tags.values()).sort((first, second) =>
      first.name.localeCompare(second.name),
    );
  }, [conversations]);

  const visibleTags = useMemo(() => {
    const keyword = tagSearch.trim().toLowerCase();

    if (!keyword) {
      return availableTags;
    }

    return availableTags.filter((tag) =>
      tag.name.toLowerCase().includes(keyword),
    );
  }, [availableTags, tagSearch]);

const filteredConversations =
  useMemo(() => {
    const keyword =
      search
        .trim()
        .toLowerCase();

    return conversations.filter(
      (conversation) => {
        const name =
          conversation.contact
            ?.full_name
            ?.toLowerCase() ??
          "";

        const phone =
          conversation.contact
            ?.phone
            ?.toLowerCase() ??
          "";

        /*
         * Search name / phone
         */
        if (
          keyword &&
          !name.includes(keyword) &&
          !phone.includes(keyword)
        ) {
          return false;
        }

        /*
         * Customer tag filter
         */
        if (
          selectedTags.length > 0
        ) {
          const hasSelectedTag =
            (
              conversation.contact
                ?.tags ?? []
            ).some((tag) =>
              selectedTags.includes(
                tag.id,
              ),
            );

          if (!hasSelectedTag) {
            return false;
          }
        }

        /*
         * Left rail filter
         */
        switch (inboxFilter) {
          case "unread":
            return (
              conversation.unread_count >
              0
            );

          case "comment":
            return (
              conversation.source_type ===
              "comment"
            );

          case "assigned_to_me":
            return Boolean(
              conversation.assigned_to,
            );

          case "unassigned":
            return (
              !conversation.assigned_to
            );

          case "tag":
          case "all":
          default:
            return true;
        }
      },
    );
  }, [
    conversations,
    inboxFilter,
    search,
    selectedTags,
  ]);

  const railFilters = [
    { value: "all" as const, label: "All conversations", icon: <AllConversationIcon /> },
    { value: "unread" as const, label: "Unread", icon: <UnreadIcon /> },
    { value: "comment" as const, label: "Comment", icon: <CommentIcon /> },
    { value: "assigned_to_me" as const, label: "Assigned", icon: <AssignedToMeIcon /> },
    { value: "unassigned" as const, label: "Unassigned", icon: <UnassignedIcon /> },
    { value: "tag" as const, label: "Filter by tags", icon: <TagIcon /> },
  ];

  return (
    <section className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden border-r border-slate-200 bg-white">
      <aside className="relative z-30 flex h-full w-16 shrink-0 flex-col overflow-visible border-r border-slate-200 bg-slate-50 py-3">
        {railFilters.map((filter) => {
          const isTagFilter = filter.value === "tag";
          const isActive = isTagFilter
            ? tagFilterOpen || selectedTags.length > 0
            : inboxFilter === filter.value;

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => {
                if (isTagFilter) {
                  setDraftSelectedTags(selectedTags);
                  setTagFilterOpen((current) => !current);
                  setFilterOpen(false);
                  return;
                }

                setTagFilterOpen(false);
                setInboxFilter(filter.value);
              }}
              className={`group relative mx-2 mb-1 flex h-12 shrink-0 items-center justify-center rounded-xl transition ${
                isActive
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-600 hover:bg-white hover:text-slate-900"
              }`}
              aria-label={filter.label}
              aria-expanded={isTagFilter ? tagFilterOpen : undefined}
            >
              <span className="flex h-5 w-5 items-center justify-center">{filter.icon}</span>

              {isTagFilter && selectedTags.length > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-blue-600 px-1 text-[10px] font-bold text-white">
                  {selectedTags.length}
                </span>
              ) : null}

              <span className="pointer-events-none absolute left-[58px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
                {filter.label}
                <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
              </span>
            </button>
          );
        })}
      </aside>

      {tagFilterOpen ? (
        <>
          <button
            type="button"
            onClick={() => setTagFilterOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/5"
            aria-label="Close tag filter"
          />

          <section className="absolute left-16 top-3 z-50 flex max-h-[calc(100%-24px)] w-80 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Filter by tags</h2>
                <p className="mt-1 text-xs text-slate-500">Select one or more customer tags.</p>
              </div>

              <button
                type="button"
                onClick={() => setTagFilterOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="border-b border-slate-200 p-4">
              <input
                type="search"
                value={tagSearch}
                onChange={(event) => setTagSearch(event.target.value)}
                placeholder="Search tags..."
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {visibleTags.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">No tags found.</div>
              ) : (
                visibleTags.map((tag) => {
                  const checked = draftSelectedTags.includes(tag.id);

                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        setDraftSelectedTags((current) =>
                          current.includes(tag.id)
                            ? current.filter((id) => id !== tag.id)
                            : [...current, tag.id],
                        )
                      }
                      className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                        checked ? "bg-blue-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                          checked
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {checked ? "✓" : ""}
                      </span>

                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{tag.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{tag.count}</span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex shrink-0 gap-3 border-t border-slate-200 bg-slate-50 p-4">
              <button
                type="button"
                onClick={() => {
                  setDraftSelectedTags([]);
                  setSelectedTags([]);
                  setTagSearch("");
                  setTagFilterOpen(false);
                }}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>

              <button
                type="button"
                onClick={() => {
                  const appliedTagIds =
                    draftSelectedTags;

                  setSelectedTags(
                    appliedTagIds,
                  );

                  const matchingConversations =
                    conversations.filter(
                      (conversation) => {
                        if (
                          appliedTagIds.length ===
                          0
                        ) {
                          return true;
                        }

                        const customerTags =
                          conversation.contact
                            ?.tags ?? [];

                        return customerTags.some(
                          (tag) =>
                            appliedTagIds.includes(
                              tag.id,
                            ),
                        );
                      },
                    );

                  const activeStillMatches =
                    matchingConversations.some(
                      (conversation) =>
                        conversation.id ===
                        activeConversationId,
                    );

                  setTagFilterOpen(false);

                  if (
                    activeStillMatches ||
                    matchingConversations.length ===
                      0
                  ) {
                    return;
                  }

                  const firstMatch =
                    matchingConversations[0];

                  const query =
                    new URLSearchParams();

                  query.set(
                    "conversation",
                    firstMatch.id,
                  );

                  if (
                    activeStatus !== "all"
                  ) {
                    query.set(
                      "status",
                      activeStatus,
                    );
                  }

                  router.push(
                    `/dashboard/inbox?${query.toString()}`,
                  );
                }}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Apply
              </button>
            </div>
          </section>
        </>
      ) : null}

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative shrink-0 border-b border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
              </span>

              <input
                type="search"
                placeholder="Search name or phone number..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-xl border border-slate-300 py-3 pl-9 pr-3 text-[13px] outline-none transition placeholder:text-[12px] placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setTagFilterOpen(false);
                setFilterOpen((current) => !current);
              }}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition ${
                filterOpen || activeStatus !== "all"
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
                onClick={() => setFilterOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />

              <div className="absolute right-3 top-[64px] z-40 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">Filter conversations</p>
                </div>

                <div className="p-2">
                  {filterOptions.map((filter) => {
                    const isActive = filter.value === activeStatus;
                    const href = filter.value === "all" ? "/dashboard/inbox" : `/dashboard/inbox?status=${filter.value}`;

                    return (
                      <Link
                        key={filter.value}
                        href={href}
                        onClick={() => setFilterOpen(false)}
                        className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition ${
                          isActive
                            ? "bg-blue-50 font-semibold text-blue-700"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              filter.value === "all"
                                ? "bg-slate-700"
                                : filter.value === "open"
                                  ? "bg-emerald-500"
                                  : filter.value === "pending"
                                    ? "bg-amber-500"
                                    : filter.value === "resolved"
                                      ? "bg-blue-500"
                                      : filter.value === "closed"
                                        ? "bg-slate-400"
                                        : "bg-red-500"
                            }`}
                          />
                          {filter.label}
                        </span>

                        <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                          {statusCounts[filter.value]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>

        {activeStatus !== "all" ? (
          <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">Showing:</span>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(activeStatus)}`}>
                  {getStatusLabel(activeStatus)}
                </span>
                <Link href="/dashboard/inbox" className="text-xs font-medium text-blue-700 hover:underline">Clear</Link>
              </div>
            </div>
          </div>
        ) : null}

<div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-slate-50/40 py-1">          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-medium text-slate-800">No conversations found</p>
              <p className="mt-1 text-sm text-slate-500">
                {search.trim()
                  ? "No customer matches this name or phone number."
                  : "No conversations match this filter."}
              </p>
            </div>
          ) : (
            filteredConversations.map((conversation) => {
              const customerName = conversation.contact?.full_name ?? "Facebook customer";
              const messagePreview =
  getMessagePreview(
    conversation,
  );

const assignedMemberName =
  conversation.assigned_member
    ?.full_name?.trim() ??
  "";
              const isActive = conversation.id === activeConversationId;
              const query = new URLSearchParams();

              query.set("conversation", conversation.id);

              if (activeStatus !== "all") {
                query.set("status", activeStatus);
              }

              return (
           <Link
  key={conversation.id}
  href={`/dashboard/inbox?${query.toString()}`}
 className={`relative mx-2 my-1.5 flex min-h-[104px] items-center gap-3 rounded-2xl border px-3 py-2.5 transition-all ${
  isActive
    ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-100"
    : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50"
}`}
>
  {isActive ? (
  <span className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full bg-blue-600" />
) : null}
 <div
  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-semibold ${
    isActive
      ? "bg-blue-100 text-blue-700"
      : "bg-slate-100 text-blue-700"
  }`}
>
    {getInitial(customerName)}
  </div>

  <div className="min-w-0 flex-1">
    {/* Row 1: customer and time */}
    <div className="flex items-center justify-between gap-2">
      <p className="min-w-0 flex-1 truncate font-semibold text-slate-900">
        {customerName}
      </p>

    <div className="flex shrink-0 items-center gap-1.5">
  {conversation.is_pinned ? (
    <span
      className="text-blue-600"
      title="Pinned conversation"
    >
      📌
      <PinIcon />
    </span>
  ) : null}

  <span className="text-xs text-slate-400">
    {mounted
      ? formatMessageTime(
          conversation.last_message_at,
        )
      : formatStableMessageTime(
          conversation.last_message_at,
        )}
  </span>
</div>
    </div>

    {/* Row 2: last message */}
    <div className="mt-1 flex min-w-0 items-center gap-1.5">
      <MessagePreviewIcon
        type={
          conversation.latest_message_type
        }
      />

      <p className="min-w-0 flex-1 truncate text-sm text-slate-500">
        {messagePreview}
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

    {/* Row 3: assigned member */}
  {(
  assignedMemberName ||
  conversation.source_type ===
    "comment"
) ? (
  <div className="mt-1.5 flex min-w-0 items-center gap-3 text-xs text-slate-500">

    {assignedMemberName ? (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="8"
            r="3"
          />

          <path
            d="M6 20a6 6 0 0 1 12 0"
            strokeLinecap="round"
          />
        </svg>

        <span
          className="max-w-[100px] truncate font-medium text-slate-600"
          title={
            assignedMemberName
          }
        >
          {assignedMemberName}
        </span>
      </span>
    ) : null}

    {conversation.source_type ===
    "comment" ? (
      <span className="inline-flex items-center gap-1 font-medium text-violet-600">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path
            d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        Comment
      </span>
    ) : null}

  </div>
) : null}

    {/* Row 4: customer tags */}
    {(conversation.contact?.tags
      ?.length ??
      0) > 0 ? (
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {(conversation.contact
          ?.tags ??
          [])
          .slice(0, 2)
          .map((tag) => (
            <span
  key={tag.id}
  className="max-w-32 truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold shadow-sm"
  style={{
    color: tag.color,
    borderColor: `${tag.color}33`,
    backgroundColor: `${tag.color}14`,
  }}
  title={tag.name}
>
  {tag.name}
</span>
          ))}

        {(conversation.contact?.tags
          ?.length ??
          0) > 2 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            +
            {(conversation.contact
              ?.tags?.length ??
              0) - 2}
          </span>
        ) : null}
      </div>
    ) : null}
  </div>
</Link>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}