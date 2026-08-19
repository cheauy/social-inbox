"use client";

import { useCallback, useEffect, useState } from "react";

import {
  TENH_BILLING_CYCLES,
  type BillingCycle,
} from "@/lib/subscription/plan-catalog";

export type WorkspaceItem = {
  memberId: string;
  businessId: string;
  businessName: string;
  role: string;
  ownerName: string;
  usage: {
    members: number;
    channels: number;
  };
  subscription: {
    id: string;
    plan_code: string;
    status: string;
    member_limit: number;
    channel_limit: number;
    current_period_end: string | null;
    billing_cycle: string | null;
    last_paid_amount: number | string | null;
    last_paid_currency: string | null;
    pricing_snapshot: Record<string, unknown> | null;
  } | null;
};

type WorkspaceResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  workspaces?: WorkspaceItem[];
};

function formatSubtotal(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
) {
  if (amount === null || amount === undefined || amount === "") {
    return "—";
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return "—";
  }

  const normalizedCurrency =
    currency?.trim().toUpperCase() || "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
    }).format(numericAmount);
  } catch {
    return `$${numericAmount.toFixed(2)}`;
  }
}

function statusClasses(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "trialing":
      return "bg-blue-100 text-blue-700";
    case "past_due":
      return "bg-amber-100 text-amber-700";
    case "expired":
    case "cancelled":
      return "bg-slate-200 text-slate-700";
    case "suspended":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusLabel(status: string) {
  if (!status) return "Unknown";
  return status
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isUnpaidPurchasePlaceholder(item: WorkspaceItem) {
  const subscription = item.subscription;
  if (!subscription) return false;

  const snapshot = subscription.pricing_snapshot ?? {};
  const createdUnpaid = snapshot.created_unpaid === true;
  const paymentCancelled = snapshot.payment_cancelled === true;
  const neverPaid =
    subscription.last_paid_amount === null ||
    subscription.last_paid_amount === undefined ||
    subscription.last_paid_amount === "" ||
    Number(subscription.last_paid_amount) <= 0;

  return createdUnpaid && neverPaid && (
    subscription.status === "expired" ||
    subscription.status === "cancelled" ||
    paymentCancelled
  );
}

function isExpiredItem(item: WorkspaceItem) {
  return (
    item.subscription?.status === "expired" &&
    !isUnpaidPurchasePlaceholder(item)
  );
}

function isVisibleCurrentItem(item: WorkspaceItem) {
  if (isUnpaidPurchasePlaceholder(item)) return false;
  return !isExpiredItem(item);
}

function sameSubscriptionRenewalUrl(item: WorkspaceItem) {
  const subscription = item.subscription;

  if (
    item.role !== "owner" ||
    !subscription ||
    !isExpiredItem(item) ||
    !subscription.last_paid_amount ||
    Number(subscription.last_paid_amount) <= 0
  ) {
    return null;
  }

  const cycle = TENH_BILLING_CYCLES.some(
    (entry) => entry.id === subscription.billing_cycle,
  )
    ? (subscription.billing_cycle as BillingCycle)
    : "monthly";

  if (subscription.plan_code === "custom") {
    return (
      `/dashboard/subscription/payment?plan=custom&cycle=${encodeURIComponent(
        cycle,
      )}` +
      `&connections=${subscription.channel_limit}` +
      `&users=${subscription.member_limit}&renew=same`
    );
  }

  if (["mini", "standard", "pro"].includes(subscription.plan_code)) {
    return (
      `/dashboard/subscription/payment?plan=${encodeURIComponent(
        subscription.plan_code,
      )}` +
      `&cycle=${encodeURIComponent(cycle)}&renew=same`
    );
  }

  return null;
}

type SubscriptionTableProps = {
  items: WorkspaceItem[];
  currentBusinessId: string | null;
  switching: string | null;
  selectedBusinessId: string | null;
  onSelect: (item: WorkspaceItem) => void;
  onReactivate: (item: WorkspaceItem, renewalUrl: string) => void;
  emptyText: string;
  expired?: boolean;
};

function SubscriptionTable({
  items,
  selectedBusinessId,
  switching,
  onSelect,
  onReactivate,
  emptyText,
  expired = false,
}: SubscriptionTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
            <th className="px-5 py-3 sm:px-6">Subscription ID</th>
            <th className="px-4 py-3">Connections</th>
            <th className="px-4 py-3">Users</th>
            <th className="px-4 py-3">Subtotal</th>
            <th className="px-5 py-3 sm:px-6">Status</th>
            {expired ? (
              <th className="px-5 py-3 sm:px-6">Action</th>
            ) : null}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={expired ? 6 : 5}
                className="px-5 py-8 text-center text-sm text-slate-500 sm:px-6"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const active = item.businessId === selectedBusinessId;
              const subscription = item.subscription;
              const subscriptionId =
                subscription?.id ?? item.businessId;
              const shortId = subscriptionId.slice(0, 8).toUpperCase();
              const renewalUrl = sameSubscriptionRenewalUrl(item);
              const selectRow = () => {
                // V3.11.31.27: row selection is local UI state only.
                // Do not switch the authenticated TENH workspace here.
                onSelect(item);
              };

              return (
                <tr
                  key={item.memberId}
                  role="button"
                  tabIndex={0}
                  onClick={selectRow}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectRow();
                    }
                  }}
                  className={`cursor-pointer transition hover:bg-blue-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                    active
                      ? expired
                        ? "bg-amber-50/60"
                        : "bg-blue-50/50"
                      : "bg-white"
                  }`}
                >
                  <td className="px-5 py-4 align-top sm:px-6">
                    <p className="font-mono text-sm font-bold text-slate-900">
                      #{shortId}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="max-w-[220px] truncate text-xs font-semibold text-slate-700">
                        {item.ownerName}
                      </span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        Owner
                      </span>
                      {item.role !== "owner" ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          You: Agent
                        </span>
                      ) : null}

                    </div>
                  </td>

                  <td className="px-4 py-4 align-top text-sm font-semibold text-slate-800">
                    {subscription
                      ? `${item.usage.channels} / ${subscription.channel_limit}`
                      : "—"}
                  </td>
                  <td className="px-4 py-4 align-top text-sm font-semibold text-slate-800">
                    {subscription
                      ? `${item.usage.members} / ${subscription.member_limit}`
                      : "—"}
                  </td>
                  <td className="px-4 py-4 align-top text-sm font-semibold text-slate-800">
                    {subscription
                      ? formatSubtotal(
                          subscription.last_paid_amount,
                          subscription.last_paid_currency,
                        )
                      : "—"}
                  </td>

                  <td className="px-5 py-4 align-top sm:px-6">
                    {subscription ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(
                          subscription.status,
                        )}`}
                      >
                        {statusLabel(subscription.status)}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                        Unmanaged
                      </span>
                    )}
                  </td>

                  {expired ? (
                    <td className="px-5 py-4 align-top sm:px-6">
                      {item.role === "owner" && renewalUrl ? (
                        <button
                          type="button"
                          disabled={Boolean(switching)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onReactivate(item, renewalUrl);
                          }}
                          className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {switching === item.businessId
                            ? "Opening…"
                            : "Reactivate"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SubscriptionMembershipList({
  onSelectSubscription,
}: {
  onSelectSubscription?: (item: WorkspaceItem, isCurrent: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [currentBusinessId, setCurrentBusinessId] =
    useState<string | null>(null);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces", {
        cache: "no-store",
      });
      const data = (await response.json()) as WorkspaceResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ?? "Unable to load your subscriptions.",
        );
      }

      setCurrentBusinessId(data.currentBusinessId ?? null);
      setItems(data.workspaces ?? []);
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

  async function reactivateSubscription(
    item: WorkspaceItem,
    renewalUrl: string,
  ) {
    if (switching) return;

    setError(null);

    // V3.11.31.15: Reactivation belongs to the exact expired subscription.
    // In the multi-subscription model, payment/security APIs resolve the
    // authenticated current business. Switch to the expired subscription
    // first so renew=same is validated against the correct subscription row.
    if (item.businessId === currentBusinessId) {
      window.location.assign(renewalUrl);
      return;
    }

    setSwitching(item.businessId);

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: item.businessId }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ?? "Unable to select the subscription for reactivation.",
        );
      }

      window.location.assign(renewalUrl);
    } catch (reactivateError) {
      setError(
        reactivateError instanceof Error
          ? reactivateError.message
          : "Unable to reactivate this subscription.",
      );
      setSwitching(null);
    }
  }

  function selectSubscription(item: WorkspaceItem) {
    setSelectedBusinessId(item.businessId);
    onSelectSubscription?.(item, item.businessId === currentBusinessId);
  }

  if (loading) {
    return (
      <section className="rounded-[24px] border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        Loading your subscriptions…
      </section>
    );
  }

  const currentItems = items.filter(isVisibleCurrentItem);
  const expiredItems = items.filter(isExpiredItem);

  return (
    <div className="space-y-6">
      <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
            Your subscription list
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            Owned and joined subscriptions
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Select a subscription to view its channels, customers, team, and
            billing details.
          </p>
        </div>

        {error ? (
          <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
            {error}
          </div>
        ) : null}

        <SubscriptionTable
          items={currentItems}
          currentBusinessId={currentBusinessId}
          selectedBusinessId={selectedBusinessId}
          switching={switching}
          onSelect={selectSubscription}
          onReactivate={(item, renewalUrl) =>
            void reactivateSubscription(item, renewalUrl)
          }
          emptyText="No current subscriptions found."
        />
      </section>

      {expiredItems.length > 0 ? (
        <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Expired
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Expired subscriptions
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Previous subscriptions stay here with their channels, team,
              customers, and message history preserved.
            </p>
          </div>

          <SubscriptionTable
            items={expiredItems}
            currentBusinessId={currentBusinessId}
            selectedBusinessId={selectedBusinessId}
            switching={switching}
            onSelect={selectSubscription}
            onReactivate={(item, renewalUrl) =>
              void reactivateSubscription(item, renewalUrl)
            }
            emptyText="No expired subscriptions."
            expired
          />
        </section>
      ) : null}
    </div>
  );
}
