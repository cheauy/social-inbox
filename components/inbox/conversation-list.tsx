"use client";

import Link from "next/link";
import { useState } from "react";

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

export function ConversationList({
  conversations,
  activeConversationId,
  activeStatus,
  statusCounts,
}: ConversationListProps) {
  const [filterOpen, setFilterOpen] =
    useState(false);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
      <div className="relative shrink-0 border-b border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5"
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
              placeholder="Search conversations..."
              className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <button
            type="button"
            onClick={() =>
              setFilterOpen((current) => !current)
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
                {filterOptions.map((filter) => {
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
                })}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium text-slate-800">
              No conversations
            </p>

            <p className="mt-1 text-sm text-slate-500">
              No conversations match this
              filter.
            </p>
          </div>
        ) : (
          conversations.map((conversation) => {
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

            if (activeStatus !== "all") {
              query.set(
                "status",
                activeStatus,
              );
            }

            return (
              <Link
                key={conversation.id}
                href={`/dashboard/inbox?${query.toString()}`}
                className={`flex gap-3 border-b border-slate-100 p-3 transition ${
                  isActive
                    ? "bg-blue-100"
                    : "hover:bg-slate-50"
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                  {getInitial(customerName)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-slate-900">
                      {customerName}
                    </p>

                    <span className="shrink-0 text-xs text-slate-400">
                      {formatMessageTime(
                        conversation.last_message_at,
                      )}
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm text-slate-500">
                      {conversation.last_message_text ??
                        "No messages"}
                    </p>

                    {conversation.unread_count >
                    0 ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                        {
                          conversation.unread_count
                        }
                      </span>
                    ) : null}
                  </div>

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
                          .contact?.tags
                          ?.length ?? 0) - 2}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}