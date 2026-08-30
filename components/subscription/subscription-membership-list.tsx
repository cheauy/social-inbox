"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

import {
  TENH_BILLING_CYCLES,
  type BillingCycle,
} from "@/lib/subscription/plan-catalog";

export type WorkspaceItem = {
  memberId: string;
  businessId: string;
  businessName: string;
  role: string;
  canManageBilling: boolean;
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
      return "bg-slate-100 text-slate-600";
    case "suspended":
      return "bg-red-100 text-red-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusLabel(status: string, isKhmer: boolean) {
  if (!status) return isKhmer ? "មិនស្គាល់" : "Unknown";
  if (isKhmer) {
    switch (status) {
      case "active": return "សកម្ម";
      case "trialing": return "កំពុងសាកល្បង";
      case "past_due": return "ហួសកាលកំណត់បង់ប្រាក់";
      case "expired": return "ផុតកំណត់";
      case "cancelled": return "បានលុបចោល";
      case "suspended": return "បានផ្អាក";
      default: return status;
    }
  }
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

export function isWorkspaceSubscriptionExpired(item: WorkspaceItem) {
  const subscription = item.subscription;
  if (!subscription || isUnpaidPurchasePlaceholder(item)) return false;

  if (["expired", "past_due", "cancelled"].includes(subscription.status)) {
    return true;
  }

  if (subscription.status === "active" || subscription.status === "trialing") {
    const periodEnd = subscription.current_period_end
      ? Date.parse(subscription.current_period_end)
      : Number.NaN;

    return Number.isFinite(periodEnd) && periodEnd <= Date.now();
  }

  return false;
}

function isExpiredItem(item: WorkspaceItem) {
  return isWorkspaceSubscriptionExpired(item);
}

function isVisibleCurrentItem(item: WorkspaceItem) {
  if (isUnpaidPurchasePlaceholder(item)) return false;
  return !isExpiredItem(item);
}

export function sameSubscriptionRenewalUrl(item: WorkspaceItem) {
  const subscription = item.subscription;

  const savedRenewalCents = Number(
    subscription?.pricing_snapshot?.renewal_total_cents,
  );
  const lastPaidAmount = Number(subscription?.last_paid_amount);
  const hasReusablePrice =
    (Number.isFinite(savedRenewalCents) && savedRenewalCents > 0) ||
    (Number.isFinite(lastPaidAmount) && lastPaidAmount > 0);

  if (
    item.role !== "owner" ||
    !subscription ||
    !isExpiredItem(item) ||
    !hasReusablePrice
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
      `&users=${subscription.member_limit}&renew=same` +
      `&purchase_business=${encodeURIComponent(item.businessId)}`
    );
  }

  if (["mini", "standard", "pro"].includes(subscription.plan_code)) {
    return (
      `/dashboard/subscription/payment?plan=${encodeURIComponent(
        subscription.plan_code,
      )}` +
      `&cycle=${encodeURIComponent(cycle)}&renew=same` +
      `&purchase_business=${encodeURIComponent(item.businessId)}`
    );
  }

  return null;
}

function percentage(used: number, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function tileClasses(seed: string, expired: boolean) {
  if (expired) {
    return "bg-orange-500";
  }

  const palettes = [
    "bg-blue-600",
    "bg-violet-600",
    "bg-cyan-600",
    "bg-indigo-600",
  ];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % palettes.length;
  }
  return palettes[hash] ?? palettes[0];
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
  isKhmer: boolean;
};

