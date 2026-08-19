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

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5 sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
              Subscription usage
            </p>
            <h2 className="mt-1 text-2xl font-bold text-slate-950">
              Manage workspace capacity
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Active users consume user seats. Active customer channels consume channel slots.
            </p>
            <p className="mt-2 text-xs font-semibold text-blue-700">
              Managing subscription: {subscriptionLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200"
            aria-label="Close usage management"
          >
            ×
          </button>
        </div>

        <div className="border-b border-slate-200 px-6 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-7">
            <button
              type="button"
              onClick={() => setTab("connections")}
              className={`border-b-2 py-4 text-sm font-semibold transition ${
                tab === "connections"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Channels ({usage.channels}
              {channelLimit !== null
                ? `/${channelLimit}`
                : ""}
              )
            </button>

            <button
              type="button"
              onClick={() => setTab("members")}
              className={`border-b-2 py-4 text-sm font-semibold transition ${
                tab === "members"
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Users ({usage.members}
              {memberLimit !== null
                ? `/${memberLimit}`
                : ""}
              )
            </button>
            </div>

          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-7">
          {!loading && !hasSafeMutationContext ? (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
              TENH cannot safely identify this subscription. Editing is locked until you reload the page and confirm the subscription ID.
            </div>
          ) : null}

          {!canManage && hasSafeMutationContext && !loading ? (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              Only workspace Owners can manage user access or disconnect channels. You can still review current usage.
            </div>
          ) : null}

          {error ? (
            <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-7 text-sm font-medium text-slate-500">
              Loading workspace usage...
            </div>
          ) : tab === "connections" ? (
            <div>
              <div className="mb-5 flex flex-col justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-semibold text-slate-900">
                    Workspace channels
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Each enabled channel uses one workspace channel slot. Owners can disable channels they are not using and enable them again later without deleting TENH history.
                  </p>
                </div>

                <Link
                  href="/dashboard/integrations"
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  + Connect channel
                </Link>
              </div>

              {connections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                  <p className="font-semibold text-slate-800">
                    No channels saved yet
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Connect your first customer channel to start receiving conversations.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {connections.map(
                    (connection) => {
                      const name =
                        connection.account_name ??
                        "Connected channel";

                      return (
                        <div
                          key={connection.id}
                          className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
                              {initial(name)}
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
                                {connection.platform === "facebook"
                                  ? "Facebook Messenger"
                                  : connection.platform === "telegram"
                                    ? "Telegram"
                                    : connection.platform}
                              </p>
                              <p className="mt-1 break-all text-xs text-slate-500">
                                Account ID: {connection.platform_account_id ?? "—"}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
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
                                className={`flex h-10 w-10 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  connection.is_active
                                    ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                }`}
                                aria-label={
                                  connection.is_active
                                    ? `Disable ${name}`
                                    : `Enable ${name}`
                                }
                                title={
                                  connection.is_active
                                    ? "Disable channel"
                                    : "Enable channel"
                                }
                              >
                                {savingId ===
                                connection.id ? (
                                  <span className="text-xs font-bold">…</span>
                                ) : (
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    className="h-5 w-5"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M12 2v10"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M6.2 5.8a8 8 0 1 0 11.6 0"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-5 flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="font-semibold text-slate-900">
                    Active team-member seats
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Users without access keep their TENH history but cannot open this subscription or Inbox and do not consume an active seat.
                  </p>
                </div>

                <Link
                  href="/dashboard/settings/users"
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  User permissions
                </Link>
              </div>

              <div className="space-y-3">
                {members.map((member) => {
                  const isOwner =
                    member.role === "owner";
                  const isCurrent =
                    member.id ===
                    data?.currentMemberId;
                  const active =
                    activeMemberIds.has(
                      member.id,
                    );

                  return (
                    <div
                      key={member.id}
                      className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700">
                          {initial(
                            member.full_name,
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-slate-900">
                              {member.full_name}
                            </p>
                            <StatusPill
                              active={active}
                            />
                            {isOwner ? (
                              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                                Owner
                              </span>
                            ) : null}
                            {isCurrent ? (
                              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
                                You
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {member.email ?? "No email"}
                          </p>
                        </div>
                      </div>

                      <div className="relative flex shrink-0 items-center justify-end" data-member-access-menu>
                        {isCurrent && active ? (
                          <span className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-500">
                            Current access
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={
                                !canManage ||
                                savingId === member.id
                              }
                              onClick={() =>
                                setMemberActionMenuId(
                                  (current) =>
                                    current === member.id
                                      ? null
                                      : member.id,
                                )
                              }
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`Edit ${member.full_name} access`}
                              title="Edit access"
                            >
                              {savingId === member.id ? (
                                <span className="text-xs font-semibold">…</span>
                              ) : (
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M12 20h9"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </button>

                            {memberActionMenuId === member.id ? (
                              <div className="absolute bottom-12 right-0 z-30 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                                {active && isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMemberActionMenuId(null);
                                      disableOwnerShare(member);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-amber-700 transition hover:bg-amber-50"
                                  >
                                    Disable Owner Share
                                  </button>
                                ) : null}

                                {active && !isOwner ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMemberActionMenuId(null);
                                      shareOwner(member);
                                    }}
                                    className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                                  >
                                    Share Owner
                                  </button>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setMemberActionMenuId(null);
                                    toggleMember(member);
                                  }}
                                  className={`flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
                                    active
                                      ? "text-red-600 hover:bg-red-50"
                                      : "text-emerald-700 hover:bg-emerald-50"
                                  }`}
                                >
                                  {active
                                    ? "Remove access"
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
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 text-xs leading-5 text-slate-500 sm:px-7">
          <p>
            Removing a user's access only removes them from this subscription. Their TENH account, history, and access to other subscriptions stay unchanged.
          </p>
          <p>
            Disabling a channel frees its slot and blocks that channel from Inbox while keeping existing TENH customer and message history.
          </p>
        </div>
      </div>

    </div>
  );
}
