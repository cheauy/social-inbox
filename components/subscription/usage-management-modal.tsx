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

type TelegramConnectionResponse = {
  success?: boolean;
  connection?: {
    id: string;
    botId: string | null;
    botName: string | null;
    username: string | null;
    isActive: boolean;
    status: string;
  } | null;
};

type UsageResponse = {
  success?: boolean;
  error?: string;
  details?: string;
  currentMemberId?: string;
  currentMemberRole?: string;
  canManage?: boolean;
  subscription?: {
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
      const [response, telegramResponse] =
        await Promise.all([
          fetch(
            "/api/subscription/usage-management",
            {
              method: "GET",
              cache: "no-store",
            },
          ),
          fetch(
            "/api/telegram/connection",
            {
              method: "GET",
              cache: "no-store",
            },
          ),
        ]);

      const result = await readResult(
        response,
      );

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to load workspace usage.",
        );
      }

      let telegramResult:
        | TelegramConnectionResponse
        | null = null;

      if (telegramResponse.ok) {
        try {
          telegramResult =
            (await telegramResponse.json()) as
              TelegramConnectionResponse;
        } catch {
          telegramResult = null;
        }
      }

      const existingConnections =
        result.connections ?? [];

      const telegram =
        telegramResult?.connection;

      const telegramConnection:
        | Connection
        | null =
        telegram?.isActive
          ? {
              id: telegram.id,
              platform: "telegram",
              platform_account_id:
                telegram.botId,
              account_name:
                telegram.botName ??
                (telegram.username
                  ? `@${telegram.username}`
                  : "Telegram Bot"),
              is_active: true,
              facebook_token_status: null,
            }
          : null;

      const mergedConnections =
        telegramConnection &&
        !existingConnections.some(
          (connection) =>
            connection.platform ===
            "telegram",
        )
          ? [
              ...existingConnections,
              telegramConnection,
            ]
          : existingConnections;

      const activeChannelCount =
        mergedConnections.filter(
          (connection) =>
            connection.is_active,
        ).length;

      const nextUsage = {
        members:
          result.usage?.members ?? 0,
        channels: Math.max(
          result.usage?.channels ?? 0,
          activeChannelCount,
        ),
      };

      const nextResult: UsageResponse = {
        ...result,
        connections: mergedConnections,
        usage: nextUsage,
      };

      setData(nextResult);

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
  }, [open, onClose]);

  const members = data?.members ?? [];
  const connections =
    data?.connections ?? [];
  const usage = data?.usage ?? {
    members: 0,
    channels: 0,
  };
  const subscription = data?.subscription;
  const canManage =
    data?.canManage === true;

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
          kind: "connection";
          id: string;
          active: false;
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
          body: JSON.stringify(body),
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

    if (member.role === "owner") {
      setError(
        "The workspace owner always occupies one seat. Transfer ownership before deactivating an owner.",
      );
      return;
    }

    const nextActive =
      !member.is_active;

    const confirmed = window.confirm(
      nextActive
        ? `Reactivate ${member.full_name}? This will use one active team-member seat.`
        : `Deactivate ${member.full_name}? They will lose TENH workspace access, but their history and activity records will be kept.`,
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

  function disconnect(
    connection: Connection,
  ) {
    if (!canManage) {
      return;
    }

    const name =
      connection.account_name ??
      "Connected channel";

    const confirmed = window.confirm(
      `Disconnect ${name}? New events will stop for this channel. Existing TENH customers, conversations, messages, and history will be kept.`,
    );

    if (!confirmed) {
      return;
    }

    void patch({
      kind: "connection",
      id: connection.id,
      active: false,
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

        <div className="min-h-0 flex-1 overflow-y-auto p-6 sm:p-7">
          {!canManage && !loading ? (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              Only the workspace owner can activate/deactivate users or disconnect channels. You can still review current usage.
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
                    Each connected account uses one workspace channel slot. Multiple TENH users can work from the same connected channel without using another slot.
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
                                <StatusPill
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
                            {connection.platform ===
                            "telegram" ? (
                              <Link
                                href="/dashboard/integrations"
                                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                              >
                                Manage channel
                              </Link>
                            ) : connection.is_active ? (
                              <button
                                type="button"
                                disabled={
                                  !canManage ||
                                  savingId ===
                                    connection.id
                                }
                                onClick={() =>
                                  disconnect(
                                    connection,
                                  )
                                }
                                className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingId ===
                                connection.id
                                  ? "Disconnecting..."
                                  : "Disconnect"}
                              </button>
                            ) : (
                              <Link
                                href="/dashboard/integrations"
                                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                              >
                                Manage channel
                              </Link>
                            )}
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
                    Deactivated members keep their TENH history but cannot access the workspace and do not consume an active seat.
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

                      <div className="flex shrink-0 items-center gap-2">
                        {isOwner ? (
                          <span className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-500">
                            Always active
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={
                              !canManage ||
                              savingId === member.id
                            }
                            onClick={() =>
                              toggleMember(member)
                            }
                            className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              active
                                ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            }`}
                          >
                            {savingId === member.id
                              ? "Saving..."
                              : active
                                ? "Deactivate"
                                : "Reactivate"}
                          </button>
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
            Disconnecting a channel or deactivating a user does not delete TENH customer/message history.
          </p>
          <p>
            Reconnecting a channel uses its authorization flow so TENH can refresh access and event subscriptions.
          </p>
        </div>
      </div>
    </div>
  );
}
