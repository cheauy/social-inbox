"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { WorkspaceContextSwitcher } from "@/components/subscription/workspace-context-switcher";

type Tab = "users" | "channels";

type Member = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  profile_picture_url: string | null;
  created_at?: string | null;
};

type Connection = {
  id: string;
  platform: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean;
  facebook_token_status: string | null;
};

type UsageResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  businessId?: string;
  currentMemberId?: string;
  currentMemberRole?: string;
  canManage?: boolean;
  canManageMembers?: boolean;
  canManageChannels?: boolean;
  subscription?: {
    id: string;
    business_id: string;
    plan_code: string;
    status: string;
    member_limit: number;
    channel_limit: number;
  } | null;
  usage?: {
    members: number;
    channels: number;
  };
  members?: Member[];
  connections?: Connection[];
  message?: string;
};

type PendingInvitation = {
  id: string;
  business_id: string;
  subscription_id: string;
  email: string;
  role: "agent" | "owner";
  status: "pending";
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type InvitationsResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  invitationUrl?: string;
  invitations?: PendingInvitation[];
  invitation?: PendingInvitation;
};

async function readResult(response: Response): Promise<UsageResponse> {
  const text = await response.text();

  if (!text.trim()) {
    return {
      success: false,
      error: `Server returned an empty response (HTTP ${response.status}).`,
    };
  }

  try {
    return JSON.parse(text) as UsageResponse;
  } catch {
    return {
      success: false,
      error: `Server returned invalid JSON (HTTP ${response.status}).`,
    };
  }
}

function shortSubscriptionId(value: string | null | undefined) {
  const id = value?.trim();
  return id ? `#${id.slice(0, 8).toUpperCase()}` : "Unknown subscription";
}

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "T";
}

function channelIcon(platform: string) {
  if (platform === "facebook") return "/images/channels/messenger.png";
  if (platform === "telegram") return "/images/channels/telegram.png";
  if (platform === "instagram") return "/images/channels/instagram.png";
  if (platform === "whatsapp") return "/images/channels/whatsapp.png";
  if (platform === "tiktok") return "/images/channels/tiktok.png";
  return null;
}

function platformLabel(platform: string) {
  if (platform === "facebook") return "Messenger";
  if (platform === "telegram") return "Telegram";
  if (platform === "instagram") return "Instagram";
  if (platform === "whatsapp") return "WhatsApp";
  if (platform === "tiktok") return "TikTok";
  return platform;
}

