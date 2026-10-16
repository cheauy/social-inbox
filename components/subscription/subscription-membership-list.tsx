"use client";

import { invalidateWorkspaceRead, readWorkspaces } from "@/lib/workspaces/read-workspaces";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CancelPaymentButton } from "./cancel-payment-button";
import type { SubscriptionPendingPayment } from "@/lib/billing/subscription-pending-payments";

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
    <div className="min-w-0">
      <table className="block w-full border-collapse text-left @min-[900px]:table">
        <thead className="sr-only @min-[900px]:not-sr-only @min-[900px]:table-header-group">
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

        <tbody className="grid gap-3 p-3 @min-[640px]:grid-cols-2 @min-[900px]:table-row-group @min-[900px]:divide-y @min-[900px]:divide-slate-100 @min-[900px]:p-0">
          {items.length === 0 ? (
            <tr className="col-span-full block @min-[900px]:table-row">
              <td
                colSpan={expired ? 7 : 6}
                className="block px-5 py-8 text-center text-sm text-slate-500 @min-[900px]:table-cell"
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
                  className={`relative grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-slate-200 p-4 cursor-pointer transition @min-[900px]:table-row @min-[900px]:rounded-none @min-[900px]:border-0 @min-[900px]:p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                    active
                      ? expired
                        ? "bg-amber-50/50 ring-1 ring-inset ring-amber-300"
                        : "bg-blue-50/40 ring-1 ring-inset ring-blue-500"
                      : "bg-white hover:bg-slate-50/80"
                  }`}
                >
                  <td className="absolute right-4 top-4 @min-[900px]:static @min-[900px]:px-4 @min-[900px]:py-4 @min-[900px]:align-middle">
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

                  <td className="col-span-2 min-w-0 pr-8 @min-[900px]:px-3 @min-[900px]:py-4 @min-[900px]:align-middle">
                    <div className="flex min-w-0 items-center gap-3 @min-[900px]:min-w-[220px]">
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
                        {subscription && !expired ? <p className="mt-1 text-xs text-slate-600">{t("Current plan", "គម្រោងបច្ចុប្បន្ន")}: {subscription.plan_code.toUpperCase()}</p> : null}
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

                  <td data-label={t("Connections", "ការតភ្ជាប់")} className="min-w-0 before:mb-1 before:block before:text-xs before:font-medium before:text-slate-500 before:content-[attr(data-label)] @min-[900px]:px-3 @min-[900px]:py-4 @min-[900px]:align-middle @min-[900px]:before:hidden">
                    {subscription ? (
                      <div className="min-w-0 @min-[900px]:min-w-[100px]">
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

                  <td data-label={t("Users", "អ្នកប្រើប្រាស់")} className="min-w-0 before:mb-1 before:block before:text-xs before:font-medium before:text-slate-500 before:content-[attr(data-label)] @min-[900px]:px-3 @min-[900px]:py-4 @min-[900px]:align-middle @min-[900px]:before:hidden">
                    {subscription ? (
                      <div className="min-w-0 @min-[900px]:min-w-[100px]">
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

                  <td data-label={t("Subtotal", "សរុបរង")} className="min-w-0 before:mb-1 before:block before:text-xs before:font-medium before:text-slate-500 before:content-[attr(data-label)] @min-[900px]:px-3 @min-[900px]:py-4 @min-[900px]:align-middle @min-[900px]:before:hidden text-sm font-semibold text-slate-800">
                    {subscription
                      ? formatSubtotal(
                          subscription.last_paid_amount,
                          subscription.last_paid_currency,
                        )
                      : "—"}
                  </td>

                  <td data-label={t("Status", "ស្ថានភាព")} className="min-w-0 before:mb-1 before:block before:text-xs before:font-medium before:text-slate-500 before:content-[attr(data-label)] @min-[900px]:px-3 @min-[900px]:py-4 @min-[900px]:align-middle @min-[900px]:before:hidden">
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
                    <td className="col-span-2 min-w-0 @min-[900px]:px-3 @min-[900px]:py-4 @min-[900px]:align-middle">
                      {item.role === "owner" && renewalUrl ? (
                        <button
                          type="button"
                          disabled={Boolean(switching)}
                          onClick={(event) => {
                            event.stopPropagation();
                            onReactivate(item, renewalUrl);
                          }}
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 @min-[900px]:w-auto text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {switching === item.businessId
                            ? t("Opening…", "កំពុងបើក…")
                            : t("Reactivate", "ធ្វើឲ្យសកម្មវិញ")}
                        </button>
                      ) : (
                        /*
                         * No action for a trial, by design. Reactivate renews at
                         * the price already paid, and a trial has none -- a
                         * finished trial is meant to finish, not to be revived.
                         * Buying a plan is a new subscription, which the
                         * Subscription page handles.
                         */
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
  const [payments, setPayments] = useState<SubscriptionPendingPayment[]>([]);
  const [paymentError, setPaymentError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(0);
  const request = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const clock = useRef({ time: 0, start: 0 });
  const [filter, setFilter] = useState<"all" | "owned" | "joined">("all");
  const [sort, setSort] = useState<"current" | "name">("current");

  const load = useCallback(async (replace = false) => {
    if (inFlight.current && !replace) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const generation = ++request.current;
    const started = performance.now();
    inFlight.current = true;
    setRefreshing(true);
    setError(null);
    try {
      // Client identity pins the response; the endpoint authorizes every membership.
      const session = await createClient().auth.getSession();
      if (abort.signal.aborted || generation !== request.current) return;
      const userId = session.data.session?.user.id;
      if (session.error || !userId) { setItems([]); throw new Error("Sign in to view subscriptions."); }
      const paymentRequest = fetch("/api/subscription/pending-payments", { cache: "no-store", signal: abort.signal }).then(async response => ({ response, data: await response.json() as {
          success?: boolean; userId?: string; serverTime?: string; items?: SubscriptionPendingPayment[];
        } }));
      // Read entitlements after payment state, so a resolved attempt cannot leave an older Active snapshot behind.
      const workspaceRequest = paymentRequest.catch(() => null).then(() => {
        invalidateWorkspaceRead();
        return readWorkspaces(abort.signal);
      })
        .then(async response => ({ response, data: await response.json() as WorkspaceResponse }));
      const [workspaceResult, paymentResult] = await Promise.allSettled([workspaceRequest, paymentRequest]);
      if (abort.signal.aborted || generation !== request.current) return;
      if (workspaceResult.status !== "fulfilled" || !workspaceResult.value.response.ok || !workspaceResult.value.data.success) {
        if (workspaceResult.status === "fulfilled" && [401, 403].includes(workspaceResult.value.response.status)) setItems([]);
        throw new Error("Unable to load your subscriptions.");
      }
      const data = workspaceResult.value.data;
      setCurrentBusinessId(data.currentBusinessId ?? null);
      setItems(data.workspaces ?? []);
      if (paymentResult.status !== "fulfilled" || !paymentResult.value.response.ok || !paymentResult.value.data.success ||
        paymentResult.value.data.userId !== userId || !Array.isArray(paymentResult.value.data.items) ||
        !Number.isFinite(Date.parse(paymentResult.value.data.serverTime ?? ""))) {
        if (paymentResult.status === "fulfilled" && [401, 403].includes(paymentResult.value.response.status)) setItems([]);
        setPayments([]);
        setPaymentError(true);
      } else {
        const saved = paymentResult.value.data;
        const authorized = new Map((data.workspaces ?? []).filter(item => item.canManageBilling).map(item => [item.businessId, item.memberId]));
        const unique = new Map<string, SubscriptionPendingPayment>();
        for (const payment of saved.items ?? []) {
          if (authorized.get(payment.businessId) !== payment.memberId || !["pending", "submitted", "reconciliation_required"].includes(payment.status) ||
            !payment.resumeUrl.startsWith("/dashboard/subscription/payment?")) continue;
          unique.set(`${payment.kind}:${payment.businessId}:${payment.id}`, payment);
        }
        clock.current = { time: Date.parse(saved.serverTime!), start: started };
        setNow(clock.current.time + Math.max(0, performance.now() - started));
        setPayments([...unique.values()]);
        setPaymentError(false);
      }
    } catch (loadError) {
      if (abort.signal.aborted || generation !== request.current) return;
      setPayments([]);
      setPaymentError(true);
      setError(loadError instanceof Error ? loadError.message : "Unable to load your subscriptions.");
    } finally {
      if (!abort.signal.aborted && generation === request.current) {
        inFlight.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initialize an authenticated external-data subscription, including its busy state.
    void load();
    const recheck = () => { if (!document.hidden && navigator.onLine) { invalidateWorkspaceRead(); void load(); } };
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      ++request.current;
      controller.current?.abort();
      inFlight.current = false;
      invalidateWorkspaceRead();
      setItems([]);
      setPayments([]);
      setSelectedBusinessId(null);
      setCurrentBusinessId(null);
      if (session?.user) void load(true);
      else { setLoading(false); setRefreshing(false); }
    });
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      controller.current?.abort();
      inFlight.current = false;
      data.subscription.unsubscribe();
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [load]);

  useEffect(() => {
    if (!payments.some(payment => payment.status === "pending" && payment.expiresAt)) return;
    const timer = setInterval(() => {
      const time = clock.current.time + Math.max(0, performance.now() - clock.current.start);
      setNow(time);
      if (!payments.some(payment => payment.status === "pending" && payment.expiresAt && Date.parse(payment.expiresAt) > time)) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [payments]);

  useEffect(() => {
    if (!payments.length) return;
    let polls = 0;
    // Saved-state reads only, never provider verification. Focus/Refresh remains available after this bounded window.
    const timer = setInterval(() => {
      if (polls < 20 && !document.hidden && navigator.onLine && !inFlight.current) { polls += 1; void load(); }
    }, 30000);
    return () => clearInterval(timer);
  }, [payments.length, load]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve the initial selection callback after asynchronous memberships arrive.
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

  const visiblePayments = useMemo(() => {
    const workspaces = new Map(items.map(item => [item.businessId, item]));
    return payments.filter(payment => {
      const workspace = workspaces.get(payment.businessId);
      return workspace?.canManageBilling && workspace.memberId === payment.memberId &&
        (filter === "all" || (filter === "owned" ? workspace.role === "owner" : workspace.role !== "owner")) &&
        (payment.status !== "pending" || !payment.expiresAt || Date.parse(payment.expiresAt) > now);
    }).sort((a, b) => {
      if (sort === "current" && a.businessId !== b.businessId) {
        if (a.businessId === currentBusinessId) return -1;
        if (b.businessId === currentBusinessId) return 1;
      }
      return (workspaces.get(a.businessId)?.businessName ?? "").localeCompare(workspaces.get(b.businessId)?.businessName ?? "") || a.id.localeCompare(b.id);
    });
  }, [payments, items, filter, sort, currentBusinessId, now]);

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
    <div className="@container min-w-0 space-y-4">
      <section aria-busy={refreshing} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 @min-[900px]:flex-row @min-[900px]:items-center @min-[900px]:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-blue-600" aria-hidden="true">◉</span>
                <h2 className="text-base font-bold text-slate-950">
                  {t("Owned and joined subscriptions", "ការជាវដែលអ្នកជាម្ចាស់ និងបានចូលរួម")}
                </h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t("Subscriptions and payments across your workspaces.", "ការជាវ និងការទូទាត់នៅក្នុងកន្លែងធ្វើការរបស់អ្នក។")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={refreshing} onClick={() => { invalidateWorkspaceRead(); void load(); }} className="min-h-11 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50">
              {refreshing ? t("Refreshing…", "កំពុងផ្ទុក…") : t("Refresh", "ផ្ទុកឡើងវិញ")}
            </button>
            <label className="flex min-h-11 shrink-0 self-start items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
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
          </div>

          <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {(["all", "owned", "joined"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`min-h-11 min-w-[72px] rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
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

        {paymentError && !error ? <p role="alert" className="mx-5 mt-4 text-sm text-red-700">{t("Unable to load payments. Try Refresh.", "មិនអាចផ្ទុកការទូទាត់។ សូមផ្ទុកឡើងវិញ។")}</p> : null}

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
        {visiblePayments.length ? <ul aria-label={t("Payments", "ការទូទាត់")} className="divide-y divide-slate-100 border-t border-slate-200">
          {visiblePayments.map(payment => {
            const workspace = items.find(item => item.businessId === payment.businessId)!;
            const cycle = TENH_BILLING_CYCLES.find(cycle => cycle.id === payment.billingCycle);
            const term = isKhmer && cycle ? cycle.months === 12 ? "1 ឆ្នាំ" : `${cycle.months} ខែ` : cycle?.label ?? payment.billingCycle;
            const remaining = payment.expiresAt ? Math.max(0, Math.ceil((Date.parse(payment.expiresAt) - now) / 1000)) : 0;
            return <li key={`${payment.kind}:${payment.businessId}:${payment.id}`} className="grid min-w-0 gap-3 px-5 py-4 @min-[640px]:grid-cols-[minmax(0,1fr)_auto] @min-[900px]:grid-cols-[minmax(0,1fr)_auto_auto] @min-[900px]:items-center">
              <div className="min-w-0 @min-[640px]:col-span-2 @min-[900px]:col-span-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-bold text-slate-950">{workspace.businessName}</p>
                  {payment.status !== "reconciliation_required" ? <CancelPaymentButton kind={payment.kind} paymentId={payment.id} businessId={payment.businessId} submitted={payment.status === "submitted"}
                    onResult={outcome => {
                      setPayments(saved => ["cancelled", "checkout_closed", "expired", "paid"].includes(outcome) ? saved.filter(item => !(item.kind === payment.kind && item.id === payment.id)) :
                        saved.map(item => item.kind === payment.kind && item.id === payment.id ? { ...item, status: "reconciliation_required" } : item));
                      void load(true);
                    }} /> : null}
                </div>
                <p className="mt-1 break-words text-xs text-slate-600">{t("Requested plan", "គម្រោងដែលបានស្នើ")}: <span className="font-semibold">{payment.planCode.toUpperCase()}</span> · {term}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-slate-800">{payment.amount !== null && payment.currency ? `${payment.currency} ${payment.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${payment.status === "submitted" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-800"}`}>
                  {payment.status === "reconciliation_required" ? t("Reconciliation required — do not pay again", "ត្រូវពិនិត្យការទូទាត់ — កុំទូទាត់ម្ដងទៀត") : payment.status === "submitted" ? t("Submitted for review", "បានដាក់ស្នើរង់ចាំពិនិត្យ") : t("Pending payment", "រង់ចាំការទូទាត់")}
                </span>
                {payment.status === "pending" && payment.expiresAt ? <time dateTime={payment.expiresAt} aria-label={t("Payment time remaining", "ពេលទូទាត់នៅសល់")} className="text-sm font-semibold tabular-nums text-slate-600">{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</time> : null}
              </div>
              <a href={payment.resumeUrl} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 @min-[640px]:col-span-2 @min-[900px]:col-span-1">
                {payment.status !== "pending" ? t("View status", "មើលស្ថានភាព") : t("Continue payment", "បន្តការទូទាត់")}
              </a>
            </li>;
          })}
        </ul> : null}
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
