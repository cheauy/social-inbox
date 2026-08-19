"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type WorkspaceItem = {
  businessId: string;
  businessName: string;
  ownerName: string;
  role: string;
  usage?: {
    members?: number;
    channels?: number;
  };
  subscription: {
    id: string;
    plan_code: string;
    status: string;
    member_limit: number;
    channel_limit: number;
  } | null;
};

type WorkspaceResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

type WorkspaceContextSwitcherProps = {
  compact?: boolean;
  className?: string;
};

function shortSubscriptionId(value: string | null | undefined) {
  const id = value?.trim();
  return id ? `#${id.slice(0, 8).toUpperCase()}` : "No subscription ID";
}

function planLabel(value: string | null | undefined) {
  const plan = value?.trim();
  if (!plan) return "No plan";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function statusLabel(value: string | null | undefined) {
  const status = value?.trim();
  if (!status) return "Unknown";
  return status
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClasses(status: string | null | undefined) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "trialing":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "past_due":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "suspended":
      return "border-red-200 bg-red-50 text-red-700";
    case "expired":
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function WorkspaceContextSwitcher({
  compact = false,
  className = "",
}: WorkspaceContextSwitcherProps) {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces", {
        method: "GET",
        cache: "no-store",
      });
      const result = (await response.json()) as WorkspaceResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to load your subscriptions.");
      }

      setData(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your subscriptions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workspaces = data?.workspaces ?? [];
  const currentBusinessId = data?.currentBusinessId ?? "";
  const current = useMemo(
    () => workspaces.find((item) => item.businessId === currentBusinessId) ?? null,
    [currentBusinessId, workspaces],
  );
  const usableWorkspaces = useMemo(
    () =>
      workspaces.filter((item) => {
        const status = item.subscription?.status;
        return status === "active" || status === "trialing";
      }),
    [workspaces],
  );
  const currentIsUsable = Boolean(
    current &&
      (current.subscription?.status === "active" ||
        current.subscription?.status === "trialing"),
  );

  async function switchWorkspace(nextBusinessId: string) {
    if (!nextBusinessId || nextBusinessId === currentBusinessId || switching) {
      return;
    }

    const target = usableWorkspaces.find(
      (item) => item.businessId === nextBusinessId,
    );
    if (!target) return;

    const targetId = shortSubscriptionId(target.subscription?.id);
    const confirmed = window.confirm(
      `Switch TENH to subscription ${targetId}? Integrations, Inbox, settings, users, and channel usage will then show only that subscription.`,
    );

    if (!confirmed) return;

    setSwitching(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: nextBusinessId }),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to switch subscription.");
      }

      // This is an explicit user-requested switch. Reload so every server and
      // client component uses the exact same workspace cookie and cannot mix data.
      window.location.reload();
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "Unable to switch subscription.",
      );
      setSwitching(false);
    }
  }

  if (loading) {
    return (
      <div
        className={`rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 ${className}`}
      >
        Loading current subscription…
      </div>
    );
  }

  if (!current || !currentIsUsable) {
    return (
      <div className={className}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-900">
            Select an active subscription
          </p>
          <p className="mt-1 text-[11px] leading-4 text-amber-800">
            Expired, past-due, suspended, or cancelled subscriptions are kept on the Subscription page but are not available in Settings, Integrations, or Inbox.
          </p>

          {usableWorkspaces.length > 0 ? (
            <label className="mt-3 block">
              <span className="sr-only">Select active TENH subscription</span>
              <select
                value=""
                disabled={switching}
                onChange={(event) => void switchWorkspace(event.target.value)}
                className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                aria-label="Select active TENH subscription"
              >
                <option value="" disabled>
                  Choose active subscription…
                </option>
                {usableWorkspaces.map((item) => {
                  const itemSubscription = item.subscription;
                  const itemUsage = item.usage;
                  const usageText = itemUsage
                    ? ` · ${itemUsage.channels ?? 0}/${itemSubscription?.channel_limit ?? "-"} channels`
                    : "";

                  return (
                    <option key={item.businessId} value={item.businessId}>
                      {shortSubscriptionId(itemSubscription?.id)} · {planLabel(itemSubscription?.plan_code)} · {statusLabel(itemSubscription?.status)}{usageText}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <p className="mt-3 text-[11px] font-semibold text-amber-900">
              No active or trial subscription is available. Open Subscription to reactivate or buy a plan.
            </p>
          )}
        </div>
        {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
      </div>
    );
  }

  const subscription = current.subscription;
  const subscriptionId = shortSubscriptionId(subscription?.id);
  const label = `${subscriptionId} · ${planLabel(subscription?.plan_code)}`;

  return (
    <div className={className}>
      <div
        className={`rounded-2xl border border-blue-100 bg-blue-50/70 ${
          compact ? "p-3" : "p-4"
        }`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
              Current subscription
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClasses(
                subscription?.status,
              )}`}
            >
              {statusLabel(subscription?.status)}
            </span>
          </div>

          <div>
            <p className={`${compact ? "text-sm" : "text-base"} font-bold text-slate-950`}>
              {label}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              {current.businessName || "TENH Workspace"} · {current.role}
            </p>
          </div>

          {usableWorkspaces.length > 1 ? (
            <label className="block">
              <span className="sr-only">Switch subscription</span>
              <select
                value={current.businessId}
                disabled={switching}
                onChange={(event) => void switchWorkspace(event.target.value)}
                className="mt-1 w-full rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                aria-label="Switch TENH subscription"
              >
                {usableWorkspaces.map((item) => {
                  const itemSubscription = item.subscription;
                  const itemUsage = item.usage;
                  const usageText = itemUsage
                    ? ` · ${itemUsage.channels ?? 0}/${itemSubscription?.channel_limit ?? "-"} channels`
                    : "";

                  return (
                    <option key={item.businessId} value={item.businessId}>
                      {shortSubscriptionId(itemSubscription?.id)} · {planLabel(itemSubscription?.plan_code)} · {statusLabel(itemSubscription?.status)}{usageText}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}

          <p className="text-[11px] leading-4 text-slate-500">
            TENH only shows and changes users, channels, Inbox data, and integrations for this subscription. Switching is never automatic here.
          </p>
        </div>
      </div>

      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
