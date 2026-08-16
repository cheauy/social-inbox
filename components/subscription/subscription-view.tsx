"use client";

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
  TENH_BILLING_CYCLES as cycles,
  TENH_PLANS as plans,
  calculatePlanTotalCents,
  formatUsdFromCents,
  type BillingCycle,
  type PlanCode,
} from "@/lib/subscription/plan-catalog";

type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "suspended";

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
  | "downgrade"
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

function getDaysRemaining(value: string | null) {
  if (!value) {
    return null;
  }

  const end = new Date(value).getTime();

  if (!Number.isFinite(end)) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil((end - Date.now()) / 86_400_000),
  );
}

function getStatusClasses(status: SubscriptionStatus) {
  switch (status) {
    case "trialing":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "past_due":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "expired":
      return "border-slate-200 bg-slate-50 text-slate-600";
    case "suspended":
      return "border-red-200 bg-red-50 text-red-700";
  }
}

const planRanks: Record<PlanCode, number> = {
  mini: 1,
  standard: 2,
  pro: 3,
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

  if (
    !targetPlan ||
    state.usage.members > targetPlan.users ||
    state.usage.channels > targetPlan.channels
  ) {
    return "blocked";
  }

  if (state.mode === "subscribe" || !state.currentPlan) {
    return "subscribe";
  }

  const currentRank = planRanks[state.currentPlan];
  const targetRank = planRanks[planCode];

  if (targetRank === currentRank) {
    return "current";
  }

  return targetRank > currentRank ? "upgrade" : "downgrade";
}

