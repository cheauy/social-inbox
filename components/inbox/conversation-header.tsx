"use client";

import { useState } from "react";

import {
  getInitial,
  getStatusClasses,
  getStatusLabel,
  statusOptions,
} from "@/components/inbox/inbox-utils";

import type {
  ConversationStatus,
  InboxConversation,
  TeamMember,
} from "@/types/inbox";

type ConversationHeaderProps = {
  conversation: InboxConversation;
  teamMembers: TeamMember[];

  updatingStatus: boolean;
  assigning: boolean;
  markingUnread: boolean;

  customerPanelVisible: boolean;

  onStatusChange: (
    status: ConversationStatus,
  ) => void;

  onAssignmentChange: (
    memberId: string,
  ) => void;

  onTogglePin: () => void;
  onMarkUnread: () => void;
  onOpenHistory: () => void;
  onToggleCustomerPanel: () => void;
};

function UsersIcon() {
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
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        strokeLinecap="round"
      />

      <circle
        cx="9"
        cy="7"
        r="4"
      />

      <path
        d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PinIcon({
  filled = false,
}: {
  filled?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M14 3l7 7-3 1-4 4-1 5-3-3-5 3 3-5 4-4 1-3 1-5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
      />

      <path
        d="m3 7 9 6 9-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="18.5"
        cy="5.5"
        r="3.5"
        fill="#2563EB"
        stroke="white"
      />
    </svg>
  );
}

function HistoryIcon() {
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
        d="M3 12a9 9 0 1 0 3-6.7"
        strokeLinecap="round"
      />

      <path
        d="M3 4v6h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M12 7v5l3 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelIcon({
  hidden,
}: {
  hidden: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
      />

      <path d="M15 4v16" />

      {hidden ? (
        <path
          d="m8 9 3 3-3 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="m11 9-3 3 3 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function ConversationHeader({
  conversation,
  teamMembers,
  updatingStatus,
  assigning,
  markingUnread,
  customerPanelVisible,
  onTogglePin,
  onStatusChange,
  onAssignmentChange,
  onMarkUnread,
  onOpenHistory,
  onToggleCustomerPanel,
  
}: ConversationHeaderProps) {
  const [assignmentOpen, setAssignmentOpen] =
    useState(false);

  const contact = conversation.contact;

  const customerName =
    contact?.full_name ??
    "Facebook customer";

  const seenByName =
    conversation.seen_by_member?.full_name ??
    null;


const validTeamMembers = Array.from(
  new Map(
    teamMembers
      .filter(
        (member) =>
          Boolean(member.id) &&
          Boolean(member.full_name?.trim()),
      )
      .map((member) => [
        member.id,
        member,
      ]),
  ).values(),
);


  return (
    <header className="relative shrink-0 border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        {/* Customer */}
        <div className="flex min-w-0 items-center gap-3">
          {contact?.profile_picture_url ? (
            <img
              src={contact.profile_picture_url}
              alt=""
              className="h-11 w-11 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
              {getInitial(customerName)}
            </div>
          )}

          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">
              {customerName}
            </p>

            <p className="truncate text-xs text-slate-500">
              {seenByName
                ? `Seen by ${seenByName}`
                : "Not seen by a team member yet"}
            </p>
          </div>
        </div>
                
        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Assign user */}
          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setAssignmentOpen(
                  (current) => !current,
                )
              }
              disabled={assigning}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                assignmentOpen
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
              title="Assign user"
              aria-label="Assign user"
            >
              <UsersIcon />
            </button>

            {assignmentOpen ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setAssignmentOpen(false)
                  }
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close assignment menu"
                />

                <div className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="border-b border-slate-200 px-4 py-3">
                    <p className="font-semibold text-slate-900">
                      Assign conversation
                    </p>
                  </div>

                  <div className="max-h-72 overflow-y-auto p-2">
  {/* Only one Unassigned option */}
  <button
    type="button"
    onClick={() => {
      onAssignmentChange("unassigned");
      setAssignmentOpen(false);
    }}
    disabled={assigning}
    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
      !conversation.assigned_to
        ? "bg-emerald-50"
        : "hover:bg-slate-50"
    }`}
  >
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
      —
    </div>

    <span className="min-w-0 flex-1 text-sm font-medium text-slate-700">
      Unassigned
    </span>

    {!conversation.assigned_to ? (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        className="h-5 w-5 shrink-0 text-emerald-600"
        aria-hidden="true"
      >
        <path
          d="M5 13l4 4L19 7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : null}
  </button>

  {validTeamMembers.length > 0 ? (
    <div className="my-2 border-t border-slate-100" />
  ) : null}

  {validTeamMembers.map((member) => {
    const isSelected =
      conversation.assigned_to === member.id;

    return (
      <button
        key={member.id}
        type="button"
        onClick={() => {
          onAssignmentChange(member.id);
          setAssignmentOpen(false);
        }}
        disabled={assigning}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
          isSelected
            ? "bg-emerald-50"
            : "hover:bg-slate-50"
        } disabled:cursor-wait disabled:opacity-60`}
      >
        {member.profile_picture_url ? (
          <img
            src={member.profile_picture_url}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
            {getInitial(member.full_name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800">
            {member.full_name}
          </p>

          <p className="truncate text-xs text-slate-500">
            {member.role}
          </p>
        </div>

        {isSelected ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden="true"
          >
            <path
              d="M5 13l4 4L19 7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
    );
  })}

  {validTeamMembers.length === 0 ? (
    <p className="px-3 py-5 text-center text-sm text-slate-500">
      No team members available.
    </p>
  ) : null}
</div>
                </div>
              </>
            ) : null}
          </div>

   <button
  type="button"
  onClick={onTogglePin}
  className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
    conversation.is_pinned
      ? "border-amber-300 bg-amber-50 text-amber-600"
      : "border-slate-300 text-slate-600 hover:bg-slate-50"
  }`}
  title={
    conversation.is_pinned
      ? "Unpin conversation"
      : "Pin conversation"
  }
  aria-label={
    conversation.is_pinned
      ? "Unpin conversation"
      : "Pin conversation"
  }
>
  <PinIcon
    filled={conversation.is_pinned}
  />
</button>
          
          {/* Mark unread */}
          <button
            type="button"
            onClick={onMarkUnread}
            disabled={markingUnread}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
            title="Mark as unread"
            aria-label="Mark as unread"
          >
            <UnreadIcon />
          </button>

          {/* Status */}
          <div className="flex items-center gap-2">
            

            <select
              value={conversation.status}
              onChange={(event) =>
                onStatusChange(
                  event.target
                    .value as ConversationStatus,
                )
              }
              disabled={updatingStatus}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait"
              aria-label="Change conversation status"
            >
              {statusOptions.map(
                (status) => (
                  <option
                    key={status.value}
                    value={status.value}
                  >
                    {status.label}
                  </option>
                ),
              )}
            </select>
          </div>

          <div className="mx-1 h-6 w-px bg-slate-200" />

          {/* History */}
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition hover:bg-slate-50"
            title="Customer history"
            aria-label="Customer history"
          >
            <HistoryIcon />
          </button>

          {/* Hide/show right panel */}
          <button
            type="button"
            onClick={onToggleCustomerPanel}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              customerPanelVisible
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
            title={
              customerPanelVisible
                ? "Hide customer information"
                : "Show customer information"
            }
            aria-label={
              customerPanelVisible
                ? "Hide customer information"
                : "Show customer information"
            }
          >
            <PanelIcon
              hidden={!customerPanelVisible}
            />
          </button>
        </div>
            
     
      </div>
    </header>
  );
}