function RoleBadge({ role }: { role: string }) {
  const normalized = role.toLowerCase();
  const label =
    normalized === "owner"
      ? "Owner"
      : normalized === "admin"
        ? "Admin"
        : normalized === "agent"
          ? "Agent"
          : role;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
        normalized === "owner"
          ? "bg-blue-100 text-blue-700"
          : "bg-slate-100 text-slate-600"
      }`}
    >
      {label}
    </span>
  );
}

export function UserPermissionsManager({ initialTab = "users" }: { initialTab?: Tab }) {
  const workspaceLanguageId = useWorkspaceLanguageId();
  const isKhmer = workspaceLanguageId === "km";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [invitations, setInvitations] =
    useState<PendingInvitation[]>([]);
  const [inviteOpen, setInviteOpen] =
    useState(false);
  const [inviteEmail, setInviteEmail] =
    useState("");
  const [inviteRole, setInviteRole] =
    useState<"agent" | "owner">("agent");
  const [inviteWorking, setInviteWorking] =
    useState<string | null>(null);
  const [localInviteUrl, setLocalInviteUrl] =
    useState<string | null>(null);
  const [peopleSearch, setPeopleSearch] =
    useState("");
  const [peopleRole, setPeopleRole] =
    useState<"all" | "owner" | "member" | "invited">("all");
  const [actionMenu, setActionMenu] = useState<{
    memberId: string;
    top: number;
    left: number;
  } | null>(null);

  const loadInvitations = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/team/invitations",
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result =
        (await response.json()) as InvitationsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to load pending invitations.",
        );
      }

      setInvitations(result.invitations ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load pending invitations.",
      );
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subscription/usage-management", {
        method: "GET",
        cache: "no-store",
      });
      const result = await readResult(response);

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to load workspace permissions.");
      }

      setData(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadInvitations();
  }, [load, loadInvitations]);

  useEffect(() => {
    if (!actionMenu) return;

    const closeMenu = () => setActionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMenu]);

  const members = data?.members ?? [];
  const connections = data?.connections ?? [];
  const usage = data?.usage ?? { members: 0, channels: 0 };
  const subscription = data?.subscription;
  const businessId = data?.businessId ?? "";
  const subscriptionId = subscription?.id ?? "";
  const subscriptionLabel = shortSubscriptionId(subscriptionId);
  const hasSafeMutationContext = Boolean(businessId && subscriptionId);
  const canManageMembers =
    data?.canManageMembers === true && hasSafeMutationContext;
  const canManageChannels =
    data?.canManageChannels === true && hasSafeMutationContext;
  const currentMemberId = data?.currentMemberId ?? "";
  const currentMemberRole = data?.currentMemberRole ?? "";
  const currentUserIsOwner = currentMemberRole === "owner";
  const memberLimit = subscription?.member_limit ?? null;
  const channelLimit = subscription?.channel_limit ?? null;

  const normalizedPeopleSearch =
    peopleSearch.trim().toLowerCase();

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      !normalizedPeopleSearch ||
      member.full_name.toLowerCase().includes(normalizedPeopleSearch) ||
      (member.email ?? "").toLowerCase().includes(normalizedPeopleSearch);

    const matchesRole =
      peopleRole === "all" ||
      (peopleRole === "owner" && member.role === "owner") ||
      (peopleRole === "member" && member.role !== "owner");

    return matchesSearch && matchesRole;
  });

  const filteredInvitations = invitations.filter((invitation) => {
    const matchesSearch =
      !normalizedPeopleSearch ||
      invitation.email.toLowerCase().includes(normalizedPeopleSearch);

    const matchesRole =
      peopleRole === "all" ||
      peopleRole === "invited" ||
      (peopleRole === "owner" && invitation.role === "owner") ||
      (peopleRole === "member" && invitation.role !== "owner");

    return matchesSearch && matchesRole;
  });

  function formatAddedDate(value: string | null | undefined) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return (
      date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }) +
      " · " +
      date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    );
  }

  const groups = useMemo(() => {
    return [
      {
        key: "owners",
        label: "Owners",
        description: "Full subscription and workspace control",
        members: members.filter(
          (member) => member.is_active && member.role === "owner",
        ),
        groupPermissions: [true, true, true, true, true, true],
      },
      {
        key: "members",
        label: "Team members",
        description: "Active workspace access",
        members: members.filter(
          (member) => member.is_active && member.role !== "owner",
        ),
        groupPermissions: [true, true, false, false, false, false],
      },
      {
        key: "inactive",
        label: "No access",
        description: "History is kept; this subscription is blocked",
        members: members.filter((member) => !member.is_active),
        groupPermissions: [false, false, false, false, false, false],
      },
    ];
  }, [members]);

  async function patch(
    body:
      | { kind: "member"; id: string; active: boolean }
      | { kind: "member-role"; id: string; role: "owner" | "admin" }
      | { kind: "connection"; id: string; active: boolean },
  ) {
    setSavingId(body.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/subscription/usage-management", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          businessId,
          subscriptionId,
        }),
      });
      const result = await readResult(response);

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to update workspace permissions.");
      }

      setData(result);
      setNotice(result.message ?? "Workspace permissions updated.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update workspace permissions.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function sendInvitation() {
    const email = inviteEmail.trim().toLowerCase();

    if (!canManageMembers || !email || inviteWorking) {
      return;
    }

    setInviteWorking("create");
    setError(null);
    setNotice(null);
    setLocalInviteUrl(null);

    try {
      const response = await fetch(
        "/api/team/invitations",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            role: inviteRole,
          }),
        },
      );

      const result =
        (await response.json()) as InvitationsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to send invitation.",
        );
      }

      setInviteEmail("");
      setInviteOpen(false);
      setNotice(
        result.message ??
          `Invitation sent to ${email}.`,
      );
      setLocalInviteUrl(
        result.invitationUrl ?? null,
      );

      await Promise.all([
        load(),
        loadInvitations(),
      ]);
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : "Unable to send invitation.",
      );
    } finally {
      setInviteWorking(null);
    }
  }

  async function manageInvitation(
    invitation: PendingInvitation,
    action: "resend" | "cancel",
  ) {
    if (!canManageMembers || inviteWorking) {
      return;
    }

    if (
      action === "cancel" &&
      !window.confirm(
        `Cancel the invitation for ${invitation.email}? Its reserved user seat will become available.`,
      )
    ) {
      return;
    }

    setInviteWorking(invitation.id);
    setError(null);
    setNotice(null);
    setLocalInviteUrl(null);

    try {
      const response = await fetch(
        `/api/team/invitations/${encodeURIComponent(invitation.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
          }),
        },
      );

      const result =
        (await response.json()) as InvitationsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to update invitation.",
        );
      }

      setNotice(
        result.message ??
          "Invitation updated.",
      );
      setLocalInviteUrl(
        result.invitationUrl ?? null,
      );

      await Promise.all([
        load(),
        loadInvitations(),
      ]);
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : "Unable to update invitation.",
      );
    } finally {
      setInviteWorking(null);
    }
  }

  function changeTab(nextTab: Tab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function toggleAccess(member: Member) {
    if (
      !canManageMembers ||
      member.id === currentMemberId ||
      savingId ||
      (!currentUserIsOwner && member.role === "owner")
    ) return;

    const nextActive = !member.is_active;
    const confirmed = window.confirm(
      nextActive
        ? `Restore ${member.full_name}'s access to ${subscriptionLabel}? This will use one user seat in this subscription only.`
        : `Remove ${member.full_name}'s access from ${subscriptionLabel}? Their TENH account, history, and other subscriptions stay unchanged.`,
    );

    if (!confirmed) return;
    void patch({ kind: "member", id: member.id, active: nextActive });
  }

  function toggleOwner(member: Member) {
    if (
      !currentUserIsOwner ||
      !canManageMembers ||
      !member.is_active ||
      member.id === currentMemberId ||
      savingId
    ) {
      return;
    }

    const isOwner = member.role === "owner";
    const confirmed = window.confirm(
      isOwner
        ? `Disable Owner access for ${member.full_name} on ${subscriptionLabel}? They will keep this subscription as an Admin.`
        : `Share Owner access with ${member.full_name} on ${subscriptionLabel}? They will receive full subscription, billing, channel, and user-management permissions for this subscription only.`,
    );

    if (!confirmed) return;
    void patch({
      kind: "member-role",
      id: member.id,
      role: isOwner ? "admin" : "owner",
    });
  }

  function toggleChannel(connection: Connection) {
    if (!canManageChannels || savingId) return;

    const name = connection.account_name ?? "Connected channel";
    const nextActive = !connection.is_active;
    const confirmed = window.confirm(
      nextActive
        ? `Enable ${name} on ${subscriptionLabel}? It will be available in Inbox again and use one channel slot in this subscription.`
        : `Disable ${name} on ${subscriptionLabel}? It will be blocked from Inbox and stop using a channel slot. Existing TENH customer and message history will be kept.`,
    );

    if (!confirmed) return;
    void patch({ kind: "connection", id: connection.id, active: nextActive });
  }

  const planLabel = subscription?.plan_code
    ? subscription.plan_code.charAt(0).toUpperCase() + subscription.plan_code.slice(1)
    : "Subscription";
  const statusLabel = subscription?.status
    ? subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)
    : "Unknown";
  const channelPercent =
    channelLimit && channelLimit > 0
      ? Math.min(100, Math.round((usage.channels / channelLimit) * 100))
      : 0;
  const memberPercent =
    memberLimit && memberLimit > 0
      ? Math.min(100, Math.round(((usage.members + invitations.length) / memberLimit) * 100))
      : 0;
  const actionMenuMember = actionMenu
    ? members.find((member) => member.id === actionMenu.memberId) ?? null
    : null;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
          {isKhmer ? "ការប្រើប្រាស់ការជាវ" : "Subscription usage"}
        </p>
        <h1 className="mt-2 text-[clamp(26px,2.2vw,38px)] font-bold tracking-tight text-slate-950">
          {isKhmer ? "គ្រប់គ្រងសមត្ថភាពកន្លែងធ្វើការ" : "Manage workspace capacity"}
        </h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          {isKhmer
            ? "គ្រប់គ្រងអ្នកដែលអាចចូលប្រើការជាវនេះ និងចំនួនកន្លែងអ្នកប្រើប្រាស់ និងឆានែលដែលកំពុងប្រើ។"
            : "Manage who can access this subscription and how many seats and channels are in use."}
        </p>
      </div>

      <section className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-[0_8px_26px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr] xl:items-center">
          <div className="min-w-0">
            <WorkspaceContextSwitcher compact className="w-full" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden="true">
                    <path d="M4 21V5a2 2 0 0 1 2-2h8v18" />
                    <path d="M14 9h4a2 2 0 0 1 2 2v10" />
                    <path d="M8 7h2M8 11h2M8 15h2M17 13h1M17 17h1M2 21h20" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-slate-900">{isKhmer ? "ឆានែល" : "Channels"}</p>
                    <p className="font-bold text-slate-950">
                      {usage.channels}{channelLimit !== null ? ` / ${channelLimit}` : ""}
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${channelPercent}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{isKhmer ? `បានប្រើ ${channelPercent}%` : `${channelPercent}% used`}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-slate-900">{isKhmer ? "អ្នកប្រើប្រាស់" : "Users"}</p>
                    <p className="font-bold text-slate-950">
                      {usage.members + invitations.length}{memberLimit !== null ? ` / ${memberLimit}` : ""}
                    </p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${memberPercent}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{isKhmer ? `បានប្រើ ${memberPercent}%` : `${memberPercent}% used`}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="border-b border-slate-200">
        <div className="flex gap-8">
          <button
            type="button"
            onClick={() => changeTab("users")}
            className={`border-b-2 px-2 py-3 text-sm font-semibold transition ${
              tab === "users"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {isKhmer ? "អ្នកប្រើប្រាស់" : "People"}
          </button>

          <button
            type="button"
            onClick={() => changeTab("channels")}
            className={`border-b-2 px-2 py-3 text-sm font-semibold transition ${
              tab === "channels"
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {isKhmer ? "ឆានែល" : "Channel"}
          </button>
        </div>
      </div>

      {!loading && !hasSafeMutationContext ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          TENH cannot safely identify the subscription for this permission screen. Editing is locked. Select the correct subscription above, then reload before changing users or channels.
        </div>
      ) : null}

      {tab === "users" && !canManageMembers && hasSafeMutationContext && !loading ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          {isKhmer
            ? "មើលបានតែប៉ុណ្ណោះ។ មានតែម្ចាស់ ឬសមាជិកដែលមានសិទ្ធិគ្រប់គ្រងប៉ុណ្ណោះដែលអាចផ្លាស់ប្តូរសមាជិកក្រុមបាន។"
            : "View only. Only an Owner or a member with Manage permission can change Team members."}
        </div>
      ) : null}

      {tab === "channels" && !canManageChannels && hasSafeMutationContext && !loading ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          {isKhmer
            ? "មើលបានតែប៉ុណ្ណោះ។ មានតែម្ចាស់ ឬសមាជិកដែលមានសិទ្ធិគ្រប់គ្រងប៉ុណ្ណោះដែលអាចផ្លាស់ប្តូរឆានែលបាន។"
            : "View only. Only an Owner can change Channels."}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-[22px] border border-slate-200 bg-white p-8 text-sm font-medium text-slate-500 shadow-sm">
          {isKhmer ? "កំពុងផ្ទុកសិទ្ធិកន្លែងធ្វើការ..." : "Loading workspace permissions..."}
        </div>
      ) : tab === "users" ? (
        <>
          <section className="overflow-visible rounded-[22px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-[330px]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>

                <input
                  type="search"
                  value={peopleSearch}
                  onChange={(event) =>
                    setPeopleSearch(event.target.value)
                  }
                  placeholder={isKhmer ? "ស្វែងរកអ្នកប្រើប្រាស់..." : "Search people..."}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={peopleRole}
                  onChange={(event) =>
                    setPeopleRole(
                      event.target.value as
                        | "all"
                        | "owner"
                        | "member"
                        | "invited",
                    )
                  }
                  className="h-11 min-w-[190px] rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="all">{isKhmer ? "តួនាទីទាំងអស់" : "All roles"}</option>
                  <option value="owner">{isKhmer ? "ម្ចាស់" : "Owner"}</option>
                  <option value="member">{isKhmer ? "សមាជិកក្រុម" : "Team member"}</option>
                  <option value="invited">{isKhmer ? "បានអញ្ជើញ" : "Invited"}</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setPeopleSearch("");
                    setPeopleRole("all");
                  }}
                  title={isKhmer ? "កំណត់តម្រងអ្នកប្រើប្រាស់ឡើងវិញ" : "Reset people filters"}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6" strokeLinecap="round" />
                  </svg>
                </button>

                {canManageMembers ? (
                  <button
                    type="button"
                    onClick={() =>
                      setInviteOpen(
                        (current) => !current,
                      )
                    }
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M16 11h6" strokeLinecap="round" />
                    </svg>
                    {inviteOpen
                      ? isKhmer ? "បិទ" : "Close"
                      : isKhmer ? "អញ្ជើញអ្នកប្រើប្រាស់" : "Invite user"}
                  </button>
                ) : null}
              </div>
            </div>

            {inviteOpen && canManageMembers ? (
              <div className="border-b border-slate-200 bg-blue-50/40 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) =>
                      setInviteEmail(
                        event.target.value,
                      )
                    }
                    placeholder="user@example.com"
                    disabled={Boolean(inviteWorking)}
                    className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />

                  <select
                    value={currentUserIsOwner ? inviteRole : "agent"}
                    onChange={(event) =>
                      setInviteRole(
                        currentUserIsOwner && event.target.value === "owner"
                          ? "owner"
                          : "agent",
                      )
                    }
                    disabled={Boolean(inviteWorking)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="agent">
                      {isKhmer ? "សមាជិកក្រុម" : "Team member"}
                    </option>
                    {currentUserIsOwner ? (
                      <option value="owner">
                        {isKhmer ? "ម្ចាស់" : "Owner"}
                      </option>
                    ) : null}
                  </select>

                  <button
                    type="button"
                    onClick={() =>
                      void sendInvitation()
                    }
                    disabled={
                      Boolean(inviteWorking) ||
                      !inviteEmail.trim()
                    }
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {inviteWorking === "create"
                      ? isKhmer ? "កំពុងផ្ញើ..." : "Sending..."
                      : isKhmer ? "ផ្ញើការអញ្ជើញ" : "Send invite"}
                  </button>
                </div>

                {localInviteUrl ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                    {isKhmer
                      ? "អ៊ីមែលសម្រាប់ការអភិវឌ្ឍក្នុងម៉ាស៊ីនមិនទាន់បានកំណត់។ តំណសាកល្បង៖ "
                      : "Local development email is not configured. Test link: "}
                    <a
                      href={localInviteUrl}
                      className="font-bold underline"
                    >
                      {isKhmer ? "បើកការអញ្ជើញ" : "Open invitation"}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <div className="min-w-[920px]">
                <div className="grid grid-cols-[1.55fr_1.2fr_0.78fr_0.9fr_110px] border-b border-slate-200 bg-slate-50/70 px-5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:px-6">
                  <div className="py-3.5">{isKhmer ? "សមាជិក" : "Member"}</div>
                  <div className="py-3.5">{isKhmer ? "តួនាទី" : "Role"}</div>
                  <div className="py-3.5">{isKhmer ? "ការចូលប្រើ" : "Access"}</div>
                  <div className="py-3.5">{isKhmer ? "បានបន្ថែម" : "Added"}</div>
                  <div className="py-3.5 text-right">{isKhmer ? "សកម្មភាព" : "Actions"}</div>
                </div>

                {filteredMembers.map((member) => {
                  const isOwner =
                    member.role === "owner";
                  const isCurrent =
                    member.id ===
                    currentMemberId;
                  return (
                    <div
                      key={member.id}
                      className="grid min-h-[72px] grid-cols-[1.55fr_1.2fr_0.78fr_0.9fr_110px] items-center border-b border-slate-100 px-5 text-sm last:border-b-0 sm:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3 py-3">
                        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 font-bold text-slate-600">
                          {member.profile_picture_url ? (
                            <img
                              src={
                                member.profile_picture_url
                              }
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            initial(
                              member.full_name,
                            )
                          )}

                          {member.is_active ? (
                            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                          ) : null}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-bold text-slate-900">
                              {member.full_name}
                            </p>

                            {isCurrent ? (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                                {isKhmer ? "អ្នក" : "You"}
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {member.email ??
                              "No email"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 py-3 font-semibold text-slate-800">
                        {isOwner ? (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            className="h-5 w-5 shrink-0 text-violet-600"
                            aria-hidden="true"
                          >
                            <path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            className="h-5 w-5 shrink-0 text-blue-600"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="7" r="3.2" />
                            <path d="M5 20v-1a7 7 0 0 1 14 0v1" strokeLinecap="round" />
                          </svg>
                        )}

                        <span>
                          {isOwner
                            ? isKhmer ? "ម្ចាស់" : "Owner"
                            : isKhmer ? "សមាជិកក្រុម" : "Team member"}
                        </span>

                        {isCurrent &&
                        isOwner ? (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                            {isKhmer ? "ម្ចាស់ចម្បង" : "Primary owner"}
                          </span>
                        ) : null}
                      </div>

                      <div className="py-3">
                        <span
                          className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                            member.is_active
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border border-slate-200 bg-slate-100 text-slate-500"
                          }`}
                        >
                          {member.is_active
                            ? isKhmer ? "សិទ្ធិពេញលេញ" : "Full access"
                            : isKhmer ? "គ្មានសិទ្ធិចូលប្រើ" : "No access"}
                        </span>
                      </div>

                      <div className="py-3 text-xs leading-5 text-slate-500">
                        {formatAddedDate(
                          member.created_at,
                        )}
                      </div>

                      <div className="flex justify-end py-3">
                        {isCurrent ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-500"
                            title={isKhmer ? "គណនីបច្ចុប្បន្នរបស់អ្នកត្រូវបានការពារពីការផ្លាស់ប្តូរតួនាទី និងសិទ្ធិចូលប្រើនៅលើអេក្រង់នេះ។" : "Your current account is protected from role and access changes on this screen."}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path d="M12 3 5 6v5c0 4.8 2.9 8.2 7 10 4.1-1.8 7-5.2 7-10V6l-7-3Z" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="m9.5 12 1.7 1.7 3.6-4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {isKhmer ? "បានការពារ" : "Protected"}
                          </span>
                        ) : canManageMembers && !member.is_active ? (
                          <button
                            type="button"
                            disabled={savingId === member.id}
                            onClick={() => toggleAccess(member)}
                            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60"
                            title={isKhmer ? "បើកសិទ្ធិចូលប្រើសម្រាប់សមាជិកនេះឡើងវិញ" : `Enable ${member.full_name}'s access again`}
                          >
                            {savingId === member.id
                              ? isKhmer
                                ? "កំពុងបើក..."
                                : "Enabling..."
                              : isKhmer
                                ? "បើកសិទ្ធិ"
                                : "Enable access"}
                          </button>
                        ) : canManageMembers && member.is_active ? (
                          <button
                            type="button"
                            className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg font-bold transition hover:bg-slate-100 hover:text-slate-800 ${
                              actionMenu?.memberId === member.id
                                ? "bg-slate-100 text-slate-800"
                                : "text-slate-500"
                            }`}
                            aria-label={`Actions for ${member.full_name}`}
                            aria-haspopup="menu"
                            aria-expanded={actionMenu?.memberId === member.id}
                            title={isKhmer ? "សកម្មភាព" : "Actions"}
                            onClick={(event) => {
                              if (actionMenu?.memberId === member.id) {
                                setActionMenu(null);
                                return;
                              }

                              const rect = event.currentTarget.getBoundingClientRect();
                              const menuWidth = 208;
                              const menuHeight = 160;
                              const gap = 6;
                              const viewportPadding = 12;
                              const left = Math.min(
                                window.innerWidth - menuWidth - viewportPadding,
                                Math.max(viewportPadding, rect.right - menuWidth),
                              );
                              const openAbove =
                                window.innerHeight - rect.bottom < menuHeight + gap &&
                                rect.top > menuHeight + gap;
                              const top = openAbove
                                ? Math.max(viewportPadding, rect.top - menuHeight - gap)
                                : Math.min(
                                    window.innerHeight - menuHeight - viewportPadding,
                                    rect.bottom + gap,
                                  );

                              setActionMenu({
                                memberId: member.id,
                                top,
                                left,
                              });
                            }}
                          >
                            ⋮
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredInvitations.map(
                  (invitation) => (
                    <div
                      key={invitation.id}
                      className="grid min-h-[72px] grid-cols-[1.55fr_1.2fr_0.78fr_0.9fr_110px] items-center border-b border-slate-100 bg-white px-5 text-sm last:border-b-0 sm:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3 py-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            className="h-5 w-5"
                            aria-hidden="true"
                          >
                            <rect x="3" y="5" width="18" height="14" rx="2" />
                            <path d="m4 7 8 6 8-6" />
                          </svg>
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {invitation.email}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {isKhmer ? "បានផ្ញើការអញ្ជើញ" : "Invitation sent"}
                          </p>
                        </div>
                      </div>

                      <div className="py-3 text-sm text-slate-400">
                        {invitation.role ===
                        "owner"
                          ? isKhmer ? "ម្ចាស់" : "Owner"
                          : isKhmer ? "សមាជិកក្រុម" : "Team member"}
                      </div>

                      <div className="py-3">
                        <span className="inline-flex rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-600">
                          {isKhmer ? "បានអញ្ជើញ" : "Invited"}
                        </span>
                      </div>

                      <div className="py-3 text-xs leading-5 text-slate-500">
                        {formatAddedDate(
                          invitation.created_at,
                        )}
                      </div>

                      <div className="flex justify-end gap-2 py-3">
                        {canManageMembers ? (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(
                                inviteWorking,
                              )}
                              onClick={() =>
                                void manageInvitation(
                                  invitation,
                                  "resend",
                                )
                              }
                              className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50"
                            >
                              {inviteWorking ===
                              invitation.id
                                ? "..."
                                : isKhmer ? "ផ្ញើម្តងទៀត" : "Resend"}
                            </button>

                            <button
                              type="button"
                              disabled={Boolean(
                                inviteWorking,
                              )}
                              onClick={() =>
                                void manageInvitation(
                                  invitation,
                                  "cancel",
                                )
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                              title={isKhmer ? "បោះបង់ការអញ្ជើញ" : "Cancel invitation"}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                className="h-4 w-4"
                                aria-hidden="true"
                              >
                                <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" strokeLinecap="round" />
                              </svg>
                            </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ),
                )}

                {filteredMembers.length ===
                  0 &&
                filteredInvitations.length ===
                  0 ? (
                  <div className="px-6 py-10 text-center text-sm text-slate-500">
                    {isKhmer ? "មិនមានអ្នកប្រើប្រាស់ត្រូវនឹងតម្រងបច្ចុប្បន្នទេ។" : "No people match the current filters."}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span>
                {filteredMembers.length +
                  filteredInvitations.length}{" "}
                {isKhmer ? "លទ្ធផល" : "result"}
                {!isKhmer &&
                  (filteredMembers.length + filteredInvitations.length === 1
                    ? ""
                    : "s")}
              </span>

              <span>
                {isKhmer ? "កន្លែងអ្នកប្រើប្រាស់៖ " : "Seats: "}
                {usage.members +
                  invitations.length}
                {memberLimit !== null
                  ? ` / ${memberLimit}`
                  : ""}{" "}
                · {invitations.length} {isKhmer ? "កំពុងរង់ចាំ" : "pending"}
              </span>
            </div>
          </section>
        </>
      ) : (
        <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h2 className="text-lg font-bold text-slate-950">{isKhmer ? "ឆានែលកន្លែងធ្វើការ" : "Workspace channels"}</h2>
              <p className="mt-0.5 text-sm leading-6 text-slate-500">
                {isKhmer
                  ? "ការតភ្ជាប់ដែលបានបើកនីមួយៗប្រើកន្លែងឆានែលមួយ។ ការបិទការតភ្ជាប់នឹងរក្សាព័ត៌មានសម្គាល់ និងប្រវត្តិ TENH របស់វា។"
                  : "Each enabled connection uses one channel slot. Disabling a connection keeps its credentials and TENH history."}
              </p>
            </div>
            {canManageChannels ? (
              <Link href="/dashboard/integrations" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700">
                {isKhmer ? "+ ភ្ជាប់ឆានែល" : "+ Connect channel"}
              </Link>
            ) : null}
          </div>

          {connections.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-semibold text-slate-800">{isKhmer ? "មិនទាន់មានឆានែលដែលបានរក្សាទុកទេ" : "No channels saved yet"}</p>
              <p className="mt-1 text-sm text-slate-500">{isKhmer ? "ភ្ជាប់ឆានែលអតិថិជនពីការតភ្ជាប់។" : "Connect a customer channel from Integrations."}</p>
            </div>
          ) : (
            <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {connections.map((connection) => {
                const name = connection.account_name ?? "Connected channel";
                const icon = channelIcon(connection.platform);

                return (
                  <div key={connection.id} className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${connection.is_active ? "bg-white" : "bg-amber-50/50"}`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 font-bold text-slate-700">
                        {icon ? <img src={icon} alt="" className="h-full w-full object-cover" /> : initial(name)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-slate-900">{name}</p>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${connection.is_active ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                            {connection.is_active
                              ? isKhmer ? "កំពុងប្រើ" : "Active"
                              : isKhmer ? "បានបិទ" : "Disabled"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{platformLabel(connection.platform)}</p>
                        <p className="mt-1 break-all text-xs text-slate-500">{isKhmer ? "លេខសម្គាល់គណនី៖" : "Account ID:"} {connection.platform_account_id ?? "—"}</p>
                      </div>
                    </div>

                    {canManageChannels ? (
                      <button
                        type="button"
                        disabled={savingId === connection.id}
                        onClick={() => toggleChannel(connection)}
                        className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          connection.is_active
                            ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                      >
                        {savingId === connection.id
                          ? isKhmer ? "កំពុងរក្សាទុក..." : "Saving..."
                          : connection.is_active
                            ? isKhmer ? "បិទឆានែល" : "Disable channel"
                            : isKhmer ? "បើកឆានែល" : "Enable channel"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {actionMenu && actionMenuMember && typeof document !== "undefined"
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[90]"
                aria-hidden="true"
                onMouseDown={() => setActionMenu(null)}
              />
              <div
                role="menu"
                aria-label={`${actionMenuMember.full_name} actions`}
                className="fixed z-[100] w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
                style={{
                  top: actionMenu.top,
                  left: actionMenu.left,
                }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {currentUserIsOwner ? (
                  <>
                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    !canManageMembers ||
                    !actionMenuMember.is_active ||
                    actionMenuMember.id === currentMemberId ||
                    savingId === actionMenuMember.id ||
                    actionMenuMember.role !== "owner"
                  }
                  onClick={() => {
                    const member = actionMenuMember;
                    setActionMenu(null);
                    if (member.role === "owner") {
                      toggleOwner(member);
                    }
                  }}
                  title={
                    actionMenuMember.role === "owner"
                      ? isKhmer
                        ? "ប្តូរម្ចាស់នេះត្រឡប់ទៅជាសមាជិកក្រុម"
                        : "Change this Owner back to Team member"
                      : isKhmer
                        ? "សមាជិកនេះកំពុងប្រើតួនាទីសមាជិកក្រុមរួចហើយ"
                        : "This member is already using the Team member role"
                  }
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-4.5 w-4.5 shrink-0 text-slate-500"
                    aria-hidden="true"
                  >
                    <circle cx="9" cy="7" r="3" />
                    <path d="M3 20v-1a6 6 0 0 1 12 0v1M17 8h4M19 6v4" strokeLinecap="round" />
                  </svg>
                  <span>{isKhmer ? "ប្តូរតួនាទី" : "Change role"}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    !canManageMembers ||
                    !actionMenuMember.is_active ||
                    actionMenuMember.id === currentMemberId ||
                    savingId === actionMenuMember.id ||
                    actionMenuMember.role === "owner"
                  }
                  onClick={() => {
                    const member = actionMenuMember;
                    setActionMenu(null);
                    if (member.role !== "owner") {
                      toggleOwner(member);
                    }
                  }}
                  title={
                    actionMenuMember.role === "owner"
                      ? isKhmer
                        ? "សមាជិកនេះជាម្ចាស់រួចហើយ"
                        : "This member is already an Owner"
                      : isKhmer
                        ? "ផ្តល់សិទ្ធិម្ចាស់ឲ្យសមាជិកនេះ"
                        : "Give this member Owner access"
                  }
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-4.5 w-4.5 shrink-0 text-violet-600"
                    aria-hidden="true"
                  >
                    <path d="m3 7 4 4 5-7 5 7 4-4-2 11H5L3 7Z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{isKhmer ? "ធ្វើជាម្ចាស់" : "Make Owner"}</span>
                </button>

                  </>
                ) : null}

                <div className="my-1 border-t border-slate-100" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={
                    !canManageMembers ||
                    actionMenuMember.id === currentMemberId ||
                    (!currentUserIsOwner && actionMenuMember.role === "owner") ||
                    savingId === actionMenuMember.id
                  }
                  onClick={() => {
                    const member = actionMenuMember;
                    setActionMenu(null);
                    toggleAccess(member);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-4.5 w-4.5 shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" strokeLinecap="round" />
                  </svg>
                  <span>
                    {savingId === actionMenuMember.id
                      ? isKhmer
                        ? "កំពុងដក..."
                        : "Removing..."
                      : isKhmer
                        ? "ដកសិទ្ធិចូលប្រើ"
                        : "Remove access"}
                  </span>
                </button>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