function planActionLabel(action: PlanAction) {
  switch (action) {
    case "current":
      return "Current plan";
    case "upgrade":
      return "Upgrade";
    case "downgrade":
      return "Downgrade";
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
      return "A lower plan cannot replace your active paid plan immediately. Schedule the downgrade from the plan selector instead.";
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

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function InfoCard({
  icon,
  label,
  title,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
            {title}
          </p>
          <div className="mt-3 text-sm leading-6 text-slate-500">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function UsageCard({
  icon,
  title,
  used,
  limit,
  helper,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  used: number;
  limit: number;
  helper: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const percent = Math.min(
    100,
    Math.round((used / Math.max(limit, 1)) * 100),
  );

  return (
    <div className="relative overflow-hidden rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
      <div className="pointer-events-none absolute -bottom-14 -right-10 h-36 w-36 rounded-full bg-blue-50" />
      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white">
              {icon}
            </div>
            <h3 className="truncate text-lg font-bold text-slate-950">
              {title}
            </h3>
          </div>

          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-800">
            {used} / {limit}
          </span>
        </div>

        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        <p className="mt-4 max-w-xl text-sm leading-6 text-slate-500">
          {helper}
        </p>

        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
        >
          {actionLabel}
          <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}

function ChannelRoadmapCard({
  name,
  highlighted = false,
}: {
  name: string;
  highlighted?: boolean;
}) {
  return (
    <div className="group flex min-h-[82px] items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4 transition hover:border-blue-200 hover:bg-white hover:shadow-sm">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${
          highlighted
            ? "bg-blue-600 text-white shadow-sm"
            : "bg-white text-slate-500 ring-1 ring-slate-200 group-hover:text-blue-600"
        }`}
      >
        <ChannelIcon className="h-5 w-5" />
      </div>

      <span className="truncate text-base font-semibold text-slate-900">
        {name}
      </span>
    </div>
  );
}

export function SubscriptionView() {
  const searchParams = useSearchParams();
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

  const daysRemaining = getDaysRemaining(
    subscription?.trial_ends_at ?? null,
  );

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

  const pendingPlanDefinition =
    planChangeState?.pendingChange
      ? plans.find(
          (item) =>
            item.id ===
            planChangeState.pendingChange?.planCode,
        ) ?? null
      : null;

  function openPlansModal() {
    setPlanChangeError(null);
    setPlanChangeNotice(null);

    // If a previous active subscription scheduled a downgrade and the paid
    // period has since ended, preselect the intended renewal plan. Payment is
    // still required before that plan can become active.
    if (
      planChangeState?.mode === "subscribe" &&
      planChangeState.pendingChange &&
      plans.some(
        (item) =>
          item.id === planChangeState.pendingChange?.planCode,
      )
    ) {
      setSelectedPlan(
        planChangeState.pendingChange.planCode as PlanCode,
      );

      if (
        planChangeState.pendingChange.billingCycle &&
        cycles.some(
          (item) =>
            item.id ===
            planChangeState.pendingChange?.billingCycle,
        )
      ) {
        setCycle(
          planChangeState.pendingChange
            .billingCycle as BillingCycle,
        );
      }
    }

    setModalOpen(true);
  }

  async function scheduleSelectedDowngrade() {
    if (!selectedPlan || selectedPlanAction !== "downgrade") {
      setPlanChangeError(
        "Choose a lower plan before scheduling a downgrade.",
      );
      return;
    }

    setPlanChangeSubmitting(true);
    setPlanChangeError(null);
    setPlanChangeNotice(null);

    try {
      const response = await fetch(
        "/api/subscription/plan-change",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "schedule-downgrade",
            targetPlan: selectedPlan,
            billingCycle: cycle,
          }),
        },
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
          result.error ?? "Unable to schedule the downgrade.",
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
      setPlanChangeNotice(
        `${selectedPlan.charAt(0).toUpperCase()}${selectedPlan.slice(1)} is scheduled for your next renewal. Your current paid plan stays active until the current period ends.`,
      );
    } catch (changeError) {
      setPlanChangeError(
        changeError instanceof Error
          ? changeError.message
          : "Unable to schedule the downgrade.",
      );
    } finally {
      setPlanChangeSubmitting(false);
    }
  }

  async function cancelScheduledDowngrade() {
    setPlanChangeSubmitting(true);
    setPlanChangeError(null);
    setPlanChangeNotice(null);

    try {
      const response = await fetch(
        "/api/subscription/plan-change",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "cancel-downgrade",
          }),
        },
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
          result.error ?? "Unable to cancel the scheduled downgrade.",
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
      setPlanChangeNotice("Scheduled downgrade cancelled.");
    } catch (changeError) {
      setPlanChangeError(
        changeError instanceof Error
          ? changeError.message
          : "Unable to cancel the scheduled downgrade.",
      );
    } finally {
      setPlanChangeSubmitting(false);
    }
  }

  function continueSelectedPlan() {
    if (!selectedPlan || !selectedPlanAction) return;

    if (selectedPlanAction === "downgrade") {
      void scheduleSelectedDowngrade();
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
    : subscription?.plan_code
      ? subscription.plan_code
          .charAt(0)
          .toUpperCase() +
        subscription.plan_code.slice(1)
      : "—";

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

          <button
            type="button"
            onClick={openPlansModal}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <PlanIcon className="h-4 w-4" />
            {isExpired ? "Renew subscription" : "View plans"}
          </button>
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

      {subscription && isExpired ? (
        <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">
                Subscription expired
              </p>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-800">
                Your {currentPlanLabel} prepaid period ended on {formatDate(
                  isTrialPlan
                    ? subscription.trial_ends_at
                    : subscription.current_period_end,
                )}. TENH will not charge automatically. Choose any available plan and billing period, then complete a new approved payment to restore workspace access.
              </p>
            </div>

            {planChangeState?.canManage ? (
              <button
                type="button"
                onClick={openPlansModal}
                className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-amber-500"
              >
                Renew subscription
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {planChangeState?.pendingChange && pendingPlanDefinition ? (
        <div className="mt-6 rounded-[24px] border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">
                {planChangeState.mode === "active-paid"
                  ? `Downgrade scheduled: ${currentPlanLabel} → ${pendingPlanDefinition.name}`
                  : `${pendingPlanDefinition.name} is selected for your next paid period`}
              </p>
              <p className="mt-1 max-w-3xl leading-6 text-indigo-800">
                {planChangeState.mode === "active-paid"
                  ? `Your current paid plan stays active until ${formatDate(planChangeState.pendingChange.effectiveAt)}. No charge is taken for scheduling. The lower plan will require an approved payment for the next billing period before it becomes active.`
                  : "Your previous paid period is no longer active. Complete a new payment for the selected plan before TENH activates the next paid period."}
              </p>
            </div>

            {planChangeState.canManage ? (
              planChangeState.mode === "active-paid" ? (
                <button
                  type="button"
                  onClick={() => void cancelScheduledDowngrade()}
                  disabled={planChangeSubmitting}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {planChangeSubmitting ? "Updating..." : "Cancel scheduled downgrade"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openPlansModal}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-500"
                >
                  Choose plan & pay
                </button>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {planChangeState && !planChangeState.canManage ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          You can view subscription details, but only the workspace owner can subscribe, upgrade, downgrade, or cancel a scheduled downgrade.
        </div>
      ) : null}

      {planChangeState?.mode === "suspended" ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Self-service plan changes are disabled while this workspace is suspended. Contact TENH support.
        </div>
      ) : null}

      {loading ? (
        <div className="mt-7 rounded-[26px] border border-slate-200 bg-white p-8 text-sm font-medium text-slate-500 shadow-sm">
          Loading subscription...
        </div>
      ) : subscription ? (
        <>
          <section className="relative mt-7 overflow-hidden rounded-[30px] bg-gradient-to-br from-blue-600 via-blue-650 to-indigo-700 text-white shadow-[0_18px_45px_rgba(37,99,235,0.22)]">
            <div className="pointer-events-none absolute -right-24 -top-40 h-96 w-96 rounded-full border-[70px] border-white/5" />
            <div className="pointer-events-none absolute right-40 top-0 h-full w-64 -skew-x-12 bg-white/[0.035]" />

            <div className="relative flex flex-col gap-8 p-7 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex max-w-3xl items-start gap-5">
                <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/20 sm:flex">
                  <CalendarIcon className="h-8 w-8" />
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                      {isTrial
                        ? "14-day Free Trial"
                        : isExpired
                          ? "Subscription expired"
                          : currentPlanLabel}
                    </h2>

                    <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-xs font-bold capitalize text-white backdrop-blur">
                      {subscription.status}
                    </span>
                  </div>

                  <p className="mt-4 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
                    {isTrial
                      ? "Explore TENH Chat with your team, connect your customer channels, and experience the workspace before choosing a paid plan."
                      : isExpired
                        ? `Your previous ${currentPlanLabel} prepaid period has ended. Choose a plan and billing period to renew access; TENH does not charge automatically.`
                        : "Your workspace capacity, billing period, and channel allowances are managed by your current TENH Chat plan."}
                  </p>
                </div>
              </div>

              {isTrial ? (
                <div className="min-w-[190px] rounded-[24px] border border-white/20 bg-slate-950/15 px-6 py-5 text-center shadow-inner backdrop-blur-sm">
                  <div className="flex items-center justify-center gap-2 text-blue-100">
                    <CalendarIcon className="h-4 w-4" />
                    <p className="text-xs font-bold uppercase tracking-[0.16em]">
                      Trial remaining
                    </p>
                  </div>
                  <p className="mt-3 text-5xl font-bold leading-none">
                    {daysRemaining ?? "—"}
                  </p>
                  <p className="mt-2 text-sm font-medium text-blue-100">
                    days
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-6 grid gap-5 lg:grid-cols-3">
            <InfoCard
              icon={<PlanIcon />}
              label={isExpired ? "Previous plan" : "Current plan"}
              title={currentPlanLabel}
            >
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                  subscription.status,
                )}`}
              >
                Status: {subscription.status}
              </span>
            </InfoCard>

            <InfoCard
              icon={<CalendarIcon />}
              label={
                isTrial
                  ? "Trial ends"
                  : isExpired
                    ? "Expired on"
                    : "Current period ends"
              }
              title={formatDate(
                isTrialPlan
                  ? subscription.trial_ends_at
                  : subscription.current_period_end,
              )}
            >
              {isExpired
                ? "A new approved prepaid payment starts the next subscription period."
                : "Workspace access follows the active subscription period shown above."}
            </InfoCard>

            <InfoCard
              icon={<CardIcon />}
              label="Payment method"
              title={
                subscription.payment_provider
                  ? subscription.payment_provider
                  : isTrial
                    ? "Not required"
                    : "Not connected"
              }
            >
              {isTrial
                ? "No payment method is required during your free trial."
                : "Your payment provider appears here after billing is activated."}
            </InfoCard>
          </section>

          <section className="mt-6 grid gap-5 lg:grid-cols-2">
            <UsageCard
              icon={<ChannelIcon />}
              title="Connected channels"
              used={usage.channels}
              limit={subscription.channel_limit}
              helper="Each active customer channel uses one channel slot from your workspace plan."
              actionLabel="Manage channels"
              onAction={() =>
                openUsageManager("connections")
              }
            />

            <UsageCard
              icon={<UsersIcon />}
              title="Active team members"
              used={usage.members}
              limit={subscription.member_limit}
              helper="Each active workspace member uses one user seat. Deactivated members keep their history without consuming a seat."
              actionLabel="Manage users"
              onAction={() =>
                openUsageManager("members")
              }
            />
          </section>

          <section className="mt-6 rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
                  Channel ecosystem
                </p>
                <h3 className="mt-1 text-xl font-bold text-slate-950">
                  One workspace, more customer channels
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  TENH Chat is being designed around shared channel capacity, so your plan is not tied to one platform.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <ChannelRoadmapCard
                name="Messenger"
                highlighted
              />
              <ChannelRoadmapCard name="Telegram" />
              <ChannelRoadmapCard name="Instagram" />
              <ChannelRoadmapCard name="WhatsApp" />
              <ChannelRoadmapCard name="TikTok" />
            </div>
          </section>
        </>
      ) : (
        <div className="mt-7 rounded-[26px] border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-bold text-amber-900">
            No managed subscription record
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-800">
            This legacy workspace is not enrolled in TENH self-service billing. Plan purchases and plan changes are blocked for it instead of silently creating a subscription.
          </p>
        </div>
      )}

      <UsageManagementModal
        open={usageManagerOpen}
        initialTab={usageManagerTab}
        onClose={closeUsageManager}
        onUsageChanged={handleUsageChanged}
      />

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-[30px] border border-white/10 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-7 py-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                  Plans & billing
                </p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">
                  Choose your TENH Chat plan
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Compare workspace capacity and choose the billing period that fits your business.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 transition hover:bg-slate-200"
                aria-label="Close plans"
              >
                ×
              </button>
            </div>

            <div className="p-7">
              <p className="text-sm font-bold text-slate-900">
                Billing period
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {cycles.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setCycle(item.id);
                      resetPreparedPayment();
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      item.id === cycle
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {item.label}
                    {item.discountBasisPoints > 0
                      ? ` · -${Math.round(item.discountBasisPoints / 100)}%`
                      : ""}
                  </button>
                ))}
              </div>

              <div className="mt-7 grid gap-5 lg:grid-cols-3">
                {plans.map((plan) => {
                  const selected = selectedPlan === plan.id;
                  const total = getPlanPriceCents(plan.id);
                  const action = getPlanAction(
                    planChangeState,
                    plan.id,
                  );
                  const isCurrent = action === "current";
                  const isBlocked = action === "blocked";
                  const isScheduled =
                    planChangeState?.pendingChange?.planCode ===
                    plan.id;
                  const capacityBlocked = Boolean(
                    planChangeState &&
                      (planChangeState.usage.members > plan.users ||
                        planChangeState.usage.channels > plan.channels),
                  );

                  const actionBadge = isScheduled
                    ? "Scheduled"
                    : isCurrent
                      ? "Current plan"
                      : isBlocked
                        ? !planChangeState?.canManage
                          ? "Owner only"
                          : planChangeState?.mode === "suspended"
                            ? "Suspended"
                            : capacityBlocked
                              ? "Usage too high"
                              : "Unavailable"
                        : action === "subscribe" && isExpired
                          ? "Renew"
                          : planActionLabel(action);

                  return (
                    <button
                      key={plan.id}
                      type="button"
                      disabled={isCurrent || isBlocked || planChangeLoading}
                      onClick={() => {
                        setSelectedPlan(plan.id);
                        setPlanChangeError(null);
                        setPlanChangeNotice(null);
                        resetPreparedPayment();
                      }}
                      className={`rounded-[24px] border p-5 text-left transition ${
                        selected
                          ? "border-blue-500 bg-blue-50 ring-4 ring-blue-100"
                          : isCurrent
                            ? "border-emerald-200 bg-emerald-50"
                            : isBlocked
                              ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-bold text-slate-950">
                          {plan.name}
                        </h3>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {plan.id === "standard" && !isCurrent ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                              Recommended
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                              isCurrent
                                ? "bg-emerald-100 text-emerald-700"
                                : isScheduled
                                  ? "bg-indigo-100 text-indigo-700"
                                  : action === "upgrade"
                                    ? "bg-blue-100 text-blue-700"
                                    : action === "downgrade"
                                      ? "bg-amber-100 text-amber-700"
                                      : action === "subscribe"
                                        ? "bg-violet-100 text-violet-700"
                                        : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {actionBadge}
                          </span>
                        </div>
                      </div>

                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {plan.description}
                      </p>

                      <div className="mt-5 flex items-end gap-2">
                        <p className="text-3xl font-bold text-slate-950">
                          {formatUsdFromCents(total)}
                        </p>
                        <p className="pb-1 text-xs text-slate-500">
                          / {selectedCycle.label.toLowerCase()}
                        </p>
                      </div>

                      <div className="mt-5 space-y-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
                        <p>
                          {plan.channels} channel
                          {plan.channels === 1 ? "" : "s"}
                        </p>
                        <p>{plan.users} team members</p>
                        {capacityBlocked ? (
                          <p className="pt-1 text-xs font-semibold text-red-600">
                            Current workspace usage must be reduced before this plan is allowed.
                          </p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-7 rounded-2xl border border-blue-200 bg-blue-50 p-5">
                <p className="font-semibold text-slate-900">
                  Workspace limits are protected server-side
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  TENH validates the authenticated workspace owner, current subscription state, plan direction, and active member/channel usage again on the server and in PostgreSQL. Direct payment URLs cannot bypass these checks.
                </p>
              </div>

              {planChangeState?.mode === "unmanaged" ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  This legacy workspace has no managed subscription record, so self-service plan purchases are disabled.
                </div>
              ) : planChangeState?.mode === "suspended" ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  This workspace is suspended. Plan payments and changes are disabled until TENH support restores access.
                </div>
              ) : !planChangeState?.canManage && !planChangeLoading ? (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Only the workspace owner can subscribe or change plans.
                </div>
              ) : null}

              <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-950 p-5 text-white shadow-sm sm:p-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
                      Next step
                    </p>
                    {selectedPlanDefinition &&
                    selectedCheckoutTotalCents !== null &&
                    selectedPlanAction ? (
                      <>
                        <p className="mt-2 text-xl font-bold">
                          {selectedPlanDefinition.name} · {selectedCycle.label}
                        </p>
                        <p className="mt-1 text-sm text-slate-300">
                          {selectedPlanAction === "downgrade"
                            ? `Next-period price: ${formatUsdFromCents(selectedCheckoutTotalCents)} USD · No charge now`
                            : selectedPlanAction === "current"
                              ? "This plan is already active."
                              : selectedPlanAction === "blocked"
                                ? "This plan is not available for the current workspace state."
                                : `Total: ${formatUsdFromCents(selectedCheckoutTotalCents)} USD`}
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-slate-300">
                        {planChangeLoading
                          ? "Checking subscription security..."
                          : "Select an available package above before continuing."}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={
                      !selectedPlan ||
                      !selectedPlanAction ||
                      selectedPlanAction === "current" ||
                      selectedPlanAction === "blocked" ||
                      planChangeLoading ||
                      planChangeSubmitting
                    }
                    onClick={continueSelectedPlan}
                    className="inline-flex min-w-[220px] items-center justify-center rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  >
                    {planChangeSubmitting
                      ? "Updating..."
                      : selectedPlanAction === "upgrade"
                        ? "Continue to upgrade payment"
                        : selectedPlanAction === "downgrade"
                          ? planChangeState?.pendingChange?.planCode === selectedPlan
                            ? "Update scheduled downgrade"
                            : "Schedule downgrade"
                          : selectedPlanAction === "subscribe"
                            ? isExpired
                              ? "Continue to renewal payment"
                              : "Continue to payment"
                            : selectedPlanAction === "current"
                              ? "Current plan"
                              : !planChangeState?.canManage && !planChangeLoading
                                ? "Owner only"
                                : "Unavailable"}
                  </button>
                </div>

                <p className="mt-4 text-xs leading-5 text-slate-400">
                  {selectedPlanAction === "upgrade"
                    ? "Upgrades require payment. TENH changes the active plan only after the payment is approved/verified."
                    : selectedPlanAction === "downgrade"
                      ? `Scheduling does not charge the customer and does not reduce the current plan. The current plan stays active until ${formatDate(subscription?.current_period_end ?? null)}; the lower plan requires a new approved payment for the next period.`
                      : selectedPlanAction === "subscribe"
                        ? isExpired
                          ? "Renewal is prepaid. TENH does not auto-charge: the selected plan and billing period become active only after the new payment is approved."
                          : "Customers without an active paid subscription must complete payment before the selected plan becomes active."
                        : selectedPlanAction === "current"
                          ? "Duplicate payment for the currently-active plan is blocked. Renew after the current prepaid period expires."
                          : "TENH validates plan changes on the server and database; changing the URL or calling a payment API directly does not bypass subscription rules."}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
