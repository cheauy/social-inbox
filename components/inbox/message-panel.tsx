"use client";

import type { FormEvent } from "react";

import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  TeamMember,
} from "@/types/inbox";
import {
  formatMessageTime,
  getStatusClasses,
  getStatusLabel,
  statusOptions,
} from "@/components/inbox/inbox-utils";
import { ReplyBox } from "@/components/inbox/reply-box";

type MessagePanelProps = {
  activeConversation: InboxConversation | null;
  messages: InboxMessage[];
  teamMembers: TeamMember[];
  reply: string;
  sending: boolean;
  sendError: string | null;
  updatingStatus: boolean;
  statusError: string | null;
  assigning: boolean;
  assignmentError: string | null;
  onReplyChange: (value: string) => void;
  onSendMessage: (
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onStatusChange: (
    status: ConversationStatus,
  ) => void;
  onAssignmentChange: (assignedTo: string) => void;
};

export function MessagePanel({
  activeConversation,
  messages,
  teamMembers,
  reply,
  sending,
  sendError,
  updatingStatus,
  statusError,
  assigning,
  assignmentError,
  onReplyChange,
  onSendMessage,
  onStatusChange,
  onAssignmentChange,
}: MessagePanelProps) {
  if (!activeConversation) {
    return (
      <section className="flex flex-col">
        <div className="flex flex-1 items-center justify-center bg-slate-50 p-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl">
              💬
            </div>

            <p className="mt-4 font-semibold text-slate-900">
              Select a conversation
            </p>

            <p className="mt-1 text-sm text-slate-500">
              Choose a customer from the inbox.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-900">
            {activeConversation.contact?.full_name ??
              "Facebook customer"}
          </p>

          <p className="text-sm text-slate-500">
            Facebook Messenger ·{" "}
            {activeConversation.social_account
              ?.account_name ?? "Facebook Page"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(
              activeConversation.status,
            )}`}
          >
            {getStatusLabel(activeConversation.status)}
          </span>

          <select
            value={activeConversation.status}
            onChange={(event) =>
              onStatusChange(
                event.target.value as ConversationStatus,
              )
            }
            disabled={updatingStatus}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:bg-slate-100"
          >
            {statusOptions.map((status) => (
              <option
                key={status.value}
                value={status.value}
              >
                {status.label}
              </option>
            ))}
          </select>

          <select
            value={
              activeConversation.assigned_to ??
              "unassigned"
            }
            onChange={(event) =>
              onAssignmentChange(event.target.value)
            }
            disabled={assigning}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:bg-slate-100"
            aria-label="Assign conversation"
          >
            <option value="unassigned">
              Unassigned
            </option>

            {teamMembers.map((member) => (
              <option
                key={member.id}
                value={member.id}
              >
                {member.full_name} — {member.role}
              </option>
            ))}
          </select>

          {assigning ? (
            <span className="text-xs text-slate-500">
              Saving assignment...
            </span>
          ) : null}
        </div>

        {statusError ? (
          <p className="text-sm text-red-600 sm:basis-full">
            {statusError}
          </p>
        ) : null}

        {assignmentError ? (
          <p className="text-sm text-red-600 sm:basis-full">
            {assignmentError}
          </p>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-6">
        {messages.map((message) => {
          const isOutgoing =
            message.direction === "outgoing";

          return (
            <div
              key={message.id}
              className={`flex ${
                isOutgoing
                  ? "justify-end"
                  : "justify-start"
              }`}
            >
              <div
                className={`max-w-md rounded-2xl px-4 py-3 text-sm shadow-sm ${
                  isOutgoing
                    ? "rounded-br-md bg-blue-600 text-white"
                    : "rounded-bl-md bg-white text-slate-800"
                }`}
              >
                <p>
                  {message.message_text ??
                    "Unsupported message"}
                </p>

                <p
                  className={`mt-1 text-xs ${
                    isOutgoing
                      ? "text-blue-100"
                      : "text-slate-400"
                  }`}
                >
                  {formatMessageTime(
                    message.platform_created_at ??
                      message.created_at,
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <ReplyBox
        reply={reply}
        sending={sending}
        error={sendError}
        onReplyChange={onReplyChange}
        onSubmit={onSendMessage}
      />
    </section>
  );
}
