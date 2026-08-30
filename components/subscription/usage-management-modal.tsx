"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Tab = "connections" | "members";

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

type UsageManagementModalProps = {
  open: boolean;
  initialTab: Tab;
  onClose: () => void;
  onUsageChanged?: (usage: {
    members: number;
    channels: number;
  }) => void;
};

async function readResult(
  response: Response,
): Promise<UsageResponse> {
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
  return (
    name.trim().charAt(0).toUpperCase() ||
    "T"
  );
}

function StatusPill({
  active,
}: {
  active: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ChannelStatusPill({
  active,
}: {
  active: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        active
          ? "bg-emerald-100 text-emerald-700"
          : "bg-amber-100 text-amber-700"
      }`}
    >
      {active ? "Active" : "Disabled"}
    </span>
  );
}

export function UsageManagementModal({
  open,
  initialTab,
  onClose,
  onUsageChanged,
}: UsageManagementModalProps) {
  const [tab, setTab] =
    useState<Tab>(initialTab);
  const [loading, setLoading] =
    useState(false);
  const [savingId, setSavingId] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);
  const [notice, setNotice] =
    useState<string | null>(null);
  const [memberActionMenuId, setMemberActionMenuId] =
    useState<string | null>(null);
  const [data, setData] =
    useState<UsageResponse | null>(null);

  const onUsageChangedRef =
    useRef(onUsageChanged);

  useEffect(() => {
    onUsageChangedRef.current =
      onUsageChanged;
  }, [onUsageChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/subscription/usage-management",
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result = await readResult(
        response,
      );

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to load workspace usage.",
        );
      }

      /*
       * V3.11.31.39 — usage-management is the canonical source for
       * every customer channel stored in social_accounts (Messenger,
       * Telegram, and future supported platforms). Do not merge the
       * legacy singular /api/telegram/connection response here because
       * it only exposes the first Bot through its compatibility field.
       */
      const nextUsage = {
        members: result.usage?.members ?? 0,
        channels: result.usage?.channels ?? 0,
      };

      setData({
        ...result,
        usage: nextUsage,
      });

      onUsageChangedRef.current?.(
        nextUsage,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load workspace usage.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setTab(initialTab);
    setNotice(null);
    setMemberActionMenuId(null);
    void load();
  }, [
    open,
    initialTab,
    load,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        if (memberActionMenuId) {
          setMemberActionMenuId(null);
          return;
        }

        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [
    open,
    onClose,
    memberActionMenuId,
  ]);

  useEffect(() => {
    if (!memberActionMenuId) {
      return;
    }

    function closeMemberMenu(
      event: MouseEvent,
    ) {
      const target =
        event.target;

      if (
        target instanceof Element &&
        target.closest(
          "[data-member-access-menu]",
        )
      ) {
        return;
      }

      setMemberActionMenuId(null);
    }

    document.addEventListener(
      "mousedown",
      closeMemberMenu,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        closeMemberMenu,
      );
    };
  }, [memberActionMenuId]);

  const members = data?.members ?? [];
  const connections =
    data?.connections ?? [];
  const usage = data?.usage ?? {
    members: 0,
    channels: 0,
  };
  const subscription = data?.subscription;
  const businessId = data?.businessId ?? "";
  const subscriptionId = subscription?.id ?? "";
  const subscriptionLabel = shortSubscriptionId(subscriptionId);
  const hasSafeMutationContext = Boolean(businessId && subscriptionId);
  const canManage =
    data?.canManage === true && hasSafeMutationContext;
  const currentMemberId =
    data?.currentMemberId ?? "";

  const memberLimit =
    subscription?.member_limit ?? null;
  const channelLimit =
    subscription?.channel_limit ?? null;

  const activeMemberIds = useMemo(
    () =>
      new Set(
        members
          .filter((member) => member.is_active)
          .map((member) => member.id),
      ),
    [members],
  );

  if (!open) {
    return null;
  }

  async function patch(
    body:
      | {
          kind: "member";
          id: string;
          active: boolean;
        }
      | {
          kind: "member-role";
          id: string;
          role: "owner" | "admin";
        }
      | {
          kind: "connection";
          id: string;
          active: boolean;
        },
  ) {
    setSavingId(body.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/subscription/usage-management",
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            ...body,
            businessId,
            subscriptionId,
          }),
        },
      );

      const result = await readResult(
        response,
      );

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to update workspace usage.",
        );
      }

      setData(result);
      setNotice(
        result.message ??
          "Workspace usage updated.",
      );

      if (result.usage) {
        onUsageChangedRef.current?.(
          result.usage,
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update workspace usage.",
      );
    } finally {
      setSavingId(null);
    }
  }

  function toggleMember(member: Member) {
    if (!canManage) {
      return;
    }

    if (
      member.id === currentMemberId &&
      member.is_active
    ) {
      setError(
        "You cannot remove your own access from the subscription you are currently using.",
      );
      return;
    }

    const nextActive =
      !member.is_active;

    const confirmed = window.confirm(
      nextActive
        ? `Restore ${member.full_name}'s access to ${subscriptionLabel}? This will use one active user seat in this subscription.`
        : `Remove ${member.full_name}'s access from ${subscriptionLabel}? They will no longer be able to open this subscription or its Inbox. Their TENH account, history, and access to any other subscriptions will stay unchanged.`,
    );

    if (!confirmed) {
      return;
    }

    void patch({
      kind: "member",
      id: member.id,
      active: nextActive,
    });
  }

  function shareOwner(
    member: Member,
  ) {
    if (!canManage) {
      return;
    }

    if (!member.is_active) {
      setError(
        "Reactivate this user before sharing Owner access.",
      );
      return;
    }

    if (member.role === "owner") {
      return;
    }

    const confirmed = window.confirm(
      `Share Owner access with ${member.full_name} on ${subscriptionLabel}? They will receive full Owner permissions for this subscription only, including billing, channel, user, and workspace management.`,
    );

    if (!confirmed) {
      return;
    }

    void patch({
      kind: "member-role",
      id: member.id,
      role: "owner",
    });
  }

  function disableOwnerShare(
    member: Member,
  ) {
    if (!canManage || member.id === currentMemberId) {
      return;
    }

    if (member.role !== "owner") {
      return;
    }

    const confirmed = window.confirm(
      `Disable Owner share for ${member.full_name} on ${subscriptionLabel}? They will keep access to this subscription as an Admin, but will no longer have Owner-level billing, subscription, or ownership permissions.`,
    );

    if (!confirmed) {
      return;
    }

    void patch({
      kind: "member-role",
      id: member.id,
      role: "admin",
    });
  }

  function toggleChannel(
    connection: Connection,
  ) {
    if (!canManage) {
      return;
    }

    const name =
      connection.account_name ??
      "Connected channel";

    const nextActive =
      !connection.is_active;

    const confirmed = window.confirm(
      nextActive
        ? `Enable ${name} on ${subscriptionLabel}? This channel will be available in Inbox again and will use one channel slot in this subscription.`
        : `Disable ${name} on ${subscriptionLabel}? It will stop appearing as an available Inbox channel and will no longer use a channel slot. Existing TENH customer and message history will be kept.`,
    );

    if (!confirmed) {
      return;
    }

    void patch({
      kind: "connection",
      id: connection.id,
      active: nextActive,
    });
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

  const memberPercent =
    memberLimit && memberLimit > 0
      ? Math.min(
          100,
          Math.round(
            (usage.members / memberLimit) * 100,
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
      : "Current subscription";

  return (
    <div
      className="fixed inset-0 z-[70] overflow-y-auto bg-slate-100/95"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              Subscription usage
            </p>

            <h2 className="mt-2 text-[28px] font-extrabold tracking-[-0.03em] text-slate-950 sm:text-[32px]">
              Manage workspace capacity
            </h2>

            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-600">
              Manage who can access this subscription and how many seats and channels are in use.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xl text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Close usage management"
          >
            ×
          </button>
        </div>

        <section className="grid gap-5 rounded-[22px] border border-slate-200 bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.06)] lg:grid-cols-[1.2fr_0.9fr] lg:items-center">
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

            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-700">
                Current subscription
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="text-[22px] font-extrabold tracking-[-0.02em] text-slate-950">
                  {subscriptionLabel} · {planLabel}
                </h3>

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
                        : "Team member"
                    }`
                  : ""}
              </p>

              <p className="mt-1.5 text-xs text-slate-500">
                Only this subscription is affected when you manage access here.
              </p>
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
                  <path d="M4 20h16M6 20V7h7v13M13 11h5v9" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8.5 10h2M8.5 13h2M8.5 16h2M15 14h1.5M15 17h1.5" strokeLinecap="round" />
                </svg>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">Channels</p>
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
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
                </svg>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">Users</p>
                  <p className="text-sm font-bold text-slate-900">
                    {usage.members}
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

        <div className="border-b border-slate-200">
          <div className="flex gap-8">
            <button
              type="button"
              onClick={() =>
                setTab("members")
              }
              className={`border-b-2 px-2 py-3 text-sm font-semibold transition ${
                tab === "members"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              User permissions
            </button>

            <button
              type="button"
              onClick={() =>
                setTab("connections")
              }
              className={`border-b-2 px-2 py-3 text-sm font-semibold transition ${
                tab === "connections"
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
            TENH cannot safely identify this subscription. Editing is locked until you reload the page and confirm the subscription ID.
          </div>
        ) : null}

        {!canManage &&
        hasSafeMutationContext &&
        !loading ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            Only workspace Owners can manage user access or channels. You can still review current usage.
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
            Loading workspace usage...
          </div>
        ) : tab === "members" ? (
          <>
            <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">
                    Team members
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Seats: {usage.members}
                    {memberLimit !== null
                      ? ` / ${memberLimit}`
                      : ""}
                  </p>
                </div>

                <Link
                  href="/dashboard/settings/users"
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                >
                  <span className="text-lg leading-none">+</span>
                  Invite user
                </Link>
              </div>

              <div className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                {members.map((member) => {
                  const isOwner =
                    member.role === "owner";
                  const isCurrent =
                    member.id ===
                    currentMemberId;
                  const active =
                    activeMemberIds.has(
                      member.id,
                    );

                  const accessLabel =
                    !active
                      ? "No access"
                      : isOwner
                        ? "Owner"
                        : "Team member";

                  return (
                    <div
                      key={member.id}
                      className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.95fr)_auto] md:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {member.profile_picture_url ? (
                          <img
                            src={member.profile_picture_url}
                            alt=""
                            className="h-11 w-11 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-700">
                            {initial(
                              member.full_name,
                            )}
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-slate-900">
                              {member.full_name}
                            </p>

                            {isCurrent ? (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
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
                          {accessLabel}
                        </span>

                        <p className="mt-1 text-xs text-slate-500">
                          {!active
                            ? "No access to this subscription"
                            : isOwner
                              ? "Full access and subscription control"
                              : "Can work in channels and the inbox"}
                        </p>
                      </div>

                      <div
                        className="relative flex justify-end"
                        data-member-access-menu
                      >
                        {isCurrent &&
                        active ? (
                          <span className="inline-flex min-w-[160px] items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600">
                            {accessLabel}
                            <span className="text-slate-400">⌄</span>
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={
                                !canManage ||
                                savingId ===
                                  member.id
                              }
                              onClick={() =>
                                setMemberActionMenuId(
                                  (current) =>
                                    current ===
                                    member.id
                                      ? null
                                      : member.id,
                                )
                              }
                              className="inline-flex min-w-[160px] items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {savingId ===
                              member.id
                                ? "Saving..."
                                : accessLabel}
                              <span className="ml-3 text-slate-400">⌄</span>
                            </button>

                            {memberActionMenuId ===
                            member.id ? (
                              <div className="absolute right-0 top-12 z-40 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                                {active &&
                                isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMemberActionMenuId(
                                        null,
                                      );
                                      disableOwnerShare(
                                        member,
                                      );
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                                  >
                                    Team member
                                  </button>
                                ) : null}

                                {active &&
                                !isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMemberActionMenuId(
                                        null,
                                      );
                                      shareOwner(
                                        member,
                                      );
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                                  >
                                    Owner
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setMemberActionMenuId(
                                      null,
                                    );
                                    toggleMember(
                                      member,
                                    );
                                  }}
                                  className={`flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
                                    active
                                      ? "text-red-600 hover:bg-red-50"
                                      : "text-emerald-700 hover:bg-emerald-50"
                                  }`}
                                >
                                  {active
                                    ? "No access"
                                    : "Restore access"}
                                </button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

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

                <Link
                  href="/dashboard/settings/users"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  View detailed permissions →
                </Link>
              </div>

              <div className="mt-3 overflow-x-auto">
                <div className="min-w-[720px]">
                  <div className="grid grid-cols-[1.1fr_repeat(4,1fr)] border-b border-slate-200 text-center text-xs font-semibold text-slate-600">
                    <div className="px-3 py-3 text-left" />
                    <div className="px-3 py-3">Inbox</div>
                    <div className="px-3 py-3">Manage channels</div>
                    <div className="px-3 py-3">Manage users</div>
                    <div className="px-3 py-3">Billing</div>
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
                        key={String(
                          label,
                        )}
                        className="grid grid-cols-[1.1fr_repeat(4,1fr)] border-b border-slate-100 text-center text-sm last:border-b-0"
                      >
                        <div className="px-3 py-3 text-left font-semibold text-slate-700">
                          {String(
                            label,
                          )}
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
                              key={
                                index
                              }
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
                  Connect your first customer channel to start receiving conversations.
                </p>
              </div>
            ) : (
              <div className="max-h-[380px] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                {connections.map(
                  (connection) => {
                    const name =
                      connection.account_name ??
                      "Connected channel";

                    return (
                      <div
                        key={
                          connection.id
                        }
                        className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
                            {initial(
                              name,
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold text-slate-900">
                                {name}
                              </p>
                              <ChannelStatusPill
                                active={
                                  connection.is_active
                                }
                              />
                            </div>

                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                              {connection.platform ===
                              "facebook"
                                ? "Facebook Messenger"
                                : connection.platform ===
                                    "telegram"
                                  ? "Telegram"
                                  : connection.platform}
                            </p>

                            <p className="mt-1 break-all text-xs text-slate-500">
                              Account ID:{" "}
                              {connection.platform_account_id ??
                                "—"}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={
                            !canManage ||
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
                      </div>
                    );
                  },
                )}
              </div>
            )}
          </section>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-xs leading-5 text-slate-500 shadow-sm">
          <p>
            Removing a user&apos;s access only removes them from this subscription. Their TENH account, history, and access to other subscriptions stay unchanged.
          </p>
          <p className="mt-1">
            Disabling a channel frees its slot and blocks that channel from Inbox while keeping existing TENH customer and message history.
          </p>
        </div>
      </div>
    </div>
  );
}
