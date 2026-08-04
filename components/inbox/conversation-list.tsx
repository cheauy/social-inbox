import Link from "next/link";

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
  { value: "all", label: "All" },
  ...statusOptions,
];

export function ConversationList({
  conversations,
  activeConversationId,
  activeStatus,
  statusCounts,
}: ConversationListProps) {
  return (
    <section className="border-r border-slate-200">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 p-4">
        {filterOptions.map((filter) => {
          const isActive = filter.value === activeStatus;
          const href =
            filter.value === "all"
              ? "/dashboard/inbox"
              : `/dashboard/inbox?status=${filter.value}`;

          return (
            <Link
              key={filter.value}
              href={href}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {filter.label} ({statusCounts[filter.value]})
            </Link>
          );
        })}
      </div>

      <div className="border-b border-slate-200 p-4">
        <input
          type="search"
          placeholder="Search conversations..."
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div>
        {conversations.length === 0 ? (
          <div className="p-8 text-center">
            <p className="font-medium text-slate-800">
              No conversations
            </p>

            <p className="mt-1 text-sm text-slate-500">
              No conversations match this status.
            </p>
          </div>
        ) : (
          conversations.map((conversation) => {
            const customerName =
              conversation.contact?.full_name ??
              "Facebook customer";

            const isActive =
              conversation.id === activeConversationId;

            const query = new URLSearchParams();
            query.set("conversation", conversation.id);

            if (activeStatus !== "all") {
              query.set("status", activeStatus);
            }

            return (
              <Link
                key={conversation.id}
                href={`/dashboard/inbox?${query.toString()}`}
                className={`flex gap-3 border-b border-slate-100 p-4 transition ${
                  isActive
                    ? "bg-blue-50"
                    : "hover:bg-slate-50"
                }`}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                  {getInitial(customerName)}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
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

                    {conversation.unread_count > 0 ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                        {conversation.unread_count}
                      </span>
                    ) : null}
                  </div>

                  <span
                    className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(
                      conversation.status,
                    )}`}
                  >
                    {getStatusLabel(
                      conversation.status,
                    )}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
