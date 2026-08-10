"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

function getInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "T";
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p
        className={`text-lg font-bold ${
          danger && value > 0
            ? "text-red-600"
            : "text-slate-900"
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] font-medium text-slate-500">
        {label}
      </p>
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

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ??
              "Unable to load team workload.",
          );
        }

        setMembers(result.members ?? []);
        setBusinessId(
          result.businessId ?? null,
        );
        setCurrentMemberId(
          result.currentMemberId ?? null,
        );
        setUnassignedCount(
          Math.max(
            0,
            result.unassignedCount ?? 0,
          ),
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
        clearTimeout(
          refreshTimerRef.current,
        );
      }

      refreshTimerRef.current = setTimeout(
        () => {
          refreshTimerRef.current = null;
          void loadWorkload(true);
        },
        150,
      );
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
      ReturnType<typeof supabase.channel> | null =
      null;

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
        clearTimeout(
          refreshTimerRef.current,
        );
        refreshTimerRef.current = null;
      }

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, loadWorkload]);

  const recommendedMember = useMemo(
    () => {
      if (members.length === 0) {
        return null;
      }

      return [...members].sort(
        (first, second) => {
          if (
            first.activeCount !==
            second.activeCount
          ) {
            return (
              first.activeCount -
              second.activeCount
            );
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

          return (
            first.unreadCount -
            second.unreadCount
          );
        },
      )[0];
    },
    [members],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-slate-900">
              Team workload
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Active conversations and follow-up pressure.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadWorkload(true)
            }
            disabled={refreshing}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Unassigned queue
              </p>
              <p className="mt-1 text-sm text-amber-900">
                Conversations waiting for an agent
              </p>
            </div>

            <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-amber-500 px-2 text-sm font-bold text-white">
              {unassignedCount}
            </span>
          </div>
        </div>

        {recommendedMember ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Recommended next agent
            </p>
            <p className="mt-1 text-sm font-semibold text-emerald-900">
              {recommendedMember.fullName}
            </p>
            <p className="mt-0.5 text-xs text-emerald-700">
              {recommendedMember.activeCount} active · {recommendedMember.overdueReminders} overdue
            </p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((item) => (
              <div
                key={item}
                className="animate-pulse rounded-2xl border border-slate-200 p-4"
              >
                <div className="h-4 w-32 rounded bg-slate-200" />
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map(
                    (metric) => (
                      <div
                        key={metric}
                        className="h-14 rounded-xl bg-slate-100"
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No active team members found.
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((member, index) => {
              const isCurrent =
                member.memberId === currentMemberId;
              const isRecommended =
                recommendedMember?.memberId ===
                member.memberId;

              return (
                <div
                  key={member.memberId}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    {member.profilePictureUrl ? (
                      <img
                        src={member.profilePictureUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                        {getInitial(
                          member.fullName,
                        )}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {member.fullName}
                        </p>

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

                      <p className="mt-0.5 truncate text-xs capitalize text-slate-500">
                        {member.role}
                      </p>
                    </div>

                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      #{index + 1}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-2">
                    <Metric
                      label="Open"
                      value={member.openCount}
                    />
                    <Metric
                      label="Pending"
                      value={member.pendingCount}
                    />
                    <Metric
                      label="Unread"
                      value={member.unreadCount}
                    />
                    <Metric
                      label="Overdue"
                      value={
                        member.overdueReminders
                      }
                      danger
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Active workload
                    </span>
                    <span className="font-semibold text-slate-700">
                      {member.activeCount} conversation{member.activeCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
