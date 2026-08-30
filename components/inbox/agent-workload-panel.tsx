"use client";

import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  Clock3,
  Inbox,
  Mail,
  MessageCircleMore,
  RefreshCw,
  Star,
  UsersRound,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type AgentWorkload = {
  memberId: string;
  fullName: string;
  email: string;
  role: string;
  profilePictureUrl: string | null;
  openCount: number;
  pendingCount: number;
  activeCount: number;
  unreadCount: number;
  overdueReminders: number;
};

type WorkloadResponse = {
  success?: boolean;
  error?: string;
  businessId?: string;
  currentMemberId?: string;
  currentMemberRole?: string;
  unassignedCount?: number;
  members?: AgentWorkload[];
};

type WorkloadFilter =
  | "all"
  | "active"
  | "idle"
  | "overdue";

function getInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "T";
}

function formatRole(role: string) {
  if (!role) {
    return "Team member";
  }

  return role
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

function SummaryCard({
  label,
  value,
  helper,
  tone,
  icon,
}: {
  label: string;
  value: number;
  helper: string;
  tone: "amber" | "blue" | "violet" | "red";
  icon: ReactNode;
}) {
  const styles = {
    amber: {
      accent: "border-l-amber-400",
      iconWrap: "bg-amber-50 text-amber-500",
      label: "text-amber-600",
    },
    blue: {
      accent: "border-l-blue-400",
      iconWrap: "bg-blue-50 text-blue-500",
      label: "text-blue-600",
    },
    violet: {
      accent: "border-l-violet-400",
      iconWrap: "bg-violet-50 text-violet-500",
      label: "text-violet-600",
    },
    red: {
      accent: "border-l-red-400",
      iconWrap: "bg-red-50 text-red-500",
      label: "text-red-600",
    },
  }[tone];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-200 border-l-[3px] ${styles.accent} bg-white px-5 py-5 shadow-sm`}
    >
      <div className="flex items-center gap-4">
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${styles.iconWrap}`}
        >
          {icon}
        </div>

        <div className="min-w-0">
          <p className={`text-sm font-bold ${styles.label}`}>
            {label}
          </p>
          <p className="mt-0.5 text-3xl font-bold tracking-tight text-slate-950">
            {value}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {helper}
          </p>
        </div>
      </div>
    </div>
  );
}