function SubscriptionTable({
  items,
  switching,
  selectedBusinessId,
  onSelect,
  onReactivate,
  emptyText,
  expired = false,
  isKhmer,
}: SubscriptionTableProps) {
  const t = (en: string, km: string) => (isKhmer ? km : en);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
            <th className="w-10 px-4 py-3" aria-label={t("Selected", "បានជ្រើស")} />
            <th className="px-3 py-3">{t("Subscription", "ការជាវ")}</th>
            <th className="px-3 py-3">{t("Connections", "ការតភ្ជាប់")}</th>
            <th className="px-3 py-3">{t("Users", "អ្នកប្រើប្រាស់")}</th>
            <th className="px-3 py-3">{t("Subtotal", "សរុបរង")}</th>
            <th className="px-3 py-3">{t("Status", "ស្ថានភាព")}</th>
            {expired ? <th className="px-3 py-3">{t("Expired / action", "ផុតកំណត់ / សកម្មភាព")}</th> : null}
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <tr>
              <td
                colSpan={expired ? 7 : 6}
                className="px-5 py-8 text-center text-sm text-slate-500"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const active = item.businessId === selectedBusinessId;
              const subscription = item.subscription;
              const subscriptionId = subscription?.id ?? item.businessId;
              const shortId = subscriptionId.slice(0, 8).toUpperCase();
              const renewalUrl = sameSubscriptionRenewalUrl(item);
              const effectiveStatus =
                subscription && isWorkspaceSubscriptionExpired(item)
                  ? "expired"
                  : subscription?.status ?? "";
              const connectionsPercent = subscription
                ? percentage(item.usage.channels, subscription.channel_limit)
                : 0;
              const membersPercent = subscription
                ? percentage(item.usage.members, subscription.member_limit)
                : 0;

              const selectRow = () => {
                // Local information selection only. Do not switch the authenticated workspace.
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
                  className={`cursor-pointer transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                    active
                      ? expired
                        ? "bg-amber-50/50 ring-1 ring-inset ring-amber-300"
                        : "bg-blue-50/40 ring-1 ring-inset ring-blue-500"
                      : "bg-white hover:bg-slate-50/80"
                  }`}
                >
                  <td className="px-4 py-4 align-middle">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                        active
                          ? expired
                            ? "border-amber-500"
                            : "border-blue-600"
                          : "border-slate-400"
                      }`}
                    >
                      {active ? (
                        <span
                          className={`h-2 w-2 rounded-full ${
                            expired ? "bg-amber-500" : "bg-blue-600"
                          }`}
                        />
                      ) : null}
                    </span>
                  </td>

                  <td className="px-3 py-4 align-middle">
                    <div className="flex min-w-[220px] items-center gap-3">
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-black text-white shadow-sm ${tileClasses(
                          shortId,
                          expired,
                        )}`}
                      >
                        {shortId.slice(0, 2)}
                      </span>

                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-slate-950">
                          #{shortId}
                        </p>
                        <p className="mt-0.5 max-w-[190px] truncate text-xs font-semibold text-slate-600">
                          {item.businessName || item.ownerName}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {item.role === "owner" ? (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">
                              {t("Owner", "ម្ចាស់")}
                            </span>
                          ) : (
                            <>
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">
                                {t("Owner", "ម្ចាស់")}: {item.ownerName}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                                {t("You: Agent", "អ្នក៖ ភ្នាក់ងារ")}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-4 align-middle">
                    {subscription ? (
                      <div className="min-w-[100px]">
                        <p className="text-xs font-semibold text-slate-800">
                          {item.usage.channels} / {subscription.channel_limit}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              expired ? "bg-orange-500" : "bg-blue-600"
                            }`}
                            style={{ width: `${connectionsPercent}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[9px] text-slate-400">
                          {connectionsPercent}%
                        </p>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>

                  <td className="px-3 py-4 align-middle">
                    {subscription ? (
                      <div className="min-w-[100px]">
                        <p className="text-xs font-semibold text-slate-800">
                          {item.usage.members} / {subscription.member_limit}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              expired ? "bg-orange-500" : "bg-blue-600"
                            }`}
                            style={{ width: `${membersPercent}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[9px] text-slate-400">
                          {membersPercent}%
                        </p>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>

                  <td className="px-3 py-4 align-middle text-sm font-semibold text-slate-800">
                    {subscription
                      ? formatSubtotal(
                          subscription.last_paid_amount,
                          subscription.last_paid_currency,
                        )
                      : "—"}
                  </td>

                  <td className="px-3 py-4 align-middle">
                    {subscription ? (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClasses(
                          effectiveStatus,
                        )}`}
                      >
                        {statusLabel(effectiveStatus, isKhmer)}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                        {t("Unmanaged", "មិនបានគ្រប់គ្រង")}
                      </span>
                    )}
                  </td>

                  {expired ? (
                    <td className="px-3 py-4 align-middle">
                      {item.role === "owner" && renewalUrl ? (
                        <button
                          type="button"
                          disabled={Boolean(switching)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onReactivate(item, renewalUrl);
                          }}
                          className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {switching === item.businessId
                            ? t("Opening…", "កំពុងបើក…")
                            : t("Reactivate", "ធ្វើឲ្យសកម្មវិញ")}
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
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  const [currentBusinessId, setCurrentBusinessId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "owned" | "joined">("all");
  const [sort, setSort] = useState<"current" | "name">("current");

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

  function reactivateSubscription(
    item: WorkspaceItem,
    renewalUrl: string,
  ) {
    if (switching) return;

    setError(null);
    setSwitching(item.businessId);

    /*
     * Expired workspaces are intentionally not valid active-workspace switch
     * targets. The payment page accepts purchase_business and authorizes the
     * Owner directly, so reactivation can target the exact preserved
     * subscription without mutating the header workspace cookie.
     */
    window.location.assign(renewalUrl);
  }

  function selectSubscription(item: WorkspaceItem) {
    setSelectedBusinessId(item.businessId);
    onSelectSubscription?.(item, item.businessId === currentBusinessId);
  }

  useEffect(() => {
    if (selectedBusinessId || items.length === 0) return;
    const initial =
      items.find(
        (item) =>
          item.businessId === currentBusinessId && isVisibleCurrentItem(item),
      ) ?? items.find(isVisibleCurrentItem) ?? null;

    if (!initial) return;
    setSelectedBusinessId(initial.businessId);
    onSelectSubscription?.(
      initial,
      initial.businessId === currentBusinessId,
    );
  }, [currentBusinessId, items, onSelectSubscription, selectedBusinessId]);

  const currentItems = useMemo(() => {
    let next = items.filter(isVisibleCurrentItem);
    if (filter === "owned") next = next.filter((item) => item.role === "owner");
    if (filter === "joined") next = next.filter((item) => item.role !== "owner");

    return [...next].sort((a, b) => {
      if (sort === "current") {
        if (a.businessId === currentBusinessId) return -1;
        if (b.businessId === currentBusinessId) return 1;
      }
      return (a.businessName || a.ownerName).localeCompare(
        b.businessName || b.ownerName,
      );
    });
  }, [currentBusinessId, filter, items, sort]);

  const expiredItems = useMemo(
    () => items.filter(isExpiredItem),
    [items],
  );

  if (loading) {
    return (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="h-4 w-48 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-72 max-w-full animate-pulse rounded bg-slate-100" />
        </div>
        <div className="space-y-3 p-5">
          {[0, 1].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-50" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-blue-600" aria-hidden="true">◉</span>
                <h2 className="text-base font-bold text-slate-950">
                  {t("Owned and joined subscriptions", "ការជាវដែលអ្នកជាម្ចាស់ និងបានចូលរួម")}
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t("All active subscriptions across owned and joined workspaces.", "ការជាវសកម្មទាំងអស់នៅក្នុងកន្លែងធ្វើការដែលអ្នកជាម្ចាស់ និងបានចូលរួម។")}
              </p>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              <span>{t("Sort by:", "តម្រៀបតាម៖")}</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as "current" | "name")}
                className="bg-transparent font-semibold text-slate-800 outline-none"
              >
                <option value="current">{t("Current first", "បច្ចុប្បន្នមុន")}</option>
                <option value="name">{t("Workspace name", "ឈ្មោះកន្លែងធ្វើការ")}</option>
              </select>
            </label>
          </div>

          <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["all", "owned", "joined"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`min-w-[72px] rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  filter === value
                    ? "bg-blue-50 text-blue-700 ring-1 ring-blue-400"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {value === "all"
                  ? t("All", "ទាំងអស់")
                  : value === "owned"
                    ? t("Owned", "ជាម្ចាស់")
                    : t("Joined", "បានចូលរួម")}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
          isKhmer={isKhmer}
          emptyText={t("No current subscriptions found.", "រកមិនឃើញការជាវបច្ចុប្បន្នទេ។")}
        />
      </section>

      {expiredItems.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500" aria-hidden="true">↶</span>
              <h2 className="text-base font-bold text-slate-950">
                {t("Expired subscriptions", "ការជាវដែលផុតកំណត់")}
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {t("Previous subscriptions are retained for your records.", "ការជាវពីមុនត្រូវបានរក្សាទុកសម្រាប់កំណត់ត្រារបស់អ្នក។")}
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
            isKhmer={isKhmer}
            emptyText={t("No expired subscriptions.", "គ្មានការជាវដែលផុតកំណត់ទេ។")}
            expired
          />
        </section>
      ) : null}
    </div>
  );
}
