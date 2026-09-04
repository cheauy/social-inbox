"use client";

import { useEffect, useState } from "react";
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";
import { createClient } from "@/lib/supabase/client";

import {
  getInitial,
  statusOptions,
} from "@/components/inbox/inbox-utils";

import type {
  ConversationStatus,
  InboxConversation,
  TeamMember,
} from "@/types/inbox";

import type {
  AgentPresence,
  AgentPresenceStatus,
  TeamAgentPresence,
} from "@/lib/inbox/use-agent-presence";

type ConversationHeaderProps = {
  conversation: InboxConversation;
  teamMembers: TeamMember[];
  viewingAgents: AgentPresence[];
  typingAgents: AgentPresence[];
  teamPresence: TeamAgentPresence[];
  agentPresenceStatus: AgentPresenceStatus;
  updatingStatus: boolean;
  assigning: boolean;
  markingUnread: boolean;
  customerPanelVisible: boolean;
  channelPlatform: "messenger" | "telegram";
  channelAccountName: string;
  onStatusChange: (status: ConversationStatus) => void;
  onAssignmentChange: (memberId: string) => void;
  onMarkUnread: () => void;
  onOpenHistory: () => void;
  onToggleCustomerPanel: () => void;
  onTogglePin: () => void;
};

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path
        d="M9 4h6"
        strokeLinecap="round"
      />
      <path
        d="M10 4 9.25 9.7 7 12v1.5h10V12l-2.25-2.3L14 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 13.5V21"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UnreadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18.5" cy="5.5" r="3.5" fill="#2563EB" stroke="white" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" />
      <path d="M3 4v6h6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PanelIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
      {hidden ? (
        <path d="m8 9 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m11 9-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[15px] w-[15px]" aria-hidden="true">
      <path d="M4 10v9h16v-9" strokeLinecap="round" />
      <path d="M3 10l2-5h14l2 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 19v-5h8v5" strokeLinecap="round" />
      <path d="M3 10c0 1.2 1 2 2.2 2 1.1 0 1.8-.5 2.3-1.3.5.8 1.2 1.3 2.3 1.3s1.8-.5 2.3-1.3c.5.8 1.2 1.3 2.3 1.3s1.8-.5 2.3-1.3c.5.8 1.2 1.3 2.3 1.3 1.2 0 2.2-.8 2.2-2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function resolveConnectionColor(conversation: InboxConversation) {
  const extended = conversation as InboxConversation & {
    connection_color?: string | null;
    channel_color?: string | null;
    ui_color?: string | null;
    social_account?:
      | (InboxConversation["social_account"] & {
          color?: string | null;
          connection_color?: string | null;
          channel_color?: string | null;
          ui_color?: string | null;
        })
      | null;
  };

  const candidates = [
    extended.connection_color,
    extended.channel_color,
    extended.ui_color,
    extended.social_account?.connection_color,
    extended.social_account?.channel_color,
    extended.social_account?.ui_color,
    extended.social_account?.color,
  ];

  const supplied = candidates.find(
    (value): value is string =>
      typeof value === "string" &&
      /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value.trim()),
  );

  if (supplied) {
    return supplied.trim().toUpperCase();
  }

  const source =
    conversation.social_account?.id ||
    conversation.social_account?.account_name ||
    conversation.id;

  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  const r = 72 + (hash & 0x7f);
  const g = 72 + ((hash >>> 8) & 0x7f);
  const b = 72 + ((hash >>> 16) & 0x7f);

  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}D1`.toUpperCase();
}

const actionButtonBase =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white shadow-[0_4px_12px_rgba(15,23,42,0.07)] transition disabled:cursor-wait disabled:opacity-50";

export function ConversationHeader({
  conversation,
  teamMembers,
  viewingAgents,
  typingAgents,
  teamPresence,
  agentPresenceStatus,
  updatingStatus,
  assigning,
  markingUnread,
  customerPanelVisible,
  channelPlatform,
  channelAccountName,
  onStatusChange,
  onAssignmentChange,
  onMarkUnread,
  onOpenHistory,
  onToggleCustomerPanel,
  onTogglePin,
}: ConversationHeaderProps) {
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadCurrentUserEmail() {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();

        if (alive) {
          setCurrentUserEmail(
            (data.user?.email ?? "").trim().toLowerCase(),
          );
        }
      } catch {
        if (alive) {
          setCurrentUserEmail("");
        }
      }
    }

    void loadCurrentUserEmail();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setPresenceOpen(false);
  }, [conversation.id]);

  const isKhmer = useWorkspaceLanguageId() === "km";

  const statusLabel = (value: ConversationStatus, english: string) => {
    if (!isKhmer) return english;

    return ({
      open: "បើក",
      pending: "កំពុងរង់ចាំ",
      resolved: "បានដោះស្រាយ",
      closed: "បានបិទ",
      spam: "សារឥតបានការ",
    } as Record<ConversationStatus, string>)[value];
  };

  const customerName =
    conversation.contact?.full_name?.trim() || "Customer";

  const isPinned = Boolean(conversation.is_pinned);
  const connectionColor = resolveConnectionColor(conversation);

  const validTeamMembers = Array.from(
    new Map(
      teamMembers
        .filter((member) => {
          const sameWorkspace =
            !member.business_id ||
            member.business_id === conversation.business_id;
          const normalizedEmail =
            member.email?.trim().toLowerCase() ?? "";
          const isCurrentUser =
            Boolean(currentUserEmail) &&
            normalizedEmail === currentUserEmail;
          const isAssignableTeamMember =
            member.role?.trim().toLowerCase() !== "owner" ||
            isCurrentUser;

          return (
            sameWorkspace &&
            isAssignableTeamMember &&
            Boolean(member.id) &&
            Boolean(member.full_name?.trim())
          );
        })
        .map((member) => [member.id, member]),
    ).values(),
  );

  const typingUserIds = new Set(
    typingAgents.map((agent) => agent.user_id),
  );

  const presenceAgents = Array.from(
    new Map(
      viewingAgents.map((agent) => [agent.user_id, agent]),
    ).values(),
  );

  const visiblePresenceAgents = presenceAgents.slice(0, 3);
  const hiddenPresenceCount = Math.max(0, presenceAgents.length - 3);
  const teamPresenceByMemberId = new Map(
    teamPresence.map((presence) => [presence.member_id, presence]),
  );

  const getAvailabilityLabel = (
    status: TeamAgentPresence["status"] | "online" | "away",
  ) => {
    if (status === "away") {
      return isKhmer ? "អវត្តមាន" : "Away";
    }

    if (status === "offline") {
      return isKhmer ? "ក្រៅបណ្តាញ" : "Offline";
    }

    return isKhmer ? "អនឡាញ" : "Online";
  };

  return (
    <header className="relative z-30 w-full shrink-0 bg-white">
      <div className="flex min-h-[82px] w-full items-center justify-between gap-4 border-b border-slate-200/90 bg-white px-5 py-2.5 shadow-[0_5px_18px_rgba(15,23,42,0.055)]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-bold leading-tight tracking-[-0.02em] text-slate-950">
            {customerName}
          </p>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] font-medium text-slate-500">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[#536B89]">
              <StoreIcon />
              <span className="max-w-[220px] truncate">{channelAccountName}</span>
            </span>

            <span className="text-slate-300">·</span>

            <span className="inline-flex items-center gap-1.5 font-semibold text-[#4E607B]">
              <span
                className="h-2 w-2 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.95)]"
                style={{ backgroundColor: connectionColor.slice(0, 7) }}
                aria-hidden="true"
              />
              <span>{connectionColor}</span>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 overflow-visible">
          {presenceAgents.length > 0 ? (
            <div className="relative mr-1">
              <button
                type="button"
                onClick={() => setPresenceOpen((current) => !current)}
                className="group flex h-10 items-center rounded-xl px-1.5 transition hover:bg-slate-50"
                aria-label={isKhmer ? "សមាជិកក្រុមនៅក្នុងការសន្ទនានេះ" : "Team members on this conversation"}
                aria-expanded={presenceOpen}
                title={agentPresenceStatus === "connected" ? "Live team presence" : "Team presence is reconnecting"}
              >
                <span className="flex -space-x-2">
                  {visiblePresenceAgents.map((agent) => (
                    <span
                      key={agent.user_id}
                      className={`relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 text-[10px] font-bold shadow-sm ${
                        agent.availability === "away"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-white " +
                            (typingUserIds.has(agent.user_id)
                              ? "bg-blue-500 text-white"
                              : "bg-slate-100 text-slate-700")
                      }`}
                      title={`${agent.name} · ${
                        typingUserIds.has(agent.user_id)
                          ? "Typing"
                          : agent.availability === "away"
                            ? "Away"
                            : "Viewing"
                      }`}
                    >
                      {agent.profile_picture_url ? (
                        <img
                          src={agent.profile_picture_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitial(agent.name)
                      )}
                    </span>
                  ))}

                  {hiddenPresenceCount > 0 ? (
                    <span className="relative flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-white bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600 shadow-sm">
                      +{hiddenPresenceCount}
                    </span>
                  ) : null}
                </span>
              </button>

              {presenceOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setPresenceOpen(false)}
                    aria-label={isKhmer ? "បិទបញ្ជីសមាជិកក្រុម" : "Close team presence list"}
                  />

                  <div className="absolute right-0 top-[46px] z-50 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
                    <div className="border-b border-slate-100 px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                        {isKhmer ? "នៅក្នុងការសន្ទនានេះ" : "On this conversation"}
                      </p>
                    </div>

                    <div className="max-h-72 overflow-y-auto p-2">
                      {presenceAgents.map((agent) => {
                        const isTyping = typingUserIds.has(agent.user_id);
                        const isAway = agent.availability === "away";

                        return (
                          <div
                            key={agent.user_id}
                            className="flex items-center gap-3 rounded-xl px-2.5 py-2"
                          >
                            {agent.profile_picture_url ? (
                              <img
                                src={agent.profile_picture_url}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                                isTyping
                                  ? "bg-blue-500 text-white"
                                  : "bg-slate-100 text-slate-700"
                              }`}>
                                {getInitial(agent.name)}
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">
                                {agent.name}
                              </p>
                              <p className={`truncate text-xs ${isTyping ? "text-emerald-600" : "text-slate-400"}`}>
                                {isTyping
                                  ? (isKhmer ? "កំពុងវាយសារឆ្លើយតប" : "Typing a reply")
                                  : isAway
                                    ? getAvailabilityLabel("away")
                                    : (isKhmer ? "កំពុងមើល · អនឡាញ" : "Viewing · Online")}
                              </p>
                            </div>

                            <span className={`h-2 w-2 shrink-0 rounded-full ${
                              isTyping
                                ? "bg-emerald-500"
                                : isAway
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
                            }`} aria-hidden="true" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="relative">
            <button
              type="button"
              onClick={() => setAssignmentOpen((current) => !current)}
              disabled={assigning}
              className={`${actionButtonBase} ${assignmentOpen ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-[#536B89] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"}`}
              title={isKhmer ? "ចាត់តាំងការសន្ទនា" : "Assign conversation"}
              aria-label={isKhmer ? "ចាត់តាំងការសន្ទនា" : "Assign conversation"}
              aria-expanded={assignmentOpen}
            >
              <UsersIcon />
            </button>

            {assignmentOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setAssignmentOpen(false)}
                  aria-label={isKhmer ? "បិទម៉ឺនុយចាត់តាំង" : "Close assignment menu"}
                />

                <div className="absolute right-0 top-[48px] z-50 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <p className="font-semibold text-slate-900">{isKhmer ? "ចាត់តាំងការសន្ទនា" : "Assign conversation"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{isKhmer ? "ជ្រើសរើសសមាជិកក្រុម" : "Choose a team member"}</p>
                  </div>

                  <div className="max-h-72 overflow-y-auto p-2">
                    <button
                      type="button"
                      disabled={assigning}
                      onClick={() => {
                        onAssignmentChange("unassigned");
                        setAssignmentOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${!conversation.assigned_to ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm text-slate-500">—</div>
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-700">{isKhmer ? "មិនទាន់ចាត់តាំង" : "Unassigned"}</span>
                      {!conversation.assigned_to ? <span className="text-sm font-bold text-blue-600">✓</span> : null}
                    </button>

                    {validTeamMembers.length > 0 ? <div className="my-2 border-t border-slate-100" /> : null}

                    {validTeamMembers.map((member) => {
                      const selected = conversation.assigned_to === member.id;
                      const memberPresence =
                        teamPresenceByMemberId.get(member.id);
                      const memberAvailability =
                        memberPresence?.status ?? "offline";
                      const presenceSyncing =
                        agentPresenceStatus !== "connected" &&
                        memberAvailability === "offline";

                      return (
                        <button
                          key={member.id}
                          type="button"
                          disabled={assigning}
                          onClick={() => {
                            onAssignmentChange(member.id);
                            setAssignmentOpen(false);
                          }}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? "bg-blue-50" : "hover:bg-slate-50"} disabled:cursor-wait disabled:opacity-60`}
                        >
                          {member.profile_picture_url ? (
                            <img src={member.profile_picture_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                              {getInitial(member.full_name)}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{member.full_name}</p>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                              <span className="truncate capitalize text-slate-500">{member.role}</span>
                              <span className="text-slate-300">·</span>
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  presenceSyncing
                                    ? "animate-pulse bg-blue-400"
                                    : memberAvailability === "online"
                                      ? "bg-emerald-500"
                                      : memberAvailability === "away"
                                        ? "bg-amber-400"
                                        : "bg-slate-300"
                                }`}
                                aria-hidden="true"
                              />
                              <span
                                className={`truncate ${
                                  presenceSyncing
                                    ? "text-blue-500"
                                    : memberAvailability === "online"
                                      ? "text-emerald-600"
                                      : memberAvailability === "away"
                                        ? "text-amber-600"
                                        : "text-slate-400"
                                }`}
                              >
                                {presenceSyncing
                                  ? (isKhmer ? "កំពុងភ្ជាប់" : "Syncing")
                                  : getAvailabilityLabel(memberAvailability)}
                              </span>
                            </div>
                          </div>

                          {selected ? <span className="text-sm font-bold text-blue-600">✓</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onTogglePin}
            className={`${actionButtonBase} ${isPinned ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 text-[#536B89] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"}`}
            title={isKhmer ? (isPinned ? "ដោះខ្ទាស់ការសន្ទនា" : "ខ្ទាស់ការសន្ទនា") : (isPinned ? "Unpin conversation" : "Pin conversation")}
            aria-label={isKhmer ? (isPinned ? "ដោះខ្ទាស់ការសន្ទនា" : "ខ្ទាស់ការសន្ទនា") : (isPinned ? "Unpin conversation" : "Pin conversation")}
            aria-pressed={isPinned}
          >
            <PinIcon />
          </button>

          <button
            type="button"
            onClick={onMarkUnread}
            disabled={markingUnread}
            className={`${actionButtonBase} border-slate-200 text-[#536B89] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800`}
            title={isKhmer ? "សម្គាល់ថាមិនទាន់អាន" : "Mark as unread"}
            aria-label={isKhmer ? "សម្គាល់ថាមិនទាន់អាន" : "Mark as unread"}
          >
            <UnreadIcon />
          </button>

          <div className="relative">
            <select
              value={conversation.status}
              onChange={(event) => onStatusChange(event.target.value as ConversationStatus)}
              disabled={updatingStatus}
              className="h-10 min-w-[128px] appearance-none rounded-xl border border-slate-200 bg-white pl-4 pr-9 text-[14px] font-medium capitalize text-slate-800 shadow-[0_4px_12px_rgba(15,23,42,0.07)] outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-50"
              aria-label={isKhmer ? "ប្តូរស្ថានភាពការសន្ទនា" : "Change conversation status"}
            >
              {statusOptions.map((status) => (
                <option key={status.value} value={status.value}>
                  {statusLabel(status.value, status.label)}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#536B89]">
              <ChevronDownIcon />
            </span>
          </div>

          <div className="mx-0.5 h-7 w-px bg-slate-200" aria-hidden="true" />

          <button
            type="button"
            onClick={onOpenHistory}
            className={`${actionButtonBase} border-slate-200 text-[#536B89] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800`}
            title={isKhmer ? "ប្រវត្តិអតិថិជន" : "Customer history"}
            aria-label={isKhmer ? "ប្រវត្តិអតិថិជន" : "Customer history"}
          >
            <HistoryIcon />
          </button>

          <button
            type="button"
            onClick={onToggleCustomerPanel}
            className={`${actionButtonBase} ${customerPanelVisible ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-[#536B89] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"}`}
            title={isKhmer ? (customerPanelVisible ? "លាក់ព័ត៌មានអតិថិជន" : "បង្ហាញព័ត៌មានអតិថិជន") : (customerPanelVisible ? "Hide customer information" : "Show customer information")}
            aria-label={isKhmer ? (customerPanelVisible ? "លាក់ព័ត៌មានអតិថិជន" : "បង្ហាញព័ត៌មានអតិថិជន") : (customerPanelVisible ? "Hide customer information" : "Show customer information")}
            aria-pressed={customerPanelVisible}
          >
            <PanelIcon hidden={!customerPanelVisible} />
          </button>
        </div>
      </div>
    </header>
  );
}
