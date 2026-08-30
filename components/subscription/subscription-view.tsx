"use client";

import { CustomUpgradeModal } from "@/components/subscription/custom-upgrade-modal";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

import {
  UsageManagementModal,
} from "@/components/subscription/usage-management-modal";
import {
  SubscriptionMembershipList,
  isWorkspaceSubscriptionExpired,
  sameSubscriptionRenewalUrl,
  type WorkspaceItem,
} from "@/components/subscription/subscription-membership-list";
import {
  TENH_BILLING_CYCLES as cycles,
  TENH_PLANS as plans,
  calculatePlanTotalCents,
  calculateUpgradeTotalCents,
  formatUsdFromCents,
  type BillingCycle,
  type PlanCode,
} from "@/lib/subscription/plan-catalog";

type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "suspended"
  | "cancelled";

type CurrentSubscription = {
  id: string;
  business_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  member_limit: number;
  channel_limit: number;
  storage_limit_bytes: number | null;
  monthly_message_limit: number | null;
  payment_provider: string | null;
  billing_cycle: string | null;
  last_paid_amount: number | string | null;
  last_paid_currency: string | null;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionResponse = {
  success: boolean;
  error?: string;
  subscription?: CurrentSubscription | null;
  usage?: {
    members: number;
    channels: number;
  };
};

type PayWayPaymentState =
  | "idle"
  | "waiting"
  | "approved"
  | "pending"
  | "declined"
  | "cancelled"
  | "failed";

type CheckoutMethod = "payway" | "manual";

type ManualPaymentConfig = {
  enabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageUrl: string | null;
  supportText: string | null;
};

type ManualPaymentRequest = {
  id: string;
  planCode: string;
  billingCycle: string;
  amount: number;
  currency: string;
  status: "submitted" | "approved" | "rejected" | "cancelled";
  transferReference: string | null;
  proofFileName: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
};

type PlanChangeMode =
  | "active-paid"
  | "subscribe"
  | "suspended"
  | "unmanaged";

type PendingPlanChange = {
  type: "downgrade";
  planCode: string;
  billingCycle: string | null;
  requestedAt: string | null;
  effectiveAt: string | null;
};

type PlanChangeState = {
  mode: PlanChangeMode;
  canManage: boolean;
  isOwner: boolean;
  currentPlan: PlanCode | null;
  currentRank: number;
  usage: {
    members: number;
    channels: number;
  };
  pendingChange: PendingPlanChange | null;
};

type PlanAction =
  | "current"
  | "upgrade"
  | "buy-new"
  | "subscribe"
  | "blocked";

declare global {
  interface Window {
    TenhAbaPaywayBridge?: {
      isReady: () => boolean;
      checkout: () => void;
    };
  }
}

function formatDate(value: string | null, isKhmer = false) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(isKhmer ? "km-KH" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getStatusClasses(status: string) {
  switch (status) {
    case "trialing":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "past_due":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "expired":
      return "border-slate-200 bg-slate-50 text-slate-600";
    case "cancelled":
      return "border-slate-200 bg-slate-50 text-slate-600";
    case "suspended":
      return "border-red-200 bg-red-50 text-red-700";
  }
}

const planRanks: Record<PlanCode, number> = {
  mini: 1,
  standard: 2,
  pro: 3,
  custom: 4,
};

function getPlanAction(
  state: PlanChangeState | null,
  planCode: PlanCode,
): PlanAction {
  if (!state) {
    return "blocked";
  }

  if (state.mode === "suspended" || state.mode === "unmanaged") {
    return "blocked";
  }

  const targetPlan = plans.find((item) => item.id === planCode);

  if (!targetPlan) {
    return "blocked";
  }

  if (state.mode === "subscribe" || !state.currentPlan) {
    // Reactivating/replacing a preserved workspace is Owner-only. Team
    // members can always use Buy new subscription to create their own.
    if (!state.isOwner) return "blocked";

    return state.usage.members <= targetPlan.users &&
      state.usage.channels <= targetPlan.channels
      ? "subscribe"
      : "blocked";
  }

  const currentRank = planRanks[state.currentPlan];
  const targetRank = planRanks[planCode];

  if (targetRank === currentRank) {
    return "current";
  }

  if (targetRank < currentRank) {
    // This does NOT change the joined workspace. It opens Buy New, which
    // creates a separate workspace owned by the buyer.
    return "buy-new";
  }

  if (!state.canManage) {
    return "blocked";
  }

  return state.usage.members <= targetPlan.users &&
    state.usage.channels <= targetPlan.channels
      ? "upgrade"
      : "blocked";
}

function planActionLabel(action: PlanAction) {
  switch (action) {
    case "current":
      return "Current plan";
    case "upgrade":
      return "Upgrade";
    case "buy-new":
      return "New subscription";
    case "subscribe":
      return "Subscribe";
    case "blocked":
    default:
      return "Unavailable";
  }
}

function blockedPlanChangeMessage(reason: string | null) {
  switch (reason) {
    case "current-plan-active":
      return "That plan is already active for the current paid period. TENH blocked a duplicate subscription payment.";
    case "schedule-downgrade":
      return "A smaller package does not replace an active subscription. Buy it as a new subscription instead.";
    case "capacity":
      return "That plan does not fit the workspace's current active members or channels. Reduce usage before choosing it.";
    case "owner-only":
      return "Only the workspace owner can purchase or change the subscription plan.";
    case "suspended":
      return "This workspace is suspended. Contact TENH support before starting a payment.";
    case "unmanaged":
      return "Self-service billing is disabled for this legacy workspace because it does not have a managed subscription record.";
    default:
      return reason
        ? "TENH blocked that payment path because it is not allowed for the current subscription state."
        : null;
  }
}

function CalendarIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 3v3M17 3v3M4.5 9h15" />
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 13h3M13 13h3M8 16h3M13 16h3" />
    </svg>
  );
}

function CardIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  );
}

function PlanIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8 8h8M8 12h5M8 16h3" />
      <circle cx="16" cy="16" r="2" />
    </svg>
  );
}

function ChannelIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 12a4 4 0 1 1 4 4H8a4 4 0 0 1 0-8h1" />
      <path d="M16 12a4 4 0 1 0-4-4h4a4 4 0 0 1 0 8h-1" />
    </svg>
  );
}

function UsersIcon({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.5-3.4 2.3-5.2 5.5-5.2s5 1.8 5.5 5.2" />
      <path d="M15 6.2a2.6 2.6 0 0 1 0 5.1M16 14c2.7.4 4.1 2 4.5 5" />
    </svg>
  );
}


function usagePercent(used: number, limit: number) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

function daysUntil(value: string | null) {
  if (!value) return null;
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return null;
  const days = Math.ceil((target - Date.now()) / 86_400_000);
  return days >= 0 ? days : null;
}

export function SubscriptionView() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);

  function statusText(status: string) {
    if (!isKhmer) return status;
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
  const searchParams = useSearchParams();
  const [selectedListItem, setSelectedListItem] =
    useState<WorkspaceItem | null>(null);
  const [selectedListItemIsCurrent, setSelectedListItemIsCurrent] =
    useState(false);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState<string | null>(null);
  const [subscription, setSubscription] =
    useState<CurrentSubscription | null>(null);
  const [usage, setUsage] = useState({
    members: 0,
    channels: 0,
  });
  const [modalOpen, setModalOpen] =
    useState(false);
  const [usageManagerOpen, setUsageManagerOpen] =
    useState(false);
  const [usageManagerTab, setUsageManagerTab] =
    useState<"connections" | "members">(
      "connections",
    );
  const [cycle, setCycle] =
    useState<BillingCycle>("monthly");
  const [selectedPlan, setSelectedPlan] =
    useState<PlanCode | null>(null);
  const [planChangeState, setPlanChangeState] =
    useState<PlanChangeState | null>(null);
  const [planChangeLoading, setPlanChangeLoading] =
    useState(true);
  const [planChangeSubmitting, setPlanChangeSubmitting] =
    useState(false);
  const [planChangeError, setPlanChangeError] =
    useState<string | null>(null);
  const [planChangeNotice, setPlanChangeNotice] =
    useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] =
    useState(false);
  const [checkoutError, setCheckoutError] =
    useState<string | null>(null);
  const [payWayPluginReady, setPayWayPluginReady] =
    useState(false);
  const [payWayTransactionId, setPayWayTransactionId] =
    useState<string | null>(null);
  const [payWayPaymentState, setPayWayPaymentState] =
    useState<PayWayPaymentState>("idle");
  const [payWayStatusText, setPayWayStatusText] =
    useState<string | null>(null);
  const [checkoutMethod, setCheckoutMethod] =
    useState<CheckoutMethod>("payway");
  const [manualPaymentConfig, setManualPaymentConfig] =
    useState<ManualPaymentConfig | null>(null);
  const [manualPaymentRequest, setManualPaymentRequest] =
    useState<ManualPaymentRequest | null>(null);
  const [manualPaymentLoading, setManualPaymentLoading] =
    useState(true);
  const [manualPaymentSubmitting, setManualPaymentSubmitting] =
    useState(false);
  const [manualPaymentError, setManualPaymentError] =
    useState<string | null>(null);
  const [manualCustomerNote, setManualCustomerNote] =
    useState("");
  const [manualProof, setManualProof] =
    useState<File | null>(null);

  const refreshPlanChangeState =
    useCallback(async () => {
      setPlanChangeLoading(true);

      try {
        const response = await fetch(
          "/api/subscription/plan-change",
          { cache: "no-store" },
        );

        const result = (await response.json()) as {
          success?: boolean;
          error?: string;
          mode?: PlanChangeMode;
          canManage?: boolean;
          isOwner?: boolean;
          currentPlan?: PlanCode | null;
          currentRank?: number;
          usage?: { members: number; channels: number };
          pendingChange?: PendingPlanChange | null;
        };

        if (!response.ok || !result.success || !result.mode) {
          throw new Error(
            result.error ??
              "Unable to load plan-change security state.",
          );
        }

        setPlanChangeState({
          mode: result.mode,
          canManage: result.canManage === true,
          isOwner: result.isOwner === true,
          currentPlan: result.currentPlan ?? null,
          currentRank: result.currentRank ?? 0,
          usage: result.usage ?? { members: 0, channels: 0 },
          pendingChange: result.pendingChange ?? null,
        });
        setPlanChangeError(null);
      } catch (loadError) {
        setPlanChangeState(null);
        setPlanChangeError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load plan-change security state.",
        );
      } finally {
        setPlanChangeLoading(false);
      }
    }, []);

  useEffect(() => {
    void refreshPlanChangeState();
  }, [refreshPlanChangeState]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;

    function detectPayWayPlugin() {
      if (cancelled) {
        return;
      }

      const ready =
        window.TenhAbaPaywayBridge?.isReady() === true;

      if (ready) {
        setPayWayPluginReady(true);
        setCheckoutError((current) =>
          current?.startsWith("Unable to load PayWay secure checkout")
            ? null
            : current,
        );
        return;
      }

      attempts += 1;

      if (attempts < 120) {
        timer = window.setTimeout(
          detectPayWayPlugin,
          250,
        );
        return;
      }

      setPayWayPluginReady(false);
      setCheckoutError(
        "Unable to initialize PayWay secure checkout. Refresh the page and try again.",
      );
    }

    timer = window.setTimeout(detectPayWayPlugin, 100);

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSubscription() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          "/api/subscription/current",
          { cache: "no-store" },
        );

        const result =
          (await response.json()) as SubscriptionResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ??
              "Unable to load subscription.",
          );
        }

        if (!cancelled) {
          setSubscription(
            result.subscription ?? null,
          );
          setUsage(
            result.usage ?? {
              members: 0,
              channels: 0,
            },
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load subscription.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSubscription();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadManualPayment() {
      setManualPaymentLoading(true);
      setManualPaymentError(null);

      try {
        const response = await fetch(
          "/api/manual-payments",
          { cache: "no-store" },
        );

        const result = (await response.json()) as {
          success?: boolean;
          error?: string;
          config?: ManualPaymentConfig;
          request?: ManualPaymentRequest | null;
        };

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ??
              "Unable to load manual payment information.",
          );
        }

        if (!cancelled) {
          const latestRequest = result.request ?? null;

          setManualPaymentConfig(result.config ?? null);
          setManualPaymentRequest(latestRequest);

          if (
            latestRequest &&
            (latestRequest.status === "submitted" ||
              latestRequest.status === "rejected")
          ) {
            setCheckoutMethod("manual");

            if (
              plans.some(
                (plan) => plan.id === latestRequest.planCode,
              )
            ) {
              setSelectedPlan(
                latestRequest.planCode as PlanCode,
              );
            }

            if (
              cycles.some(
                (item) => item.id === latestRequest.billingCycle,
              )
            ) {
              setCycle(
                latestRequest.billingCycle as BillingCycle,
              );
            }
          }
        }
      } catch (manualLoadError) {
        if (!cancelled) {
          setManualPaymentConfig(null);
          setManualPaymentError(
            manualLoadError instanceof Error
              ? manualLoadError.message
              : "Unable to load manual payment information.",
          );
        }
      } finally {
        if (!cancelled) {
          setManualPaymentLoading(false);
        }
      }
    }

    void loadManualPayment();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (manualPaymentRequest?.status !== "submitted") {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refreshManualStatus() {
      try {
        const response = await fetch(
          "/api/manual-payments",
          { cache: "no-store" },
        );
        const result = (await response.json()) as {
          success?: boolean;
          request?: ManualPaymentRequest | null;
        };

        if (
          !cancelled &&
          response.ok &&
          result.success &&
          result.request
        ) {
          setManualPaymentRequest(result.request);

          if (result.request.status === "approved") {
            window.setTimeout(() => {
              window.location.assign(
                "/dashboard/subscription?manual=approved",
              );
            }, 800);
            return;
          }
        }
      } catch {
        // Keep the submitted state visible; a later poll can recover.
      }

      if (!cancelled) {
        timer = setTimeout(refreshManualStatus, 5000);
      }
    }

    timer = setTimeout(refreshManualStatus, 5000);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [manualPaymentRequest?.status]);

  useEffect(() => {
    const transactionFromReturn =
      searchParams.get("tran_id")?.trim() || null;
    const payWayReturn = searchParams.get("payway");

    if (
      transactionFromReturn &&
      (payWayReturn === "returned" || payWayReturn === "approved")
    ) {
      setPayWayTransactionId(transactionFromReturn);
      setPayWayPaymentState(
        payWayReturn === "approved" ? "approved" : "waiting",
      );
    }
  }, [searchParams]);

  useEffect(() => {
    if (
      !payWayTransactionId ||
      payWayPaymentState === "approved" ||
      payWayPaymentState === "declined" ||
      payWayPaymentState === "cancelled" ||
      payWayPaymentState === "failed"
    ) {
      return;
    }

    // Snapshot the non-null transaction ID for this effect run.
    // TypeScript cannot safely keep the state-variable narrowing inside
    // the nested async callback, so use this local string instead.
    const transactionId = payWayTransactionId;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    async function verifyPayment() {
      attempts += 1;

      try {
        const response = await fetch(
          `/api/payway/status?tran_id=${encodeURIComponent(transactionId)}`,
          { cache: "no-store" },
        );

        const text = await response.text();
        let result: {
          success?: boolean;
          error?: string;
          paymentState?: PayWayPaymentState;
          providerStatus?: string | null;
        } = {};

        if (text.trim()) {
          result = JSON.parse(text) as typeof result;
        }

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to verify PayWay payment.",
          );
        }

        if (cancelled) {
          return;
        }

        const nextState = result.paymentState ?? "pending";
        setPayWayPaymentState(nextState);
        setPayWayStatusText(result.providerStatus ?? null);

        if (nextState === "approved") {
          setCheckoutError(null);
          window.setTimeout(() => {
            window.location.assign(
              `/dashboard/subscription?payway=approved&tran_id=${encodeURIComponent(transactionId)}`,
            );
          }, 900);
          return;
        }

        if (
          nextState === "declined" ||
          nextState === "cancelled" ||
          nextState === "failed"
        ) {
          return;
        }

        if (attempts < 100) {
          timer = setTimeout(verifyPayment, 3000);
        } else {
          setPayWayStatusText(
            "Payment is still awaiting confirmation. Keep this page open or return later; TENH can verify the same transaction again.",
          );
        }
      } catch (verifyError) {
        if (cancelled) {
          return;
        }

        setPayWayStatusText(
          verifyError instanceof Error
            ? verifyError.message
            : "Unable to verify payment right now.",
        );

        if (attempts < 100) {
          timer = setTimeout(verifyPayment, 5000);
        }
      }
    }

    void verifyPayment();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [payWayPaymentState, payWayTransactionId]);

  const selectedCycle = useMemo(
    () =>
      cycles.find(
        (item) => item.id === cycle,
      ) ?? cycles[0],
    [cycle],
  );

  const selectedPlanDefinition =
    useMemo(
      () =>
        plans.find(
          (plan) =>
            plan.id === selectedPlan,
        ) ?? null,
      [selectedPlan],
    );

  const selectedCheckoutTotalCents =
    selectedPlan
      ? calculatePlanTotalCents(
          selectedPlan,
          cycle,
        )
      : null;

  const payWayReturnState =
    searchParams.get("payway");
  const payWayReturnTransaction =
    searchParams.get("tran_id");
  const manualReturnState =
    searchParams.get("manual");
  const planChangeBlockedReason =
    searchParams.get("plan_change_blocked");

  const isTrial =
    subscription?.status === "trialing";

  const isExpired =
    subscription?.status === "expired" ||
    subscription?.status === "past_due";

  const isTrialPlan =
    subscription?.plan_code === "trial";

  const selectedPlanAction = selectedPlan
    ? getPlanAction(planChangeState, selectedPlan)
    : null;

  const upgradePlans = useMemo(
    () =>
      plans.filter(
        (plan) => getPlanAction(planChangeState, plan.id) === "upgrade",
      ),
    [planChangeState],
  );

  const selectedUpgradePriceCents =
    selectedPlan && planChangeState?.currentPlan
      ? calculateUpgradeTotalCents(
          planChangeState.currentPlan,
          selectedPlan,
          cycle,
        )
      : null;

  function openPlansModal() {
    setModalOpen(true);
  }

  function openUpgradeForSelectedSubscription() {
    if (!selectedListItem) return;

    if (
      selectedListItem.canManageBilling !== true ||
      selectedListItem.subscription?.status !== "active"
    ) {
      return;
    }

    // Do not switch TENH's active workspace just to preview an upgrade.
    // The modal, quote API, payment page, and checkout now carry the exact
    // target business ID. Cancelling an upgrade therefore leaves the
    // customer's current workspace untouched and cannot reuse another
    // subscription's old quote/price.
    setError(null);
    setModalOpen(true);
  }

  function continueSelectedPlan() {
    if (!selectedPlan || !selectedPlanAction) return;

    if (selectedPlanAction === "buy-new") {
      window.location.assign(`/dashboard/subscription/buy?plan=${encodeURIComponent(selectedPlan)}&cycle=${encodeURIComponent(cycle)}`);
      return;
    }

    if (
      selectedPlanAction === "upgrade" ||
      selectedPlanAction === "subscribe"
    ) {
      window.location.assign(
        `/dashboard/subscription/payment?plan=${encodeURIComponent(selectedPlan)}&cycle=${encodeURIComponent(cycle)}`,
      );
    }
  }

  function resetPreparedPayment() {
    setPayWayTransactionId(null);
    setPayWayPaymentState("idle");
    setPayWayStatusText(null);
    setCheckoutError(null);
  }

  function openUsageManager(
    tab: "connections" | "members",
  ) {
    setUsageManagerTab(tab);
    setUsageManagerOpen(true);
  }

  const closeUsageManager =
    useCallback(() => {
      setUsageManagerOpen(false);
    }, []);

  const handleUsageChanged =
    useCallback(
      (nextUsage: {
        members: number;
        channels: number;
      }) => {
        setUsage((currentUsage) => {
          if (
            currentUsage.members ===
              nextUsage.members &&
            currentUsage.channels ===
              nextUsage.channels
          ) {
            return currentUsage;
          }

          return nextUsage;
        });

        // Keep the plan chooser in sync immediately after an Owner pauses a
        // channel or deactivates an Agent inside UsageManagementModal.
        setPlanChangeState((currentState) =>
          currentState
            ? {
                ...currentState,
                usage: nextUsage,
              }
            : currentState,
        );
      },
      [],
    );

  function getPlanPriceCents(
    planCode: PlanCode,
  ) {
    return (
      calculatePlanTotalCents(
        planCode,
        cycle,
      ) ?? 0
    );
  }

  async function startPayWayCheckout() {
    if (!selectedPlan) {
      setCheckoutError(
        "Choose a plan before continuing to payment.",
      );
      return;
    }

    const payWayBridge =
      window.TenhAbaPaywayBridge;

    if (
      !payWayPluginReady ||
      !payWayBridge?.isReady()
    ) {
      setPayWayPluginReady(false);
      setCheckoutError(
        "PayWay secure checkout is still loading. Please try again in a moment.",
      );
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);
    setPayWayStatusText(null);
    resetPreparedPayment();

    try {
      const response = await fetch(
        "/api/payway/checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            planCode: selectedPlan,
            billingCycle: cycle,
            paymentMethod: "abapay_khqr",
          }),
        },
      );

      const text = await response.text();
      let result: {
        success?: boolean;
        error?: string;
        checkoutUrl?: string;
        transactionId?: string;
        fields?: Record<string, string>;
      } = {};

      if (text.trim()) {
        try {
          result = JSON.parse(text) as typeof result;
        } catch {
          throw new Error(
            `Checkout API returned invalid JSON (HTTP ${response.status}).`,
          );
        }
      }

      if (
        !response.ok ||
        !result.success ||
        !result.checkoutUrl ||
        !result.transactionId ||
        !result.fields
      ) {
        throw new Error(
          result.error ?? "Unable to start ABA PayWay checkout.",
        );
      }

      document.getElementById("aba_merchant_request")?.remove();

      const form = document.createElement("form");
      form.method = "POST";
      form.enctype = "multipart/form-data";
      form.action = result.checkoutUrl;
      form.target = "aba_webservice";
      form.id = "aba_merchant_request";
      form.style.display = "none";

      Object.entries(result.fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);

      setPayWayTransactionId(result.transactionId);
      setPayWayPaymentState("waiting");
      setPayWayStatusText(
        "Complete payment in the ABA PayWay secure checkout. TENH will verify the transaction automatically.",
      );

      payWayBridge.checkout();
    } catch (checkoutFailure) {
      setCheckoutError(
        checkoutFailure instanceof Error
          ? checkoutFailure.message
          : "Unable to start ABA PayWay checkout.",
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function submitManualPayment() {
    if (!selectedPlan) {
      setManualPaymentError(
        "Choose a plan before submitting payment proof.",
      );
      return;
    }

    if (!manualPaymentConfig?.enabled) {
      setManualPaymentError(
        "Manual payment is not available right now.",
      );
      return;
    }

    if (manualPaymentRequest?.status === "submitted") {
      setManualPaymentError(
        "Your previous manual payment is already waiting for review.",
      );
      return;
    }

    if (!manualProof) {
      setManualPaymentError(
        "Upload your bank transfer receipt/payment proof.",
      );
      return;
    }

    setManualPaymentSubmitting(true);
    setManualPaymentError(null);

    let uploaded:
      | {
          bucket: string;
          path: string;
        }
      | null = null;

    try {
      /*
       * Upload the proof directly to the private Supabase bucket using a
       * one-time signed URL. This avoids sending a large receipt through the
       * Next.js/Vercel function body while keeping the service-role key secret.
       */
      const prepareResponse = await fetch(
        "/api/manual-payments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "prepare-upload",
            planCode: selectedPlan,
            billingCycle: cycle,
            fileName: manualProof.name,
            mimeType: manualProof.type,
            sizeBytes: manualProof.size,
          }),
        },
      );

      const prepareResult = (await prepareResponse.json()) as {
        success?: boolean;
        error?: string;
        requestId?: string;
        upload?: {
          bucket: string;
          path: string;
          token: string;
        };
      };

      if (
        !prepareResponse.ok ||
        !prepareResult.success ||
        !prepareResult.requestId ||
        !prepareResult.upload
      ) {
        throw new Error(
          prepareResult.error ??
            "Unable to prepare the payment proof upload.",
        );
      }

      const supabase = createClient();
      const { bucket, path, token } = prepareResult.upload;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(
          path,
          token,
          manualProof,
          {
            contentType: manualProof.type,
          },
        );

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      uploaded = { bucket, path };

      const finalizeResponse = await fetch(
        "/api/manual-payments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "finalize-upload",
            requestId: prepareResult.requestId,
            planCode: selectedPlan,
            billingCycle: cycle,
            customerNote:
              manualCustomerNote.trim(),
            fileName: manualProof.name,
            mimeType: manualProof.type,
            sizeBytes: manualProof.size,
            storagePath: path,
          }),
        },
      );

      const result = (await finalizeResponse.json()) as {
        success?: boolean;
        error?: string;
        request?: ManualPaymentRequest;
      };

      if (
        !finalizeResponse.ok ||
        !result.success ||
        !result.request
      ) {
        throw new Error(
          result.error ??
            "Unable to submit manual payment proof.",
        );
      }

      setManualPaymentRequest(result.request);
      setManualCustomerNote("");
      setManualProof(null);
    } catch (submitError) {
      setManualPaymentError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit manual payment proof.",
      );

      /*
       * A failed finalize can leave an uploaded proof orphaned. The server
       * removes it on database-insert failure. Network interruption after the
       * upload may leave one private object, which can be cleaned periodically.
       */
      void uploaded;
    } finally {
      setManualPaymentSubmitting(false);
    }
  }

  const currentPlanLabel = isTrialPlan
    ? t("Free Trial", "សាកល្បងឥតគិតថ្លៃ")
    : subscription?.plan_code === "custom"
      ? t("Custom", "ផ្ទាល់ខ្លួន")
      : plans.find((plan) => plan.id === subscription?.plan_code)?.name ??
        (subscription?.plan_code
          ? subscription.plan_code
              .charAt(0)
              .toUpperCase() + subscription.plan_code.slice(1)
          : "—");

  const selectedListSubscription = selectedListItem?.subscription ?? null;
  const selectedListExpired = selectedListItem
    ? isWorkspaceSubscriptionExpired(selectedListItem)
    : false;
  const selectedListRenewalUrl = selectedListItem
    ? sameSubscriptionRenewalUrl(selectedListItem)
    : null;
  const selectedListEffectiveStatus = selectedListExpired
    ? "expired"
    : selectedListSubscription?.status ?? "";
  const selectedListPlanLabel = selectedListSubscription
    ? selectedListSubscription.plan_code === "custom"
      ? t("Custom", "ផ្ទាល់ខ្លួន")
      : plans.find((plan) => plan.id === selectedListSubscription.plan_code)?.name ??
        selectedListSubscription.plan_code
          .charAt(0)
          .toUpperCase() + selectedListSubscription.plan_code.slice(1)
    : "—";
  const selectedListShortId = selectedListSubscription
    ? selectedListSubscription.id.slice(0, 8).toUpperCase()
    : selectedListItem
      ? selectedListItem.businessId.slice(0, 8).toUpperCase()
      : null;
  const selectedConnectionPercent = selectedListSubscription && selectedListItem
    ? usagePercent(
        selectedListItem.usage.channels,
        selectedListSubscription.channel_limit,
      )
    : 0;
  const selectedMemberPercent = selectedListSubscription && selectedListItem
    ? usagePercent(
        selectedListItem.usage.members,
        selectedListSubscription.member_limit,
      )
    : 0;
  const selectedDaysLeft = daysUntil(
    selectedListSubscription?.current_period_end ?? null,
  );
  const selectedCycleLabel = selectedListSubscription?.billing_cycle
    ? selectedListSubscription.billing_cycle
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";

  return (
    <div className="mx-auto w-full max-w-[1500px] px-5 py-6 sm:px-6 lg:px-8">
      <Script
        id="tenh-payway-classic-bridge"
        strategy="afterInteractive"
      >
        {`
          window.TenhAbaPaywayBridge = {
            isReady: function () {
              try {
                return (
                  typeof AbaPayway !== "undefined" &&
                  AbaPayway &&
                  typeof AbaPayway.checkout === "function"
                );
              } catch (error) {
                return false;
              }
            },
            checkout: function () {
              if (
                typeof AbaPayway === "undefined" ||
                !AbaPayway ||
                typeof AbaPayway.checkout !== "function"
              ) {
                throw new Error(
                  "ABA PayWay checkout plugin is not ready.",
                );
              }

              return AbaPayway.checkout();
            },
          };
        `}
      </Script>
      <Script
        id="tenh-payway-checkout-plugin"
        src="https://checkout.payway.com.kh/plugins/checkout2-0.js"
        strategy="afterInteractive"
        onReady={() => {
          if (
            window.TenhAbaPaywayBridge?.isReady()
          ) {
            setPayWayPluginReady(true);
          }
        }}
        onError={() => {
          setPayWayPluginReady(false);
          setCheckoutError(
            "Unable to load PayWay secure checkout. Refresh the page and try again.",
          );
        }}
      />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">
            {t("Billing & workspace", "ការទូទាត់ និងកន្លែងធ្វើការ")}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            {t("Subscription", "ការជាវ")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {t(
              "Manage your TENH Chat prepaid plan, workspace capacity, billing period, renewal, and channel access.",
              "គ្រប់គ្រងគម្រោងបង់ប្រាក់ជាមុនរបស់ TENH Chat សមត្ថភាពកន្លែងធ្វើការ រយៈពេលទូទាត់ ការបន្ត និងការចូលប្រើឆានែល។",
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/subscription/billing-history"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <CardIcon className="h-4 w-4" />
            {t("Billing history", "ប្រវត្តិការទូទាត់")}
          </Link>

          <Link
            href="/dashboard/subscription/buy"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <PlanIcon className="h-4 w-4" />
            {t("Buy new subscription", "ទិញការជាវថ្មី")}
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {payWayReturnState === "approved" ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-800">
          {t("Payment verified successfully", "បានផ្ទៀងផ្ទាត់ការទូទាត់ដោយជោគជ័យ")}{payWayReturnTransaction ? ` · ${t("Transaction", "ប្រតិបត្តិការ")} ${payWayReturnTransaction}` : ""}. {t("Your TENH workspace subscription is active.", "ការជាវកន្លែងធ្វើការ TENH របស់អ្នកសកម្មហើយ។")}
        </div>
      ) : payWayReturnState === "cancelled" ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          {t("ABA PayWay checkout was cancelled and the pending transaction was closed. No TENH plan change has been applied.", "ការទូទាត់ ABA PayWay ត្រូវបានលុបចោល ហើយប្រតិបត្តិការដែលកំពុងរង់ចាំត្រូវបានបិទ។ មិនមានការផ្លាស់ប្តូរគម្រោង TENH ត្រូវបានអនុវត្តទេ។")}
        </div>
      ) : payWayReturnState === "cancel_failed" ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          {t("TENH could not confirm that ABA closed the pending transaction. No subscription change was applied. Please check the transaction before starting another payment.", "TENH មិនអាចបញ្ជាក់ថា ABA បានបិទប្រតិបត្តិការដែលកំពុងរង់ចាំបានទេ។ មិនមានការផ្លាស់ប្តូរការជាវត្រូវបានអនុវត្តទេ។ សូមពិនិត្យប្រតិបត្តិការមុនពេលចាប់ផ្តើមការទូទាត់ថ្មី។")}
        </div>
      ) : payWayReturnState === "returned" ? (
        <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
          {t("Returned from ABA PayWay", "បានត្រឡប់ពី ABA PayWay")}{payWayReturnTransaction ? ` · ${t("Transaction", "ប្រតិបត្តិការ")} ${payWayReturnTransaction}` : ""}. {t("TENH is verifying the payment with PayWay before changing workspace access.", "TENH កំពុងផ្ទៀងផ្ទាត់ការទូទាត់ជាមួយ PayWay មុនពេលផ្លាស់ប្តូរសិទ្ធិចូលប្រើកន្លែងធ្វើការ។")}
        </div>
      ) : null}

      {manualReturnState === "approved" ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-800">
          {t("Manual payment approved. Your TENH workspace subscription is active.", "ការទូទាត់ដោយដៃត្រូវបានអនុម័ត។ ការជាវកន្លែងធ្វើការ TENH របស់អ្នកសកម្មហើយ។")}
        </div>
      ) : null}

      {blockedPlanChangeMessage(planChangeBlockedReason) ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <p className="font-bold text-amber-900">{t("Payment path blocked", "ផ្លូវបង់ប្រាក់ត្រូវបានរារាំង")}</p>
          <p className="mt-1 leading-6">
            {blockedPlanChangeMessage(planChangeBlockedReason)}
          </p>
        </div>
      ) : null}

      {planChangeError ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {planChangeError}
        </div>
      ) : null}

      {planChangeNotice ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          {planChangeNotice}
        </div>
      ) : null}

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px] xl:items-start">
        <div className="space-y-6">
          <SubscriptionMembershipList
            onSelectSubscription={(item, isCurrent) => {
              // V3.11.31.27: local information selection only.
              // This must not change TENH's authenticated/current workspace.
              setSelectedListItem(item);
              setSelectedListItemIsCurrent(isCurrent);
            }}
          />


          {planChangeState?.mode === "suspended" ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {t("Self-service plan changes are disabled while this subscription is suspended. Contact TENH support.", "ការផ្លាស់ប្តូរគម្រោងដោយខ្លួនឯងត្រូវបានបិទ ខណៈការជាវនេះត្រូវបានផ្អាក។ សូមទាក់ទងជំនួយ TENH។")}
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5">
          {((selectedListItem &&
              selectedListItem.role !== "owner" &&
              selectedListItem.canManageBilling !== true) ||
            (!selectedListItem &&
              planChangeState &&
              !planChangeState.isOwner &&
              !planChangeState.canManage)) ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              {t(
                "Only an Owner can change subscription access, Owner permissions, or channel capacity. You can still review the current settings.",
                "មានតែម្ចាស់ប៉ុណ្ណោះដែលអាចផ្លាស់ប្តូរសិទ្ធិចូលការជាវ សិទ្ធិម្ចាស់ ឬចំណុះឆានែល។ អ្នកនៅតែអាចពិនិត្យការកំណត់បច្ចុប្បន្នបាន។",
              )}
            </div>
          ) : null}

          {!selectedListItem ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="border-l-2 border-blue-500 pl-3">
                <p className="text-sm font-bold text-slate-950">
                  {t("Subscription information", "ព័ត៌មានការជាវ")}
                </p>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-500">
                {t(
                  "Select a subscription from the list to view its plan, expiry date, connected channels, team usage, and available actions.",
                  "ជ្រើសរើសការជាវពីបញ្ជី ដើម្បីមើលគម្រោង កាលបរិច្ឆេទផុតកំណត់ ឆានែលដែលបានភ្ជាប់ ការប្រើប្រាស់ក្រុម និងសកម្មភាពដែលអាចប្រើបាន។",
                )}
              </p>
            </section>
          ) : selectedListSubscription ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="border-l-2 border-blue-500 pl-3">
                <p className="text-sm font-bold text-slate-950">
                  {t("Subscription information", "ព័ត៌មានការជាវ")}
                </p>
              </div>

              <div className="mt-5 flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white shadow-sm">
                  {selectedListShortId?.slice(0, 2) ?? "—"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-bold text-slate-950">
                      {selectedListShortId
                        ? `${t("Subscription", "ការជាវ")} #${selectedListShortId}`
                        : t("Subscription", "ការជាវ")}
                    </h2>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${getStatusClasses(
                        selectedListEffectiveStatus,
                      )}`}
                    >
                      {statusText(selectedListEffectiveStatus)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {selectedListItem.businessName}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                      <PlanIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[10px] font-medium text-slate-500">{t("Plan", "គម្រោង")}</p>
                      <p className="mt-0.5 text-sm font-bold text-slate-950">
                        {selectedListPlanLabel}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                      <CalendarIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium text-slate-500">
                        {selectedListExpired
                          ? t("Expired on", "បានផុតកំណត់នៅ")
                          : t("Expires on", "ផុតកំណត់នៅ")}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-bold text-slate-950">
                        {formatDate(selectedListSubscription.current_period_end, isKhmer)}
                      </p>
                      {selectedDaysLeft !== null ? (
                        <p className="mt-0.5 text-[9px] text-slate-400">
                          {isKhmer
                            ? `នៅសល់ ${selectedDaysLeft} ថ្ងៃ`
                            : `in ${selectedDaysLeft} days`}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <ChannelIcon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {t("Connected channels", "ឆានែលដែលបានភ្ជាប់")}
                        </p>
                        <p className="text-[10px] text-slate-400">{t("Your Social", "បណ្តាញសង្គមរបស់អ្នក")}</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-950">
                      {selectedListItem.usage.channels} / {selectedListSubscription.channel_limit}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${selectedConnectionPercent}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-end text-[9px] text-slate-400">
                    {selectedConnectionPercent}%
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <UsersIcon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {t("Active team members", "សមាជិកក្រុមកំពុងប្រើ")}
                        </p>
                        <p className="text-[10px] text-slate-400">{t("Owner + Agents", "ម្ចាស់ + ភ្នាក់ងារ")}</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-950">
                      {selectedListItem.usage.members} / {selectedListSubscription.member_limit}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${selectedMemberPercent}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-end text-[9px] text-slate-400">
                    {selectedMemberPercent}%
                  </div>
                </div>
              </div>

             
              {selectedListItem.role === "owner" && selectedListRenewalUrl ? (
                <button
                  type="button"
                  onClick={() => window.location.assign(selectedListRenewalUrl)}
                  className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                >
                  {t("Reactivate subscription", "ធ្វើឲ្យការជាវសកម្មឡើងវិញ")}
                </button>
              ) : selectedListItem.canManageBilling &&
                selectedListSubscription.status === "active" &&
                !selectedListExpired ? (
                <button
                  type="button"
                  onClick={openUpgradeForSelectedSubscription}
                  className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                >
                  {t("Upgrade plan", "ដំឡើងគម្រោង")}
                </button>
              ) : null}

              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4 text-[10px] leading-4 text-slate-500">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[9px]">
                  i
                </span>
                <p>
                  {t(
                    "When reactivating an expired subscription, TENH keeps the existing subscription history and related workspace records.",
                    "នៅពេលធ្វើឲ្យការជាវដែលផុតកំណត់សកម្មឡើងវិញ TENH នឹងរក្សាប្រវត្តិការជាវដែលមានស្រាប់ និងកំណត់ត្រាកន្លែងធ្វើការដែលពាក់ព័ន្ធ។",
                  )}
                </p>
              </div>
            </section>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="font-bold text-amber-900">
                {t("No subscription information", "គ្មានព័ត៌មានការជាវ")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                {t("This subscription does not have a managed billing record available.", "ការជាវនេះមិនមានកំណត់ត្រាការទូទាត់ដែលអាចគ្រប់គ្រងបានទេ។")}
              </p>
            </div>
          )}
        </aside>
      </div>

      <UsageManagementModal
        open={usageManagerOpen}
        initialTab={usageManagerTab}
        onClose={closeUsageManager}
        onUsageChanged={handleUsageChanged}
      />

      <CustomUpgradeModal
        key={selectedListItem?.businessId ?? "current-subscription-upgrade"}
        open={modalOpen}
        targetBusinessId={selectedListItem?.businessId ?? null}
        currentConnections={
          selectedListSubscription?.channel_limit ??
          subscription?.channel_limit ??
          0
        }
        currentUsers={
          selectedListSubscription?.member_limit ??
          subscription?.member_limit ??
          0
        }
        currentBillingCycle={
          selectedListSubscription?.billing_cycle ??
          subscription?.billing_cycle ??
          null
        }
        currentPeriodEnd={
          selectedListSubscription?.current_period_end ??
          subscription?.current_period_end ??
          null
        }
        onClose={() => setModalOpen(false)}
      />

    </div>
  );
}
