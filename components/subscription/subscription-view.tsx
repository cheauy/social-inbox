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

import {
  UsageManagementModal,
} from "@/components/subscription/usage-management-modal";
import {
  SubscriptionMembershipList,
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

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
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
  if (!state || !state.canManage) {
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
    // TENH no longer downgrades an active subscription in place.
    // Choosing a smaller package creates another independent subscription ID.
    return "buy-new";
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

export function SubscriptionView() {
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
  const [upgradeSwitching, setUpgradeSwitching] =
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

  async function openUpgradeForSelectedSubscription() {
    if (upgradeSwitching || !selectedListItem) return;

    if (
      selectedListItem.role !== "owner" ||
      selectedListItem.subscription?.status !== "active"
    ) {
      return;
    }

    // Current workspace already targets the correct subscription, so open
    // the floating Custom Upgrade modal immediately with no navigation.
    if (selectedListItemIsCurrent) {
      setModalOpen(true);
      return;
    }

    // For another owned subscription, billing APIs still resolve the active
    // business from the authenticated workspace context. Switch that target
    // silently, then open the modal in-place. Do NOT reload or navigate the
    // Subscription page. The row selection itself remains local-only.
    setUpgradeSwitching(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: selectedListItem.businessId }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to select this subscription for upgrade.",
        );
      }

      setModalOpen(true);
    } catch (upgradeError) {
      setError(
        upgradeError instanceof Error
          ? upgradeError.message
          : "Unable to open this subscription upgrade.",
      );
    } finally {
      setUpgradeSwitching(false);
    }
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
    ? "Free Trial"
    : subscription?.plan_code === "custom"
      ? "Custom"
      : plans.find((plan) => plan.id === subscription?.plan_code)?.name ??
        (subscription?.plan_code
          ? subscription.plan_code
              .charAt(0)
              .toUpperCase() + subscription.plan_code.slice(1)
          : "—");

  const selectedListSubscription = selectedListItem?.subscription ?? null;
  const selectedListPlanLabel = selectedListSubscription
    ? selectedListSubscription.plan_code === "custom"
      ? "Custom"
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

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-6 lg:px-8">
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
            Billing & workspace
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
            Subscription
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Manage your TENH Chat prepaid plan, workspace capacity, billing period, renewal, and channel access.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/subscription/billing-history"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <CardIcon className="h-4 w-4" />
            Billing history
          </Link>

          <Link
            href="/dashboard/subscription/buy"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <PlanIcon className="h-4 w-4" />
            Buy new subscription
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
          Payment verified successfully{payWayReturnTransaction ? ` · Transaction ${payWayReturnTransaction}` : ""}. Your TENH workspace subscription is active.
        </div>
      ) : payWayReturnState === "cancelled" ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          ABA PayWay checkout was cancelled. No TENH plan change has been applied.
        </div>
      ) : payWayReturnState === "returned" ? (
        <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
          Returned from ABA PayWay{payWayReturnTransaction ? ` · Transaction ${payWayReturnTransaction}` : ""}. TENH is verifying the payment with PayWay before changing workspace access.
        </div>
      ) : null}

      {manualReturnState === "approved" ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-800">
          Manual payment approved. Your TENH workspace subscription is active.
        </div>
      ) : null}

      {blockedPlanChangeMessage(planChangeBlockedReason) ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          <p className="font-bold text-amber-900">Payment path blocked</p>
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

      <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-6">
          <SubscriptionMembershipList
            onSelectSubscription={(item, isCurrent) => {
              // V3.11.31.27: local information selection only.
              // This must not change TENH's authenticated/current workspace.
              setSelectedListItem(item);
              setSelectedListItemIsCurrent(isCurrent);
            }}
          />

          {planChangeState && !planChangeState.canManage ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              You can view subscription details, but only the subscription Owner can manage billing or purchase changes for this subscription.
            </div>
          ) : null}

          {planChangeState?.mode === "suspended" ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Self-service plan changes are disabled while this subscription is suspended. Contact TENH support.
            </div>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-6">
          {!selectedListItem ? (
            <section className="rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                Subscription information
              </p>
              <h2 className="mt-2 text-xl font-bold text-slate-950">
                Select a subscription
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Choose a subscription from the list to view its plan, expiry date, connected channels, and team usage.
              </p>
            </section>
          ) : selectedListSubscription ? (
            <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
              <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                      Subscription information
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-slate-950">
                      {selectedListShortId ? `Subscription #${selectedListShortId}` : "Subscription"}
                    </h2>
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold capitalize ${getStatusClasses(
                      selectedListSubscription.status,
                    )}`}
                  >
                    {selectedListSubscription.status}
                  </span>
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
                      <PlanIcon className="h-4 w-4" />
                    </div>
                    <p className="mt-3 text-xs font-medium text-slate-500">Plan</p>
                    <p className="mt-1 font-bold text-slate-950">{selectedListPlanLabel}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
                      <CalendarIcon className="h-4 w-4" />
                    </div>
                    <p className="mt-3 text-xs font-medium text-slate-500">
                      {selectedListSubscription.status === "cancelled"
                        ? "Payment"
                        : selectedListSubscription.status === "expired"
                          ? "Expired on"
                          : selectedListSubscription.status === "trialing"
                            ? "Trial ends"
                            : "Expires on"}
                    </p>
                    <p className="mt-1 font-bold text-slate-950">
                      {selectedListSubscription.status === "cancelled"
                        ? "Cancelled"
                        : formatDate(selectedListSubscription.current_period_end)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                        <ChannelIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Connected channels</p>
                        <p className="text-xs text-slate-500">Your Social</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-lg font-bold text-slate-950">
                      {selectedListItem.usage.channels} / {selectedListSubscription.channel_limit}
                    </span>
                  </div>
                  {selectedListItemIsCurrent ? (
                    <button
                      type="button"
                      onClick={() => openUsageManager("connections")}
                      className="mt-3 text-xs font-bold text-blue-700 hover:underline"
                    >
                      Manage channels
                    </button>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                        <UsersIcon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Active team members</p>
                        <p className="text-xs text-slate-500">Owner + Agents</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-lg font-bold text-slate-950">
                      {selectedListItem.usage.members} / {selectedListSubscription.member_limit}
                    </span>
                  </div>
                  {selectedListItemIsCurrent ? (
                    <button
                      type="button"
                      onClick={() => openUsageManager("members")}
                      className="mt-3 text-xs font-bold text-blue-700 hover:underline"
                    >
                      Manage users
                    </button>
                  ) : null}
                </div>

                {selectedListItem.role === "owner" &&
                selectedListSubscription.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openUpgradeForSelectedSubscription();
                    }}
                    disabled={upgradeSwitching}
                    className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    Upgrade plan
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <div className="rounded-[26px] border border-amber-200 bg-amber-50 p-6">
              <h2 className="font-bold text-amber-900">
                No subscription information
              </h2>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                This subscription does not have a managed billing record available.
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
        open={modalOpen}
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
