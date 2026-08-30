"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { WorkspaceContextSwitcher } from "@/components/subscription/workspace-context-switcher";

type Tab = "users" | "channels";

type Member = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  profile_picture_url: string | null;
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

function PermissionMark({
  checked,
  disabled = true,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick) && !disabled;

  const content = (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-md border text-[11px] font-black transition ${
        checked
          ? interactive
            ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
            : "border-slate-300 bg-slate-200 text-slate-500"
          : interactive
            ? "border-slate-300 bg-white text-transparent hover:border-blue-400 hover:bg-blue-50"
            : "border-slate-200 bg-white text-transparent"
      }`}
      aria-hidden="true"
    >
      ✓
    </span>
  );

  if (!interactive) {
    return (
      <div className="flex justify-center" title={label}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-slate-50"
      aria-label={label}
      aria-pressed={checked}
      title={label}
    >
      {content}
    </button>
  );
}

function GroupMark({ checked }: { checked: boolean }) {
  return (
    <span
      className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black ${
        checked
          ? "border-slate-400 bg-slate-400 text-white"
          : "border-slate-300 bg-white text-transparent"
      }`}
      aria-hidden="true"
    >
      ✓
    </span>
  );
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

  const members = data?.members ?? [];
  const connections = data?.connections ?? [];
  const usage = data?.usage ?? { members: 0, channels: 0 };
  const subscription = data?.subscription;
  const businessId = data?.businessId ?? "";
  const subscriptionId = subscription?.id ?? "";
  const subscriptionLabel = shortSubscriptionId(subscriptionId);
  const hasSafeMutationContext = Boolean(businessId && subscriptionId);
  const canManage = data?.canManage === true && hasSafeMutationContext;
  const currentMemberId = data?.currentMemberId ?? "";
  const memberLimit = subscription?.member_limit ?? null;
  const channelLimit = subscription?.channel_limit ?? null;

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

    if (!canManage || !email || inviteWorking) {
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
    if (!canManage || inviteWorking) {
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
    if (!canManage || member.id === currentMemberId || savingId) return;

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
      !canManage ||
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
    if (!canManage || savingId) return;

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

  const channelPercent =
    channelLimit && channelLimit > 0
      ? Math.min(
          100,
          Math.round(
            (usage.channels / channelLimit) * 100,
          ),
        )
      : 0;

  const usedMemberSeats =
    usage.members + invitations.length;

  const memberPercent =
    memberLimit && memberLimit > 0
      ? Math.min(
          100,
          Math.round(
            (usedMemberSeats / memberLimit) * 100,
          ),
        )
      : 0;

  const planLabel =
    subscription?.plan_code
      ? subscription.plan_code
          .replace(/[_-]+/g, " ")
          .replace(/\b\w/g, (letter) =>
            letter.toUpperCase(),
          )
      : "Current plan";

  return (
    <div className="min-h-full bg-slate-50/70">
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
        <header>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">
            Subscription usage
          </p>

          <h1 className="mt-2 text-[29px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[32px]">
            Manage workspace capacity
          </h1>

          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            Manage who can access this subscription and how many seats and channels are in use.
          </p>
        </header>

        {/* Current subscription */}
        <section className="grid gap-5 rounded-[22px] border border-slate-200 bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.06)] lg:grid-cols-[1.18fr_0.9fr] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                className="h-8 w-8"
                aria-hidden="true"
              >
                <path
                  d="M6 3h12a2 2 0 0 1 2 2v16l-6-3-6 3V5a2 2 0 0 1 2-2Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m12 7 1.15 2.33 2.57.37-1.86 1.82.44 2.56L12 12.86 9.7 14.08l.44-2.56L8.28 9.7l2.57-.37L12 7Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700">
                Current subscription
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h2 className="text-[22px] font-extrabold tracking-[-0.02em] text-slate-950">
                  {subscriptionLabel} · {planLabel}
                </h2>

                {subscription?.status ? (
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${
                      subscription.status === "active"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-100 text-slate-600"
                    }`}
                  >
                    {subscription.status}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-sm text-slate-600">
                {planLabel} subscription
                {data?.currentMemberRole
                  ? ` · ${
                      data.currentMemberRole === "owner"
                        ? "Owner"
                        : data.currentMemberRole === "admin"
                          ? "Admin"
                          : "Team member"
                    }`
                  : ""}
              </p>

              <p className="mt-1.5 text-xs text-slate-500">
                Only this subscription is affected when you manage access here.
              </p>

              <div className="mt-4 max-w-[420px]">
                <WorkspaceContextSwitcher compact />
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2">
            <div className="flex gap-3 sm:border-r sm:border-slate-200 sm:pr-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    d="M4 20h16M6 20V7h7v13M13 11h5v9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8.5 10h2M8.5 13h2M8.5 16h2M15 14h1.5M15 17h1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">
                    Channels
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {usage.channels}
                    {channelLimit !== null
                      ? ` / ${channelLimit}`
                      : ""}
                  </p>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{
                      width: `${channelPercent}%`,
                    }}
                  />
                </div>

                <p className="mt-1.5 text-xs text-slate-500">
                  {channelPercent}% used
                </p>
              </div>
            </div>

            <div className="flex gap-3 sm:pl-1">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
                    strokeLinecap="round"
                  />
                  <circle cx="9" cy="7" r="4" />
                  <path
                    d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                    strokeLinecap="round"
                  />
                </svg>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">
                    Users
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {usedMemberSeats}
                    {memberLimit !== null
                      ? ` / ${memberLimit}`
                      : ""}
                  </p>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{
                      width: `${memberPercent}%`,
                    }}
                  />
                </div>

                <p className="mt-1.5 text-xs text-slate-500">
                  {memberPercent}% used
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <div className="flex gap-8">
            <button
              type="button"
              onClick={() =>
                changeTab("users")
              }
              className={`border-b-2 px-2 py-3 text-sm font-semibold transition ${
                tab === "users"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              User permissions
            </button>

            <button
              type="button"
              onClick={() =>
                changeTab("channels")
              }
              className={`border-b-2 px-2 py-3 text-sm font-semibold transition ${
                tab === "channels"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Channels
            </button>
          </div>
        </div>

        {!loading && !hasSafeMutationContext ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
            TENH cannot safely identify the subscription for this permission screen. Editing is locked. Select the correct subscription above, then reload before changing users or channels.
          </div>
        ) : null}

        {!canManage &&
        hasSafeMutationContext &&
        !loading ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            Only an Owner can change subscription access, Owner permissions, or channel capacity. You can still review the current settings.
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
          <div className="rounded-[22px] border border-slate-200 bg-white p-7 text-sm font-medium text-slate-500 shadow-sm">
            Loading workspace permissions...
          </div>
        ) : tab === "users" ? (
          <>
            {/* Team members */}
            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">
                    Team members
                  </h3>

                  <p className="mt-1 text-sm text-slate-500">
                    Seats: {usedMemberSeats}
                    {memberLimit !== null
                      ? ` / ${memberLimit}`
                      : ""}{" "}
                    · {invitations.length} pending
                  </p>
                </div>

                {canManage ? (
                  <button
                    type="button"
                    onClick={() =>
                      setInviteOpen(
                        (current) =>
                          !current,
                      )
                    }
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-4.5 w-4.5"
                      aria-hidden="true"
                    >
                      <path
                        d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                        strokeLinecap="round"
                      />
                      <circle
                        cx="8"
                        cy="7"
                        r="4"
                      />
                      <path
                        d="M19 8v6M16 11h6"
                        strokeLinecap="round"
                      />
                    </svg>

                    {inviteOpen
                      ? "Close invite"
                      : "Invite user"}
                  </button>
                ) : null}
              </div>

              {/* Existing invite behavior preserved */}
              {inviteOpen && canManage ? (
                <div className="border-b border-slate-200 bg-blue-50/60 px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) =>
                        setInviteEmail(
                          event.target.value,
                        )
                      }
                      placeholder="user@example.com"
                      disabled={Boolean(
                        inviteWorking,
                      )}
                      className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    <select
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(
                          event.target.value ===
                            "owner"
                            ? "owner"
                            : "agent",
                        )
                      }
                      disabled={Boolean(
                        inviteWorking,
                      )}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="agent">
                        Team member
                      </option>
                      <option value="owner">
                        Owner
                      </option>
                    </select>

                    <button
                      type="button"
                      onClick={() =>
                        void sendInvitation()
                      }
                      disabled={
                        Boolean(
                          inviteWorking,
                        ) ||
                        !inviteEmail.trim()
                      }
                      className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {inviteWorking ===
                      "create"
                        ? "Sending..."
                        : "Send invite"}
                    </button>
                  </div>

                  {localInviteUrl ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                      Local development email is not configured. Test link:{" "}
                      <a
                        href={localInviteUrl}
                        className="font-bold underline"
                      >
                        Open invitation
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {invitations.length > 0 ? (
                <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    Pending invitations
                  </p>

                  <div className="mt-3 space-y-2">
                    {invitations.map(
                      (invitation) => (
                        <div
                          key={
                            invitation.id
                          }
                          className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {
                                invitation.email
                              }
                            </p>

                            <p className="mt-1 text-xs text-slate-500">
                              {invitation.role ===
                              "owner"
                                ? "Owner"
                                : "Team member"}{" "}
                              · expires{" "}
                              {new Date(
                                invitation.expires_at,
                              ).toLocaleDateString()}
                            </p>
                          </div>

                          {canManage ? (
                            <div className="flex shrink-0 gap-2">
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
                                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {inviteWorking ===
                                invitation.id
                                  ? "Working..."
                                  : "Resend"}
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
                                className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ) : null}

              <div className="max-h-[410px] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                {members.map((member) => {
                  const isOwner =
                    member.role === "owner";
                  const isCurrent =
                    member.id ===
                    currentMemberId;
                  const active =
                    member.is_active;

                  return (
                    <div
                      key={member.id}
                      className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.95fr)_190px] md:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 font-bold text-blue-700">
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
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-slate-900">
                              {
                                member.full_name
                              }
                            </p>

                            {isCurrent ? (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                                You
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-1 truncate text-xs text-slate-500">
                            {member.email ??
                              "No email"}
                          </p>
                        </div>
                      </div>

                      <div>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            !active
                              ? "bg-slate-100 text-slate-500"
                              : isOwner
                                ? "bg-blue-100 text-blue-700"
                                : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {!active
                            ? "No access"
                            : isOwner
                              ? "Owner"
                              : "Team member"}
                        </span>

                        <p className="mt-1 text-xs text-slate-500">
                          {!active
                            ? "No access to this subscription"
                            : isOwner
                              ? "Full access and workspace control"
                              : "Can work in channels and the inbox"}
                        </p>
                      </div>

                      <div className="flex md:justify-end">
                        {isCurrent ? (
                          <div className="inline-flex min-w-[170px] items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600">
                            {isOwner
                              ? "Owner"
                              : active
                                ? "Team member"
                                : "No access"}
                            <span className="text-slate-400">
                              ⌄
                            </span>
                          </div>
                        ) : (
                          <div className="relative group">
                            <button
                              type="button"
                              disabled={
                                !canManage ||
                                savingId ===
                                  member.id
                              }
                              className="inline-flex min-w-[170px] items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingId ===
                              member.id
                                ? "Saving..."
                                : !active
                                  ? "No access"
                                  : isOwner
                                    ? "Owner"
                                    : "Team member"}

                              <span className="ml-4 text-slate-400">
                                ⌄
                              </span>
                            </button>

                            {canManage &&
                            savingId !==
                              member.id ? (
                              <div className="invisible absolute right-0 top-[calc(100%+6px)] z-30 w-48 rounded-xl border border-slate-200 bg-white p-1.5 opacity-0 shadow-xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                                {active &&
                                !isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleOwner(
                                        member,
                                      )
                                    }
                                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50"
                                  >
                                    Owner
                                  </button>
                                ) : null}

                                {active &&
                                isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleOwner(
                                        member,
                                      )
                                    }
                                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Team member
                                  </button>
                                ) : null}

                                {!active ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleAccess(
                                        member,
                                      )
                                    }
                                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                                  >
                                    Restore access
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleAccess(
                                        member,
                                      )
                                    }
                                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                                  >
                                    No access
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Screenshot-style role summary */}
            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">
                    Role permissions
                  </h3>

                  <p className="mt-1 text-sm text-slate-500">
                    See what each role can do.
                  </p>
                </div>

                <details className="group">
                  <summary className="cursor-pointer list-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50">
                    View detailed permissions →
                  </summary>

                  {/* Original detailed permission grid preserved */}
                  <div className="mt-4 max-w-[calc(100vw-48px)] overflow-x-auto rounded-2xl border border-slate-200">
                    <div className="min-w-[980px]">
                      <div className="grid grid-cols-[minmax(280px,1.7fr)_repeat(6,minmax(105px,0.65fr))] border-b border-slate-200 bg-white text-center text-xs font-semibold text-slate-800">
                        <div className="flex items-center px-5 py-4 text-left">
                          Roles and users
                        </div>
                        <div className="border-l border-slate-200 px-2 py-4">
                          Subscription
                          <br />
                          access
                        </div>
                        <div className="border-l border-slate-200 px-2 py-4">
                          Inbox
                        </div>
                        <div className="border-l border-slate-200 px-2 py-4">
                          Owner
                        </div>
                        <div className="border-l border-slate-200 px-2 py-4">
                          Manage
                          <br />
                          channels
                        </div>
                        <div className="border-l border-slate-200 px-2 py-4">
                          Manage
                          <br />
                          users
                        </div>
                        <div className="border-l border-slate-200 px-2 py-4">
                          Subscription
                          <br />& billing
                        </div>
                      </div>

                      {groups.map(
                        (group) => (
                          <div
                            key={group.key}
                          >
                            <div className="grid grid-cols-[minmax(280px,1.7fr)_repeat(6,minmax(105px,0.65fr))] border-b border-slate-200 bg-slate-100/90 text-sm font-semibold text-slate-600">
                              <div className="flex items-center gap-3 px-5 py-3">
                                <span className="text-slate-500">
                                  ⌄
                                </span>

                                <div>
                                  <p>
                                    {
                                      group.label
                                    }
                                  </p>
                                  <p className="mt-0.5 text-[11px] font-normal text-slate-400">
                                    {
                                      group.description
                                    }
                                  </p>
                                </div>
                              </div>

                              {group.groupPermissions.map(
                                (
                                  checked,
                                  index,
                                ) => (
                                  <div
                                    key={
                                      index
                                    }
                                    className="flex items-center justify-center border-l border-slate-200 py-3"
                                  >
                                    <GroupMark
                                      checked={
                                        checked
                                      }
                                    />
                                  </div>
                                ),
                              )}
                            </div>

                            {group.members.map(
                              (member) => {
                                const isOwner =
                                  member.role ===
                                  "owner";
                                const isCurrent =
                                  member.id ===
                                  currentMemberId;
                                const roleControlEnabled =
                                  canManage &&
                                  member.is_active &&
                                  !isCurrent &&
                                  savingId !==
                                    member.id;
                                const accessControlEnabled =
                                  canManage &&
                                  !isCurrent &&
                                  savingId !==
                                    member.id;

                                return (
                                  <div
                                    key={
                                      member.id
                                    }
                                    className="grid grid-cols-[minmax(280px,1.7fr)_repeat(6,minmax(105px,0.65fr))] border-b border-slate-100 bg-white text-sm last:border-b-0"
                                  >
                                    <div className="flex min-w-0 items-center gap-3 px-5 py-3.5">
                                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 font-bold text-slate-600">
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
                                      </div>

                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="truncate font-medium text-slate-800">
                                            {
                                              member.full_name
                                            }
                                          </p>

                                          <RoleBadge
                                            role={
                                              member.role
                                            }
                                          />

                                          {isCurrent ? (
                                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                                              You
                                            </span>
                                          ) : null}
                                        </div>

                                        <p className="mt-0.5 truncate text-xs text-slate-400">
                                          {member.email ??
                                            "No email"}
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-center border-l border-slate-100">
                                      <PermissionMark
                                        checked={
                                          member.is_active
                                        }
                                        disabled={
                                          !accessControlEnabled
                                        }
                                        onClick={
                                          accessControlEnabled
                                            ? () =>
                                                toggleAccess(
                                                  member,
                                                )
                                            : undefined
                                        }
                                        label={
                                          isCurrent
                                            ? "Current subscription access"
                                            : member.is_active
                                              ? `Remove ${member.full_name}'s subscription access`
                                              : `Restore ${member.full_name}'s subscription access`
                                        }
                                      />
                                    </div>

                                    <div className="flex items-center justify-center border-l border-slate-100">
                                      <PermissionMark
                                        checked={
                                          member.is_active
                                        }
                                        label="Inbox access follows active subscription access"
                                      />
                                    </div>

                                    <div className="flex items-center justify-center border-l border-slate-100">
                                      <PermissionMark
                                        checked={
                                          member.is_active &&
                                          isOwner
                                        }
                                        disabled={
                                          !roleControlEnabled
                                        }
                                        onClick={
                                          roleControlEnabled
                                            ? () =>
                                                toggleOwner(
                                                  member,
                                                )
                                            : undefined
                                        }
                                        label={
                                          isCurrent
                                            ? "Current Owner access"
                                            : isOwner
                                              ? `Disable Owner access for ${member.full_name}`
                                              : `Share Owner access with ${member.full_name}`
                                        }
                                      />
                                    </div>

                                    <div className="flex items-center justify-center border-l border-slate-100">
                                      <PermissionMark
                                        checked={
                                          member.is_active &&
                                          isOwner
                                        }
                                        label="Owner permission: manage channels"
                                      />
                                    </div>

                                    <div className="flex items-center justify-center border-l border-slate-100">
                                      <PermissionMark
                                        checked={
                                          member.is_active &&
                                          isOwner
                                        }
                                        label="Owner permission: manage users"
                                      />
                                    </div>

                                    <div className="flex items-center justify-center border-l border-slate-100">
                                      <PermissionMark
                                        checked={
                                          member.is_active &&
                                          isOwner
                                        }
                                        label="Owner permission: subscription and billing"
                                      />
                                    </div>
                                  </div>
                                );
                              },
                            )}

                            {group.members
                              .length ===
                            0 ? (
                              <div className="border-b border-slate-100 bg-white px-5 py-4 text-xs text-slate-400 last:border-b-0">
                                No users in
                                this group.
                              </div>
                            ) : null}
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </details>
              </div>

              <div className="mt-3 overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[1.1fr_repeat(4,1fr)] border-b border-slate-200 text-center text-xs font-semibold text-slate-600">
                    <div className="px-3 py-3 text-left" />
                    <div className="px-3 py-3">
                      Inbox
                    </div>
                    <div className="px-3 py-3">
                      Manage channels
                    </div>
                    <div className="px-3 py-3">
                      Manage users
                    </div>
                    <div className="px-3 py-3">
                      Billing
                    </div>
                  </div>

                  {[
                    [
                      "Owner",
                      true,
                      true,
                      true,
                      true,
                    ],
                    [
                      "Team member",
                      true,
                      true,
                      false,
                      false,
                    ],
                    [
                      "No access",
                      false,
                      false,
                      false,
                      false,
                    ],
                  ].map(
                    ([
                      label,
                      inbox,
                      channels,
                      users,
                      billing,
                    ]) => (
                      <div
                        key={String(label)}
                        className="grid grid-cols-[1.1fr_repeat(4,1fr)] border-b border-slate-100 text-center text-sm last:border-b-0"
                      >
                        <div className="px-3 py-3 text-left font-semibold text-slate-700">
                          {String(label)}
                        </div>

                        {[
                          inbox,
                          channels,
                          users,
                          billing,
                        ].map(
                          (
                            allowed,
                            index,
                          ) => (
                            <div
                              key={index}
                              className="flex items-center justify-center px-3 py-3"
                            >
                              <span
                                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                                  allowed
                                    ? "bg-blue-600 text-white"
                                    : "bg-slate-200 text-slate-500"
                                }`}
                              >
                                {allowed
                                  ? "✓"
                                  : "−"}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
            </section>

            <p className="text-xs leading-5 text-slate-500">
              Removing access affects only this subscription. The user&apos;s TENH account, history, and access to other subscriptions stay unchanged.
            </p>
          </>
        ) : (
          <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">
                  Workspace channels
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  Channels: {usage.channels}
                  {channelLimit !== null
                    ? ` / ${channelLimit}`
                    : ""}
                </p>
              </div>

              <Link
                href="/dashboard/integrations"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                + Connect channel
              </Link>
            </div>

            {connections.length === 0 ? (
              <div className="p-8 text-center">
                <p className="font-semibold text-slate-800">
                  No channels saved yet
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Connect a customer channel from Integrations.
                </p>
              </div>
            ) : (
              <div className="max-h-[430px] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                {connections.map(
                  (connection) => {
                    const name =
                      connection.account_name ??
                      "Connected channel";
                    const icon =
                      channelIcon(
                        connection.platform,
                      );

                    return (
                      <div
                        key={
                          connection.id
                        }
                        className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 font-bold text-slate-700">
                            {icon ? (
                              <img
                                src={icon}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              initial(
                                name,
                              )
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold text-slate-900">
                                {name}
                              </p>

                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  connection.is_active
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {connection.is_active
                                  ? "Active"
                                  : "Disabled"}
                              </span>
                            </div>

                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                              {platformLabel(
                                connection.platform,
                              )}
                            </p>

                            <p className="mt-1 break-all text-xs text-slate-500">
                              Account ID:{" "}
                              {connection.platform_account_id ??
                                "—"}
                            </p>
                          </div>
                        </div>

                        {canManage ? (
                          <button
                            type="button"
                            disabled={
                              savingId ===
                              connection.id
                            }
                            onClick={() =>
                              toggleChannel(
                                connection,
                              )
                            }
                            className={`inline-flex min-w-[140px] items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              connection.is_active
                                ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            }`}
                          >
                            {savingId ===
                            connection.id
                              ? "Saving..."
                              : connection.is_active
                                ? "Disable"
                                : "Enable"}
                          </button>
                        ) : null}
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