export function AgentWorkloadPanel() {
  const [members, setMembers] =
    useState<AgentWorkload[]>([]);
  const [businessId, setBusinessId] =
    useState<string | null>(null);
  const [currentMemberId, setCurrentMemberId] =
    useState<string | null>(null);
  const [unassignedCount, setUnassignedCount] =
    useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<WorkloadFilter>("all");

  const refreshTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const loadWorkload = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const response = await fetch(
          "/api/team/workload",
          {
            cache: "no-store",
          },
        );

        const text = await response.text();

        let result: WorkloadResponse | null = null;

        if (text.trim()) {
          try {
            result = JSON.parse(
              text,
            ) as WorkloadResponse;
          } catch {
            throw new Error(
              "Workload API returned invalid JSON.",
            );
          }
        }

        if (!response.ok || !result?.success) {
          throw new Error(
            result?.error ??
              "Unable to load team workload.",
          );
        }

        setMembers(result.members ?? []);
        setBusinessId(result.businessId ?? null);
        setCurrentMemberId(
          result.currentMemberId ?? null,
        );
        setUnassignedCount(
          Math.max(0, result.unassignedCount ?? 0),
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load team workload.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadWorkload(false);
  }, [loadWorkload]);

  useEffect(() => {
    function scheduleRefresh() {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadWorkload(true);
      }, 150);
    }

    window.addEventListener(
      "tenh-workload-changed",
      scheduleRefresh,
    );

    if (!businessId) {
      return () => {
        window.removeEventListener(
          "tenh-workload-changed",
          scheduleRefresh,
        );
      };
    }

    const supabase = createClient();
    let cancelled = false;
    let channel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    void supabase.auth
      .getSession()
      .then(async ({ data, error: sessionError }) => {
        if (
          cancelled ||
          sessionError ||
          !data.session
        ) {
          return;
        }

        await supabase.realtime.setAuth(
          data.session.access_token,
        );

        if (cancelled) {
          return;
        }

        channel = supabase
          .channel(
            `tenh-workload-v2-13-${businessId}`,
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "conversations",
              filter: `business_id=eq.${businessId}`,
            },
            scheduleRefresh,
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "conversation_reminders",
              filter: `business_id=eq.${businessId}`,
            },
            scheduleRefresh,
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log(
                "[Tenh Workload V2.13A] ✅ REALTIME READY",
              );
            }
          });
      });

    return () => {
      cancelled = true;

      window.removeEventListener(
        "tenh-workload-changed",
        scheduleRefresh,
      );

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, loadWorkload]);

  const recommendedMember = useMemo(() => {
    if (members.length === 0) {
      return null;
    }

    return [...members].sort((first, second) => {
      if (first.activeCount !== second.activeCount) {
        return first.activeCount - second.activeCount;
      }

      if (
        first.overdueReminders !==
        second.overdueReminders
      ) {
        return (
          first.overdueReminders -
          second.overdueReminders
        );
      }

      return first.unreadCount - second.unreadCount;
    })[0];
  }, [members]);

  const totals = useMemo(
    () =>
      members.reduce(
        (result, member) => ({
          open: result.open + member.openCount,
          unread:
            result.unread + member.unreadCount,
          overdue:
            result.overdue + member.overdueReminders,
          active:
            result.active + member.activeCount,
        }),
        {
          open: 0,
          unread: 0,
          overdue: 0,
          active: 0,
        },
      ),
    [members],
  );

  const filteredMembers = useMemo(() => {
    if (statusFilter === "active") {
      return members.filter(
        (member) => member.activeCount > 0,
      );
    }

    if (statusFilter === "idle") {
      return members.filter(
        (member) => member.activeCount === 0,
      );
    }

    if (statusFilter === "overdue") {
      return members.filter(
        (member) => member.overdueReminders > 0,
      );
    }

    return members;
  }, [members, statusFilter]);

  return (
    <div className="w-full">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
            Operations
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-[34px]">
            Team workload
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-base">
            Monitor active conversations, unread pressure,
            unassigned work, and overdue follow-ups.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadWorkload(true)}
          disabled={refreshing}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw
            className={`h-4 w-4 ${
              refreshing ? "animate-spin" : ""
            }`}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Unassigned"
          value={unassignedCount}
          helper="Conversations waiting"
          tone="amber"
          icon={<UsersRound className="h-7 w-7" />}
        />
        <SummaryCard
          label="Open"
          value={totals.open}
          helper="Active conversations"
          tone="blue"
          icon={
            <MessageCircleMore className="h-7 w-7" />
          }
        />
        <SummaryCard
          label="Unread"
          value={totals.unread}
          helper="Conversations"
          tone="violet"
          icon={<Mail className="h-7 w-7" />}
        />
        <SummaryCard
          label="Overdue"
          value={totals.overdue}
          helper="Require attention"
          tone="red"
          icon={<Clock3 className="h-7 w-7" />}
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50/70 to-white p-5 shadow-sm sm:p-6">
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-28 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(245,158,11,0.28) 1.6px, transparent 1.6px)",
              backgroundSize: "14px 14px",
            }}
          />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4 sm:gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-amber-100 bg-amber-100/80 text-amber-500 shadow-sm">
                <UsersRound className="h-7 w-7" />
              </div>

              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-600 sm:text-sm">
                  Unassigned queue
                </p>
                <p className="mt-2 text-lg font-bold text-slate-950 sm:text-xl">
                  {unassignedCount} conversation
                  {unassignedCount === 1 ? "" : "s"} waiting
                  for an agent
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  These conversations are not yet assigned.
                </p>
              </div>
            </div>

            <Link
              href="/dashboard/inbox?assigned=unassigned"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
            >
              Assign now
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {recommendedMember ? (
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-emerald-50/60 to-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4 sm:gap-5">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white/90 text-emerald-500 shadow-sm">
                  <Star className="h-7 w-7 fill-current" />
                </div>

                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-600 sm:text-sm">
                    Recommended next agent
                  </p>
                  <p className="mt-2 truncate text-lg font-bold text-slate-950 sm:text-xl">
                    {recommendedMember.fullName}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                    <span className="text-emerald-700">
                      {recommendedMember.activeCount} active
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-slate-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {recommendedMember.overdueReminders} overdue
                    </span>
                  </p>
                </div>
              </div>

              <Link
                href={
                  recommendedMember.memberId ===
                  currentMemberId
                    ? "/dashboard/profile"
                    : "/dashboard/settings/users"
                }
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-emerald-300 bg-white px-5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
              >
                View profile
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Star className="h-7 w-7" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 sm:text-sm">
                  Recommended next agent
                </p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  No agent available
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Agent workload
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Overview of conversation load by agent.
            </p>
          </div>

          <div className="relative w-full sm:w-44">
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as WorkloadFilter,
                )
              }
              className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-4 pr-10 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All statuses</option>
              <option value="active">Active workload</option>
              <option value="idle">No workload</option>
              <option value="overdue">Overdue</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5 sm:p-6">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-16 animate-pulse rounded-xl bg-slate-100"
              />
            ))}
          </div>
        ) : error ? (
          <div className="p-5 sm:p-6">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          </div>
        ) : members.length === 0 ? (
          <div className="px-5 py-14 text-center sm:px-6">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <UsersRound className="h-6 w-6" />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-800">
              No active team members found.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                    <th className="px-6 py-4">Agent</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4 text-center">
                      Open
                    </th>
                    <th className="px-4 py-4 text-center">
                      Pending
                    </th>
                    <th className="px-4 py-4 text-center">
                      Unread
                    </th>
                    <th className="px-4 py-4 text-center">
                      Overdue
                    </th>
                    <th className="px-6 py-4 text-center">
                      Total conversations
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((member) => {
                    const isCurrent =
                      member.memberId === currentMemberId;
                    const isRecommended =
                      recommendedMember?.memberId ===
                      member.memberId;
                    const hasWork = member.activeCount > 0;

                    return (
                      <tr
                        key={member.memberId}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {member.profilePictureUrl ? (
                              <img
                                src={member.profilePictureUrl}
                                alt=""
                                className="h-11 w-11 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                                {getInitial(member.fullName)}
                              </div>
                            )}

                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">
                                {member.fullName}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                  {formatRole(member.role)}
                                </span>
                                {isCurrent ? (
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                    You
                                  </span>
                                ) : null}
                                {isRecommended ? (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                    Least busy
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-2 text-sm font-medium ${
                              hasWork
                                ? "text-amber-600"
                                : "text-emerald-600"
                            }`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${
                                hasWork
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                              }`}
                            />
                            {hasWork ? "Working" : "Available"}
                          </span>
                        </td>

                        <td className="px-4 py-4 text-center text-sm font-semibold text-slate-800">
                          {member.openCount}
                        </td>
                        <td className="px-4 py-4 text-center text-sm font-semibold text-slate-800">
                          {member.pendingCount}
                        </td>
                        <td className="px-4 py-4 text-center text-sm font-semibold text-slate-800">
                          {member.unreadCount}
                        </td>
                        <td
                          className={`px-4 py-4 text-center text-sm font-semibold ${
                            member.overdueReminders > 0
                              ? "text-red-600"
                              : "text-slate-800"
                          }`}
                        >
                          {member.overdueReminders}
                        </td>
                        <td className="px-6 py-4 text-center text-sm font-semibold text-slate-800">
                          {member.activeCount}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredMembers.length === 0 ? (
              <div className="border-t border-slate-100 px-5 py-10 text-center sm:px-6">
                <p className="text-sm font-semibold text-slate-800">
                  No agents match this filter.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Choose another status to see more agents.
                </p>
              </div>
            ) : totals.active === 0 &&
              statusFilter === "all" ? (
              <div className="flex items-center justify-center gap-4 border-t border-slate-100 px-5 py-9 sm:px-6">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-200">
                  <Inbox className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    No active workload right now
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Great job! There are no open or pending
                    conversations.
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
