"use client";

import Script from "next/script";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import {
  TENH_BILLING_CYCLES,
  TENH_PLANS,
  calculateCustomTotalCents,
  calculatePlanTotalCents,
  formatUsdFromCents,
  type BillingCycle,
  type PlanCode,
} from "@/lib/subscription/plan-catalog";


function PaymentLockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function PaymentShieldIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6l-7-3Z" />
      <path d="m9.4 12 1.8 1.8 3.8-4" />
    </svg>
  );
}

function PaymentBankIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m3 9 9-5 9 5" />
      <path d="M5 10v7M9 10v7M15 10v7M19 10v7M3 20h18M4 17h16" />
    </svg>
  );
}

function PaymentLinkIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M9 12a3 3 0 0 0 3 3h3a3 3 0 1 0 0-6h-1" />
      <path d="M15 12a3 3 0 0 0-3-3H9a3 3 0 1 0 0 6h1" />
    </svg>
  );
}

function PaymentUsersIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20v-1.4A4.6 4.6 0 0 1 8.1 14h1.8a4.6 4.6 0 0 1 4.6 4.6V20" />
      <path d="M16 5.2a3 3 0 0 1 0 5.8M17.2 14.2a4.6 4.6 0 0 1 3.3 4.4V20" />
    </svg>
  );
}

function PaymentClockIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function PaymentHeadsetIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M18 19h-2M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3ZM20 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z" />
    </svg>
  );
}

function PaymentCheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function PaymentEditIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-5 1 1-5L16.5 3.5Z" />
    </svg>
  );
}

function PaymentUploadIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 16V5" />
      <path d="m8 9 4-4 4 4" />
      <path d="M5 18.5a4 4 0 0 1-.2-8 6.5 6.5 0 0 1 12.4-1.7A4.6 4.6 0 1 1 18 18.5h-2" />
    </svg>
  );
}

type CheckoutMethod = "payway" | "manual";

type PayWayPaymentState =
  | "idle"
  | "waiting"
  | "approved"
  | "pending"
  | "declined"
  | "cancelled"
  | "failed";

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
  proofFileName: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
};

declare global {
  interface Window {
    TenhAbaPaywayBridge?: {
      isReady: () => boolean;
      checkout: () => void;
    };
  }
}

type SubscriptionPaymentViewProps = {
  planCode: PlanCode;
  billingCycle: BillingCycle;
  initialPayWayReturn?: string | null;
  initialTransactionId?: string | null;

  /*
   * Everything below was already being passed by
   * app/dashboard/subscription/payment/page.tsx but was never declared
   * here, so React dropped it and TypeScript reported the mismatch (it
   * was part of the standing error count). The consequences were real:
   *
   *  - purchaseBusinessId was lost, so buying an EXTRA subscription was
   *    charged against the CURRENT workspace. If that workspace already
   *    had an active paid period the database refused with
   *    TENH_CUSTOM_ACTIVE_PERIOD_BLOCKED.
   *  - customConnections / customUsers were lost, so a Custom plan
   *    reached checkout with no capacity.
   *  - renewSame and the customUpgrade fields were lost, so renewals and
   *    capacity upgrades were treated as fresh purchases.
   */

  /** Workspace this purchase belongs to — a new one when buying extra. */
  purchaseBusinessId?: string | null;

  customConnections?: number | null;
  customUsers?: number | null;

  renewSame?: boolean;
  renewalTotalCents?: number | null;

  customUpgrade?: boolean;
  customUpgradeTotalCents?: number | null;
  customUpgradeCurrentConnections?: number | null;
  customUpgradeCurrentUsers?: number | null;
  customUpgradeCurrentBillingCycle?: string | null;
  customUpgradeRemainingDays?: number | null;
  customUpgradeExtensionMonths?: number | null;
  customUpgradeCurrentPeriodEnd?: string | null;
  customUpgradeNewPeriodEnd?: string | null;

  upgradeFromPlanCode?: string | null;
  upgradeTotalCents?: number | null;
};

function statusPanelClasses(
  state: PayWayPaymentState,
) {
  if (state === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    state === "declined" ||
    state === "cancelled" ||
    state === "failed"
  ) {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-blue-200 bg-blue-50 text-blue-800";
}

function payWayStateLabel(
  state: PayWayPaymentState,
  isKhmer = false,
) {
  switch (state) {
    case "approved":
      return isKhmer ? "ការទូទាត់បានអនុម័ត — កំពុងដំណើរការ workspace របស់អ្នក" : "Payment approved — activating your workspace";
    case "declined":
      return isKhmer ? "ការទូទាត់ត្រូវបានបដិសេធ" : "Payment declined";
    case "cancelled":
      return isKhmer ? "ការទូទាត់ត្រូវបានបោះបង់" : "Payment cancelled";
    case "failed":
      return isKhmer ? "ការផ្ទៀងផ្ទាត់ការទូទាត់បានបរាជ័យ" : "Payment verification failed";
    case "pending":
    case "waiting":
      return isKhmer ? "កំពុងរង់ចាំការបញ្ជាក់ការទូទាត់" : "Waiting for payment confirmation";
    case "idle":
    default:
      return isKhmer ? "រួចរាល់សម្រាប់ការទូទាត់" : "Ready for checkout";
  }
}

export function SubscriptionPaymentView({
  planCode,
  billingCycle,
  initialPayWayReturn = null,
  initialTransactionId = null,
  purchaseBusinessId = null,
  customConnections = null,
  customUsers = null,
  renewSame = false,
  renewalTotalCents = null,
  customUpgrade = false,
  customUpgradeTotalCents = null,
  customUpgradeCurrentConnections = null,
  customUpgradeCurrentUsers = null,
  customUpgradeCurrentBillingCycle = null,
  customUpgradeRemainingDays = null,
  customUpgradeExtensionMonths = null,
  customUpgradeCurrentPeriodEnd = null,
  customUpgradeNewPeriodEnd = null,
  upgradeFromPlanCode = null,
  upgradeTotalCents = null,
}: SubscriptionPaymentViewProps) {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const cycleLabel = (label: string, months: number) => {
    if (!isKhmer) return label;
    if (months === 1) return "1 ខែ";
    if (months === 12) return "1 ឆ្នាំ";
    return `${months} ខែ`;
  };
  const billingCycleText = (value: string) => {
    const item = TENH_BILLING_CYCLES.find((entry) => entry.id === value);
    return item ? cycleLabel(item.label, item.months) : value;
  };

  const plan = useMemo(() => {
    if (planCode === "custom") {
      if (customConnections === null || customUsers === null) {
        return null;
      }

      return {
        id: "custom" as const,
        name: "Custom",
        description: "Custom TENH subscription",
        channels: customConnections,
        users: customUsers,
        monthlyCents: 0,
      };
    }

    return TENH_PLANS.find((item) => item.id === planCode) ?? null;
  }, [planCode, customConnections, customUsers]);

  const cycle = useMemo(
    () =>
      TENH_BILLING_CYCLES.find(
        (item) => item.id === billingCycle,
      ) ?? null,
    [billingCycle],
  );

  // The payment page is also used for Custom purchases, Custom Upgrades,
  // same-subscription reactivation, and fixed-plan upgrades. Those flows
  // already pass a trusted server-calculated amount. The old UI ignored the
  // override and called calculatePlanTotalCents(), which returns null for a
  // Custom plan, so the whole payment page returned null (blank screen).
  const totalCents = useMemo(() => {
    if (customUpgrade && customUpgradeTotalCents !== null) {
      return customUpgradeTotalCents;
    }

    if (renewSame && renewalTotalCents !== null) {
      return renewalTotalCents;
    }

    if (upgradeTotalCents !== null) {
      return upgradeTotalCents;
    }

    if (planCode === "custom") {
      if (customConnections === null || customUsers === null) {
        return null;
      }

      return calculateCustomTotalCents(
        customConnections,
        customUsers,
        billingCycle,
      );
    }

    return calculatePlanTotalCents(planCode, billingCycle);
  }, [
    billingCycle,
    customConnections,
    customUpgrade,
    customUpgradeTotalCents,
    customUsers,
    planCode,
    renewSame,
    renewalTotalCents,
    upgradeTotalCents,
  ]);

  const previousPlan = useMemo(
    () =>
      upgradeFromPlanCode
        ? TENH_PLANS.find((item) => item.id === upgradeFromPlanCode) ?? null
        : null,
    [upgradeFromPlanCode],
  );

  const isUpgradeCheckout = Boolean(customUpgrade || upgradeFromPlanCode);
  const checkoutKind = renewSame
    ? "reactivate"
    : isUpgradeCheckout
      ? "upgrade"
      : "new";

  const currentUpgradeCycle = customUpgradeCurrentBillingCycle
    ? TENH_BILLING_CYCLES.find(
        (item) => item.id === customUpgradeCurrentBillingCycle,
      ) ?? null
    : null;

  const summaryConnectionsBefore = customUpgrade
    ? customUpgradeCurrentConnections
    : previousPlan?.channels ?? null;
  const summaryUsersBefore = customUpgrade
    ? customUpgradeCurrentUsers
    : previousPlan?.users ?? null;
  const summaryConnectionsAfter = plan?.channels ?? null;
  const summaryUsersAfter = plan?.users ?? null;

  const formatPaymentDate = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat(isKhmer ? "km-KH" : "en-US", {
      dateStyle: "medium",
    }).format(date);
  };

  const summaryHeading =
    checkoutKind === "upgrade"
      ? t("Upgrade summary", "សង្ខេបការអាប់ក្រេដ")
      : checkoutKind === "reactivate"
        ? t("Reactivation summary", "សង្ខេបការធ្វើឲ្យសកម្មឡើងវិញ")
        : t("New subscription summary", "សង្ខេបការជាវថ្មី");
  const summaryBadge =
    checkoutKind === "upgrade"
      ? t("UPGRADE", "អាប់ក្រេដ")
      : checkoutKind === "reactivate"
        ? t("REACTIVATE", "ធ្វើឲ្យសកម្មឡើងវិញ")
        : t("NEW SUBSCRIPTION", "ការជាវថ្មី");
  const summaryPlanTitle =
    checkoutKind === "upgrade"
      ? planCode === "custom"
        ? t("Custom subscription upgrade", "អាប់ក្រេដការជាវផ្ទាល់ខ្លួន")
        : t(`${plan?.name ?? "TENH"} upgrade`, `អាប់ក្រេដ ${plan?.name ?? "TENH"}`)
      : planCode === "custom"
        ? t("Custom subscription", "ការជាវផ្ទាល់ខ្លួន")
        : plan?.name ?? "TENH";
  const currentDurationLabel = currentUpgradeCycle
    ? cycleLabel(currentUpgradeCycle.label, currentUpgradeCycle.months)
    : null;
  const targetDurationLabel = cycle
    ? cycleLabel(cycle.label, cycle.months)
    : billingCycleText(billingCycle);
  const currentExpiryLabel = formatPaymentDate(customUpgradeCurrentPeriodEnd);
  const newExpiryLabel = formatPaymentDate(customUpgradeNewPeriodEnd);
  const connectionsDelta =
    summaryConnectionsBefore !== null && summaryConnectionsAfter !== null
      ? summaryConnectionsAfter - summaryConnectionsBefore
      : null;
  const usersDelta =
    summaryUsersBefore !== null && summaryUsersAfter !== null
      ? summaryUsersAfter - summaryUsersBefore
      : null;

  const manualPaymentEndpoint = purchaseBusinessId
    ? `/api/manual-payments?purchase_business=${encodeURIComponent(purchaseBusinessId)}`
    : "/api/manual-payments";

  const [checkoutMethod, setCheckoutMethod] =
    useState<CheckoutMethod>("payway");
  const [checkoutLoading, setCheckoutLoading] =
    useState(false);
  const [checkoutError, setCheckoutError] =
    useState<string | null>(null);
  const [payWayPluginReady, setPayWayPluginReady] =
    useState(false);
  const [payWayTransactionId, setPayWayTransactionId] =
    useState<string | null>(initialTransactionId);
  const [payWayPaymentState, setPayWayPaymentState] =
    useState<PayWayPaymentState>(
      initialTransactionId
        ? "waiting"
        : initialPayWayReturn === "approved"
          ? "approved"
          : initialPayWayReturn === "cancelled"
            ? "cancelled"
            : "idle",
    );
  const [payWayStatusText, setPayWayStatusText] =
    useState<string | null>(null);
  const [payWayInvoiceId, setPayWayInvoiceId] =
    useState<string | null>(null);

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
  const [manualQrPreviewOpen, setManualQrPreviewOpen] =
    useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;

    function detectPayWayPlugin() {
      if (cancelled) return;

      const ready =
        window.TenhAbaPaywayBridge?.isReady() === true;

      if (ready) {
        setPayWayPluginReady(true);
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
        t("Unable to initialize PayWay secure checkout. Refresh the page and try again.", "មិនអាចចាប់ផ្តើមការទូទាត់សុវត្ថិភាព PayWay បានទេ។ សូមផ្ទុកទំព័រឡើងវិញ ហើយព្យាយាមម្ដងទៀត។"),
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

    async function loadManualPayment() {
      setManualPaymentLoading(true);
      setManualPaymentError(null);

      try {
        const response = await fetch(
          manualPaymentEndpoint,
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
              t("Unable to load manual payment information.", "មិនអាចផ្ទុកព័ត៌មានការទូទាត់តាមធនាគារដោយដៃបានទេ។"),
          );
        }

        if (!cancelled) {
          const latestRequest = result.request ?? null;
          setManualPaymentConfig(result.config ?? null);
          setManualPaymentRequest(latestRequest);

          if (latestRequest?.status === "submitted") {
            setCheckoutMethod("manual");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setManualPaymentConfig(null);
          setManualPaymentError(
            error instanceof Error
              ? error.message
              : t("Unable to load manual payment information.", "មិនអាចផ្ទុកព័ត៌មានការទូទាត់តាមធនាគារដោយដៃបានទេ។"),
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
  }, [manualPaymentEndpoint]);

  useEffect(() => {
    if (manualPaymentRequest?.status !== "submitted") {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function refreshManualStatus() {
      try {
        const response = await fetch(
          manualPaymentEndpoint,
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
        // A later poll can recover.
      }

      if (!cancelled) {
        timer = setTimeout(refreshManualStatus, 5000);
      }
    }

    timer = setTimeout(refreshManualStatus, 5000);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [manualPaymentEndpoint, manualPaymentRequest?.status]);

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
          invoiceId?: string | null;
        } = {};

        if (text.trim()) {
          result = JSON.parse(text) as typeof result;
        }

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? t("Unable to verify PayWay payment.", "មិនអាចផ្ទៀងផ្ទាត់ការទូទាត់ PayWay បានទេ។"),
          );
        }

        if (cancelled) return;

        const nextState = result.paymentState ?? "pending";
        setPayWayPaymentState(nextState);
        setPayWayStatusText(result.providerStatus ?? null);

        if (nextState === "approved") {
          setCheckoutError(null);
          setPayWayInvoiceId(result.invoiceId ?? null);
          setPayWayStatusText(
            t(
              "Payment approved. Choose Download receipt, Close, or Continue.",
              "ការទូទាត់ត្រូវបានអនុម័ត។ សូមជ្រើសរើស ទាញយកបង្កាន់ដៃ បិទ ឬបន្ត។",
            ),
          );
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
      } catch (error) {
        if (cancelled) return;

        setPayWayStatusText(
          error instanceof Error
            ? error.message
            : t("Unable to verify payment right now.", "មិនអាចផ្ទៀងផ្ទាត់ការទូទាត់នៅពេលនេះបានទេ។"),
        );

        if (attempts < 100) {
          timer = setTimeout(verifyPayment, 5000);
        }
      }
    }

    void verifyPayment();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [payWayPaymentState, payWayTransactionId]);

  async function startPayWayCheckout() {
    const payWayBridge = window.TenhAbaPaywayBridge;

    if (
      !payWayPluginReady ||
      !payWayBridge?.isReady()
    ) {
      setPayWayPluginReady(false);
      setCheckoutError(
        t("PayWay secure checkout is still loading. Please try again in a moment.", "ការទូទាត់សុវត្ថិភាព PayWay កំពុងផ្ទុក។ សូមព្យាយាមម្ដងទៀតបន្តិចទៀត។"),
      );
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);
    setPayWayStatusText(null);
    setPayWayInvoiceId(null);

    try {
      const response = await fetch(
        "/api/payway/checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            planCode,
            billingCycle,
            paymentMethod: "abapay_khqr",
            // Without these the server prices and targets the wrong
            // workspace — see the note on the props type above.
            ...(purchaseBusinessId ? { purchaseBusinessId } : {}),
            ...(planCode === "custom" && customConnections !== null
              ? { connections: customConnections }
              : {}),
            ...(planCode === "custom" && customUsers !== null
              ? { users: customUsers }
              : {}),
            ...(renewSame ? { renewSame: true } : {}),
            ...(customUpgrade ? { customUpgrade: true } : {}),
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
          result.error ?? t("Unable to start ABA PayWay checkout.", "មិនអាចចាប់ផ្តើមការទូទាត់ ABA PayWay បានទេ។"),
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

      Object.entries(result.fields).forEach(
        ([name, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        },
      );

      document.body.appendChild(form);

      setPayWayTransactionId(result.transactionId);
      setPayWayPaymentState("waiting");
      setPayWayStatusText(
        t("Complete payment in the ABA PayWay secure checkout. TENH will verify the transaction automatically.", "សូមបញ្ចប់ការទូទាត់ក្នុង ABA PayWay។ TENH នឹងផ្ទៀងផ្ទាត់ប្រតិបត្តិការដោយស្វ័យប្រវត្តិ។"),
      );

      payWayBridge.checkout();
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : t("Unable to start ABA PayWay checkout.", "មិនអាចចាប់ផ្តើមការទូទាត់ ABA PayWay បានទេ។"),
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function submitManualPayment() {
    if (!manualPaymentConfig?.enabled) {
      setManualPaymentError(
        t("Manual payment is not available right now.", "ការទូទាត់តាមធនាគារដោយដៃមិនអាចប្រើបាននៅពេលនេះទេ។"),
      );
      return;
    }

    if (manualPaymentRequest?.status === "submitted") {
      setManualPaymentError(
        t("Your previous manual payment is already waiting for review.", "ការទូទាត់តាមធនាគារមុនរបស់អ្នកកំពុងរង់ចាំការត្រួតពិនិត្យរួចហើយ។"),
      );
      return;
    }

    if (!manualProof) {
      setManualPaymentError(
        t("Upload your bank transfer receipt/payment proof.", "សូមផ្ទុកបង្កាន់ដៃផ្ទេរប្រាក់ ឬភស្តុតាងការទូទាត់។"),
      );
      return;
    }

    setManualPaymentSubmitting(true);
    setManualPaymentError(null);

    try {
      const prepareResponse = await fetch(
        "/api/manual-payments",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "prepare-upload",
            planCode,
            billingCycle,
            ...(purchaseBusinessId ? { purchaseBusinessId } : {}),
            ...(planCode === "custom" && customConnections !== null
              ? { connections: customConnections }
              : {}),
            ...(planCode === "custom" && customUsers !== null
              ? { users: customUsers }
              : {}),
            ...(renewSame ? { renewSame: true } : {}),
            ...(customUpgrade ? { customUpgrade: true } : {}),
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
            t("Unable to prepare the payment proof upload.", "មិនអាចរៀបចំការផ្ទុកភស្តុតាងការទូទាត់បានទេ។"),
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
            planCode,
            billingCycle,
            ...(purchaseBusinessId ? { purchaseBusinessId } : {}),
            ...(planCode === "custom" && customConnections !== null
              ? { connections: customConnections }
              : {}),
            ...(planCode === "custom" && customUsers !== null
              ? { users: customUsers }
              : {}),
            ...(renewSame ? { renewSame: true } : {}),
            ...(customUpgrade ? { customUpgrade: true } : {}),
            customerNote: manualCustomerNote.trim(),
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
            t("Unable to submit manual payment proof.", "មិនអាចដាក់ស្នើភស្តុតាងការទូទាត់បានទេ។"),
        );
      }

      setManualPaymentRequest(result.request);
      setManualCustomerNote("");
      setManualProof(null);
    } catch (error) {
      setManualPaymentError(
        error instanceof Error
          ? error.message
          : t("Unable to submit manual payment proof.", "មិនអាចដាក់ស្នើភស្តុតាងការទូទាត់បានទេ។"),
      );
    } finally {
      setManualPaymentSubmitting(false);
    }
  }

  async function leaveCheckoutSafely() {
    const hasPendingPayWay =
      (payWayPaymentState === "waiting" || payWayPaymentState === "pending") &&
      Boolean(payWayTransactionId);

    if (hasPendingPayWay && payWayTransactionId) {
      const shouldCancel = window.confirm(
        t(
          "Cancel this ABA transaction and leave checkout? TENH will close the pending payment before you leave.",
          "បោះបង់ប្រតិបត្តិការ ABA នេះ ហើយចាកចេញពីការទូទាត់ឬ? TENH នឹងបិទការទូទាត់ដែលកំពុងរង់ចាំ មុនពេលអ្នកចាកចេញ។",
        ),
      );
      if (!shouldCancel) return;

      setCheckoutLoading(true);
      setCheckoutError(null);

      try {
        const response = await fetch("/api/payway/cancel-return", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId: payWayTransactionId }),
        });
        const result = (await response.json()) as {
          success?: boolean;
          paymentState?: string;
          error?: string;
        };

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ||
              t(
                "TENH could not safely close the ABA transaction. Please try Cancel again.",
                "TENH មិនអាចបិទប្រតិបត្តិការ ABA ដោយសុវត្ថិភាពបានទេ។ សូមព្យាយាមបោះបង់ម្តងទៀត។",
              ),
          );
        }

        document.getElementById("aba_merchant_request")?.remove();

        if (result.paymentState === "approved") {
          window.location.replace(
            `/dashboard/subscription?payway=approved&tran_id=${encodeURIComponent(
              payWayTransactionId,
            )}`,
          );
          return;
        }

        window.location.replace(
          `/dashboard/subscription?payway=cancelled&tran_id=${encodeURIComponent(
            payWayTransactionId,
          )}`,
        );
        return;
      } catch (error) {
        setCheckoutError(
          error instanceof Error
            ? error.message
            : t(
                "TENH could not safely close the ABA transaction. Please try Cancel again.",
                "TENH មិនអាចបិទប្រតិបត្តិការ ABA ដោយសុវត្ថិភាពបានទេ។ សូមព្យាយាមបោះបង់ម្តងទៀត។",
              ),
        );
        setCheckoutLoading(false);
        return;
      }
    }

    if (manualPaymentRequest?.status === "submitted") {
      const shouldLeave = window.confirm(
        t(
          "Your bank-transfer proof was already submitted and will stay pending for review. Leave checkout?",
          "ភស្តុតាងផ្ទេរប្រាក់របស់អ្នកត្រូវបានដាក់ស្នើរួចហើយ ហើយនឹងនៅរង់ចាំការត្រួតពិនិត្យ។ ចាកចេញពីការទូទាត់ឬ?",
        ),
      );
      if (!shouldLeave) return;
    }

    // Remove checkout-only browser state, then replace the history entry so
    // Back cannot reopen an old upgrade amount for another subscription.
    document.getElementById("aba_merchant_request")?.remove();
    setCheckoutError(null);
    setPayWayStatusText(null);
    setPayWayInvoiceId(null);
    setPayWayTransactionId(null);
    setPayWayPaymentState("idle");
    window.location.replace("/dashboard/subscription");
  }

  function finishApprovedPayWayPayment(includeStatus = true) {
    const transactionSuffix =
      includeStatus && payWayTransactionId
        ? `?payway=approved&tran_id=${encodeURIComponent(payWayTransactionId)}`
        : "";

    window.location.replace(`/dashboard/subscription${transactionSuffix}`);
  }

  async function downloadApprovedReceipt() {
    let invoiceId = payWayInvoiceId;

    if (!invoiceId && payWayTransactionId) {
      try {
        const response = await fetch(
          `/api/payway/status?tran_id=${encodeURIComponent(payWayTransactionId)}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as {
          success?: boolean;
          invoiceId?: string | null;
        };

        if (response.ok && result.success && result.invoiceId) {
          invoiceId = result.invoiceId;
          setPayWayInvoiceId(result.invoiceId);
        }
      } catch {
        // Keep the approved state; the receipt can be opened later.
      }
    }

    if (!invoiceId) {
      setPayWayStatusText(
        t(
          "Your payment is approved, but the receipt is still being prepared. Use Continue now or open Billing history in a moment.",
          "ការទូទាត់របស់អ្នកត្រូវបានអនុម័ត ប៉ុន្តែបង្កាន់ដៃកំពុងត្រូវបានរៀបចំ។ អ្នកអាចចុច បន្ត ឥឡូវនេះ ឬបើកប្រវត្តិការទូទាត់បន្តិចទៀត។",
        ),
      );
      return;
    }

    const returnTo = `/dashboard/subscription${
      payWayTransactionId
        ? `?payway=approved&tran_id=${encodeURIComponent(payWayTransactionId)}`
        : ""
    }`;

    window.location.assign(
      `/dashboard/subscription/invoices/${encodeURIComponent(invoiceId)}` +
        `?autoprint=1&return_to=${encodeURIComponent(returnTo)}`,
    );
  }

  if (!plan || !cycle || totalCents === null) {
    return null;
  }

  const hasSubmittedManual =
    manualPaymentRequest?.status === "submitted";
  const showPreviousManualRejection =
    manualPaymentRequest?.status === "rejected";
  const showPreviousManualApproval =
    manualPaymentRequest?.status === "approved";

  return (
    <div className="min-h-full bg-white px-4 py-6 sm:px-6 lg:px-8">
      <Script
        id="tenh-payway-classic-bridge-payment-page"
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
                  t("ABA PayWay checkout plugin is not ready.", "កម្មវិធីទូទាត់ ABA PayWay មិនទាន់រួចរាល់ទេ។")
                );
              }

              return AbaPayway.checkout();
            },
          };
        `}
      </Script>
      <Script
        id="tenh-payway-checkout-plugin-payment-page"
        src="https://checkout.payway.com.kh/plugins/checkout2-0.js"
        strategy="afterInteractive"
        onReady={() => {
          if (window.TenhAbaPaywayBridge?.isReady()) {
            setPayWayPluginReady(true);
          }
        }}
        onError={() => {
          setPayWayPluginReady(false);
          setCheckoutError(
            t("Unable to load PayWay secure checkout. Refresh the page and try again.", "មិនអាចផ្ទុកការទូទាត់សុវត្ថិភាព PayWay បានទេ។ សូមផ្ទុកទំព័រឡើងវិញ ហើយព្យាយាមម្ដងទៀត។"),
          );
        }}
      />

      <div className="mx-auto w-full max-w-[1040px]">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-blue-600">
              <PaymentLockIcon className="h-3.5 w-3.5" />
              {t("Secure payment", "ការទូទាត់មានសុវត្ថិភាព")}
            </p>

            <h1 className="mt-1.5 text-[28px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[32px]">
              {checkoutKind === "upgrade"
                ? t("Complete your upgrade", "បញ្ចប់ការអាប់ក្រេដរបស់អ្នក")
                : checkoutKind === "reactivate"
                  ? t("Reactivate your subscription", "ធ្វើឲ្យការជាវរបស់អ្នកសកម្មឡើងវិញ")
                  : t("Complete your new subscription", "បញ្ចប់ការជាវថ្មីរបស់អ្នក")}
            </h1>

            <p className="mt-1.5 max-w-4xl text-xs leading-5 text-slate-500 sm:text-sm">
              {checkoutKind === "upgrade"
                ? t(
                    "Review exactly what is changing, then choose how you want to pay. No upgrade is applied until payment is approved.",
                    "ពិនិត្យមើលអ្វីដែលកំពុងផ្លាស់ប្តូរ រួចជ្រើសរើសវិធីទូទាត់។ ការអាប់ក្រេដនឹងមិនត្រូវបានអនុវត្តរហូតដល់ការទូទាត់ត្រូវបានអនុម័ត។",
                  )
                : t(
                    "Review your selected subscription, then choose how you want to pay. TENH verifies the amount before activation.",
                    "ពិនិត្យការជាវដែលបានជ្រើស រួចជ្រើសរើសវិធីទូទាត់។ TENH នឹងផ្ទៀងផ្ទាត់ចំនួនទឹកប្រាក់មុនពេលបើកដំណើរការ។",
                  )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              if (payWayPaymentState === "approved") {
                finishApprovedPayWayPayment(false);
                return;
              }
              void leaveCheckoutSafely();
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <span aria-hidden="true" className="text-base leading-none">←</span>
            {payWayPaymentState === "approved"
              ? t("Close", "បិទ")
              : checkoutKind === "upgrade"
                ? t("Cancel upgrade", "បោះបង់ការអាប់ក្រេដ")
                : t("Cancel checkout", "បោះបង់ការទូទាត់")}
          </button>
        </div>

        <section className="grid gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="relative overflow-hidden rounded-[24px] border border-[#0B3A82] bg-[#012A72] p-4 text-white shadow-[0_18px_55px_rgba(1,42,114,0.22)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-extrabold uppercase tracking-[0.20em] text-blue-100">
                {summaryHeading}
              </p>
              <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-blue-100">
                {summaryBadge}
              </span>
            </div>

            <div className="mt-4 rounded-[20px] border border-white/20 bg-white/[0.08] p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-sm">
                  {planCode === "custom" ? (
                    <img
                      src="/images/custom.png"
                      alt={t("Custom plan", "គម្រោងផ្ទាល់ខ្លួន")}
                      className="h-11 w-11 object-contain"
                      draggable={false}
                    />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-xl font-black text-blue-700">
                      {plan.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-extrabold leading-6">{summaryPlanTitle}</p>
                  <p className="mt-1 text-sm font-semibold text-blue-100/85">
                    {checkoutKind === "upgrade" && currentDurationLabel
                      ? `${currentDurationLabel} → ${targetDurationLabel}`
                      : targetDurationLabel}
                  </p>
                  {customUpgradeRemainingDays !== null && checkoutKind === "upgrade" ? (
                    <p className="mt-1 text-xs text-blue-100/65">
                      {isKhmer
                        ? `នៅសល់ ${customUpgradeRemainingDays} ថ្ងៃក្នុងរយៈពេលបច្ចុប្បន្ន`
                        : `${customUpgradeRemainingDays} day${customUpgradeRemainingDays === 1 ? "" : "s"} remaining in the current period`}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 border-t border-white/15 pt-4">
                <div className="flex items-end justify-between gap-4">
                  <p className="text-sm font-medium text-blue-100/75">
                    {checkoutKind === "upgrade"
                      ? t("Upgrade amount", "តម្លៃអាប់ក្រេដ")
                      : t("Total to pay", "សរុបត្រូវបង់")}
                  </p>
                  <p className="text-2xl font-black tracking-tight">
                    {formatUsdFromCents(totalCents)}
                  </p>
                </div>
                <p className="mt-2 text-right text-xs text-blue-100/65">
                  {checkoutKind === "upgrade"
                    ? t(
                        "Only the selected upgrade changes are charged.",
                        "គិតថ្លៃតែការផ្លាស់ប្តូរអាប់ក្រេដដែលបានជ្រើសប៉ុណ្ណោះ។",
                      )
                    : t(
                        "USD · Based on your selected subscription",
                        "USD · គណនាតាមការជាវដែលអ្នកបានជ្រើស",
                      )}
                </p>
              </div>
            </div>

            <dl className="mt-4 grid gap-2.5">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.08] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/30 text-blue-100">
                    <PaymentLinkIcon />
                  </span>
                  <dt className="text-sm font-medium text-blue-100/80">
                    {t("Connections", "ការតភ្ជាប់")}
                  </dt>
                </div>
                <dd className="text-right text-sm font-extrabold">
                  {checkoutKind === "upgrade" && summaryConnectionsBefore !== null
                    ? `${summaryConnectionsBefore} → ${summaryConnectionsAfter}`
                    : summaryConnectionsAfter}
                  {checkoutKind === "upgrade" && connectionsDelta !== null && connectionsDelta > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-100">+{connectionsDelta}</span>
                  ) : null}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.08] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/30 text-violet-100">
                    <PaymentUsersIcon />
                  </span>
                  <dt className="text-sm font-medium text-blue-100/80">
                    {t("Team users", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  </dt>
                </div>
                <dd className="text-right text-sm font-extrabold">
                  {checkoutKind === "upgrade" && summaryUsersBefore !== null
                    ? `${summaryUsersBefore} → ${summaryUsersAfter}`
                    : summaryUsersAfter}
                  {checkoutKind === "upgrade" && usersDelta !== null && usersDelta > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-100">+{usersDelta}</span>
                  ) : null}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.08] p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/25 text-cyan-100">
                    <PaymentClockIcon />
                  </span>
                  <dt className="text-sm font-medium text-blue-100/80">
                    {t("Billing duration", "រយៈពេលការជាវ")}
                  </dt>
                </div>
                <dd className="text-right text-sm font-extrabold">
                  {checkoutKind === "upgrade" && currentDurationLabel
                    ? `${currentDurationLabel} → ${targetDurationLabel}`
                    : targetDurationLabel}
                  {checkoutKind === "upgrade" && customUpgradeExtensionMonths !== null && customUpgradeExtensionMonths > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-100">+{customUpgradeExtensionMonths} mo</span>
                  ) : null}
                </dd>
              </div>

              {checkoutKind === "upgrade" && currentExpiryLabel && newExpiryLabel ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4">
                  <dt className="text-xs font-medium text-blue-100/70">
                    {t("Subscription expiry", "ថ្ងៃផុតកំណត់ការជាវ")}
                  </dt>
                  <dd className="mt-1 text-sm font-extrabold">
                    {currentExpiryLabel === newExpiryLabel
                      ? `${currentExpiryLabel} · ${t("No change", "មិនប្រែប្រួល")}`
                      : `${currentExpiryLabel} → ${newExpiryLabel}`}
                  </dd>
                </div>
              ) : null}
            </dl>

            {payWayPaymentState !== "approved" ? (
              <button
                type="button"
                onClick={() => void leaveCheckoutSafely()}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-300 hover:text-blue-200"
              >
                {checkoutKind === "upgrade"
                  ? t("Edit upgrade", "កែការអាប់ក្រេដ")
                  : t("Change selection", "ប្តូរការជ្រើសរើស")}
                <PaymentEditIcon />
              </button>
            ) : null}

            <p className="mt-3 text-xs leading-5 text-blue-100/65">
              {t(
                "Safe to go back: your subscription changes only after payment is approved.",
                "អាចត្រឡប់ក្រោយដោយសុវត្ថិភាព៖ ការជាវរបស់អ្នកនឹងផ្លាស់ប្តូរតែបន្ទាប់ពីការទូទាត់ត្រូវបានអនុម័តប៉ុណ្ណោះ។",
              )}
            </p>
          </aside>

          <div className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.07)] sm:p-4 lg:p-6">
              {payWayPaymentState === "approved" ? (
                <div className="absolute inset-0 z-20 flex min-h-[520px] items-center justify-center bg-white p-5 sm:p-7">
                  <div className="w-full max-w-[560px] text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <PaymentCheckIcon className="h-8 w-8" />
                    </div>
                    <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.16em] text-emerald-600">
                      {t("Payment successful", "ការទូទាត់ជោគជ័យ")}
                    </p>
                    <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">
                      {checkoutKind === "upgrade"
                        ? t("Your upgrade is active", "ការអាប់ក្រេដរបស់អ្នកសកម្មហើយ")
                        : checkoutKind === "reactivate"
                          ? t("Your subscription is active again", "ការជាវរបស់អ្នកសកម្មឡើងវិញហើយ")
                          : t("Your subscription is active", "ការជាវរបស់អ្នកសកម្មហើយ")}
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                      {t(
                        "Nothing will redirect automatically. Download your receipt, close this checkout, or continue when you are ready.",
                        "ទំព័រនេះនឹងមិនបញ្ជូនអ្នកចេញដោយស្វ័យប្រវត្តិទេ។ អ្នកអាចទាញយកបង្កាន់ដៃ បិទការទូទាត់ ឬបន្តនៅពេលរួចរាល់។",
                      )}
                    </p>

                    {payWayTransactionId ? (
                      <div className="mx-auto mt-5 max-w-md rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          {t("Transaction", "ប្រតិបត្តិការ")}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs font-semibold text-slate-700">
                          {payWayTransactionId}
                        </p>
                      </div>
                    ) : null}

                    {payWayStatusText ? (
                      <p className="mx-auto mt-3 max-w-md text-xs leading-5 text-slate-500">
                        {payWayStatusText}
                      </p>
                    ) : null}

                    <div className="mt-6 grid gap-2.5 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => void downloadApprovedReceipt()}
                        className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
                      >
                        {t("Download receipt", "ទាញយកបង្កាន់ដៃ")}
                      </button>
                      <button
                        type="button"
                        onClick={() => finishApprovedPayWayPayment(false)}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        {t("Close", "បិទ")}
                      </button>
                      <button
                        type="button"
                        onClick={() => finishApprovedPayWayPayment(true)}
                        className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700"
                      >
                        {t("Continue", "បន្ត")}
                      </button>
                    </div>

                    {!payWayInvoiceId ? (
                      <p className="mt-3 text-xs text-amber-700">
                        {t(
                          "Receipt is being prepared. You can continue now and download it later from Billing history.",
                          "បង្កាន់ដៃកំពុងត្រូវបានរៀបចំ។ អ្នកអាចបន្តឥឡូវនេះ ហើយទាញយកវាពេលក្រោយពីប្រវត្តិការទូទាត់។",
                        )}
                      </p>
                    ) : (
                      <p className="mt-3 text-xs text-slate-400">
                        {t(
                          "After the receipt print/download window closes, TENH returns you to Subscription.",
                          "បន្ទាប់ពីបង្អួចបោះពុម្ព/ទាញយកបង្កាន់ដៃត្រូវបានបិទ TENH នឹងត្រឡប់អ្នកទៅទំព័រការជាវ។",
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              <p className="text-sm font-bold text-slate-950">
                {t("Payment method", "វិធីទូទាត់")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {t(
                  checkoutKind === "upgrade"
                    ? "Select a payment method to complete this upgrade."
                    : "Select a payment method to complete your subscription.",
                  checkoutKind === "upgrade"
                    ? "ជ្រើសរើសវិធីទូទាត់ ដើម្បីបញ្ចប់ការអាប់ក្រេដនេះ។"
                    : "ជ្រើសរើសវិធីទូទាត់ ដើម្បីបញ្ចប់ការជាវរបស់អ្នក។",
                )}
              </p>

              <div className="mt-4 grid gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutMethod("payway");
                    setManualPaymentError(null);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    checkoutMethod === "payway"
                      ? "border-blue-500 bg-blue-50/45 ring-1 ring-blue-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-14 w-14 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="flex flex-1 items-center justify-center bg-[#0C5967] text-sm font-black tracking-[0.18em] text-white">
                        ABA
                      </div>
                      <div className="flex h-5 items-center justify-center bg-red-600 text-[8px] font-black uppercase tracking-wide text-white">
                        KHQR
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-extrabold text-slate-950">
                        ABA KHQR
                      </p>
                      <p className="mt-1 text-sm leading-5 text-slate-500">
                        {t("Scan to pay with any banking app.", "ស្កេនដើម្បីទូទាត់ជាមួយកម្មវិធីធនាគារណាមួយ។")}
                      </p>
                    </div>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                      checkoutMethod === "payway"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-white text-transparent"
                    }`}>
                      <PaymentCheckIcon />
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={
                    manualPaymentLoading ||
                    !manualPaymentConfig?.enabled
                  }
                  onClick={() => {
                    setCheckoutMethod("manual");
                    setCheckoutError(null);
                  }}
                  className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    checkoutMethod === "manual"
                      ? "border-blue-500 bg-blue-50/45 ring-1 ring-blue-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                      <PaymentBankIcon />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-extrabold text-slate-950">
                        {t("Manual bank transfer", "ផ្ទេរប្រាក់តាមធនាគារដោយដៃ")}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-slate-500">
                        {t(
                          "Transfer, upload receipt, and wait for review.",
                          "ផ្ទេរប្រាក់ ផ្ទុកបង្កាន់ដៃ ហើយរង់ចាំការត្រួតពិនិត្យ។",
                        )}
                      </p>
                    </div>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                      checkoutMethod === "manual"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-300 bg-white text-transparent"
                    }`}>
                      <PaymentCheckIcon />
                    </span>
                  </div>
                </button>
              </div>

              <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <PaymentShieldIcon />
                </span>
                <div>
                  <p className="font-extrabold text-blue-700">
                    {t("Secure & Verified", "មានសុវត្ថិភាព និងបានផ្ទៀងផ្ទាត់")}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {t(
                      "TENH verifies your plan and payment before activation. This is a one-time payment for the selected subscription period.",
                      "TENH ផ្ទៀងផ្ទាត់គម្រោង និងការទូទាត់របស់អ្នក មុនពេលបើកដំណើរការ។ នេះជាការទូទាត់តែម្តងសម្រាប់រយៈពេលការជាវដែលបានជ្រើស។",
                    )}
                  </p>
                </div>
              </div>

              {checkoutMethod === "payway" ? (
                <div className="mt-5 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
                        ABA PayWay
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        {t("Total", "សរុប")}
                      </p>
                      <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                        {formatUsdFromCents(totalCents)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        void startPayWayCheckout();
                      }}
                      disabled={
                        checkoutLoading ||
                        !payWayPluginReady
                      }
                      className="inline-flex min-w-[230px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-base font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <PaymentLockIcon />
                      {checkoutLoading
                        ? t("Opening ABA PayWay...", "កំពុងបើក ABA PayWay...")
                        : !payWayPluginReady
                          ? t("Loading PayWay...", "កំពុងផ្ទុក PayWay...")
                          : t("Checkout", "ទូទាត់")}
                    </button>
                  </div>

                  {checkoutError ? (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {checkoutError}
                    </div>
                  ) : null}

                  {payWayTransactionId || payWayPaymentState === "cancelled" ? (
                    <div
                      className={`mt-4 rounded-xl border px-4 py-3 text-sm ${statusPanelClasses(
                        payWayPaymentState,
                      )}`}
                    >
                      <p className="font-semibold">
                        {payWayStateLabel(payWayPaymentState, isKhmer)}
                      </p>
                      <p className="mt-1 text-xs opacity-80">
                        {payWayTransactionId
                          ? isKhmer
                            ? `ប្រតិបត្តិការ ${payWayTransactionId}`
                            : `Transaction ${payWayTransactionId}`
                          : t("No payment was applied.", "មិនមានការទូទាត់ត្រូវបានអនុវត្តទេ។")}
                        {payWayStatusText
                          ? ` · ${payWayStatusText}`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {checkoutMethod === "manual" ? (
                <div className="mt-4">
                  {hasSubmittedManual ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold">
                          ✓
                        </div>
                        <div className="min-w-0">
                          <p className="text-base font-bold">{t("Payment submitted", "បានដាក់ស្នើការទូទាត់")}</p>
                          <p className="mt-1 leading-6 text-amber-700">
                            {t(
                              "TENH billing is reviewing your transfer. Approval typically takes 1-2 business days. This page checks the status automatically.",
                              "ក្រុមទូទាត់ TENH កំពុងត្រួតពិនិត្យការផ្ទេររបស់អ្នក។ ជាធម្មតាការអនុម័តចំណាយពេល 1-2 ថ្ងៃធ្វើការ ហើយទំព័រនេះនឹងពិនិត្យស្ថានភាពដោយស្វ័យប្រវត្តិ។",
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-amber-100 bg-white/80 p-3">
                        <p className="break-all font-mono text-xs">
                          {t("Request", "សំណើ")} {manualPaymentRequest.id}
                        </p>
                        <p className="mt-2 text-xs">
                          {manualPaymentRequest.planCode.toUpperCase()} · {billingCycleText(manualPaymentRequest.billingCycle)} · {new Intl.NumberFormat("en-US", { style: "currency", currency: manualPaymentRequest.currency }).format(manualPaymentRequest.amount)}
                        </p>
                        <p className="mt-1 text-xs">
                          {t("Receipt", "បង្កាន់ដៃ")}: {manualPaymentRequest.proofFileName}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {showPreviousManualRejection ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 font-bold">
                              !
                            </div>
                            <div>
                              <p className="font-bold">{t("Previous payment was rejected", "ការទូទាត់មុនត្រូវបានបដិសេធ")}</p>
                              <p className="mt-1 text-xs leading-5">
                                {manualPaymentRequest.reviewNote ||
                                  t("Check the transfer details and submit a new receipt.", "សូមពិនិត្យព័ត៌មានផ្ទេរប្រាក់ ហើយដាក់ស្នើបង្កាន់ដៃថ្មី។")}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {showPreviousManualApproval ? (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold">
                              ✓
                            </div>
                            <div>
                              <p className="font-bold">{t("Last manual payment was approved", "ការទូទាត់តាមធនាគារចុងក្រោយត្រូវបានអនុម័ត")}</p>
                              <p className="mt-1 text-xs leading-5 text-emerald-700">
                                {t(
                                  "You can submit a new payment here if you are purchasing another billing period.",
                                  "អ្នកអាចដាក់ស្នើការទូទាត់ថ្មីនៅទីនេះ ប្រសិនបើអ្នកកំពុងទិញរយៈពេលការជាវថ្មីមួយទៀត។",
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="grid gap-3 md:grid-cols-2">
                        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <h3 className="text-base font-extrabold text-slate-950">
                            {t("Transfer details", "ព័ត៌មានផ្ទេរប្រាក់")}
                          </h3>

                          <dl className="mt-3 divide-y divide-dashed divide-slate-200">
                            <div className="flex items-center justify-between gap-4 py-3">
                              <dt className="text-sm text-slate-500">{t("Payment amount", "ចំនួនទឹកប្រាក់ទូទាត់")}</dt>
                              <dd className="text-base font-extrabold text-slate-950">
                                {formatUsdFromCents(totalCents)}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-3">
                              <dt className="text-sm text-slate-500">{t("Bank", "ធនាគារ")}</dt>
                              <dd className="text-right text-sm font-bold text-slate-950">
                                {manualPaymentConfig?.bankName || "—"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-3">
                              <dt className="text-sm text-slate-500">{t("Account name", "ឈ្មោះគណនី")}</dt>
                              <dd className="text-right text-sm font-bold text-slate-950">
                                {manualPaymentConfig?.accountName || "—"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-3">
                              <dt className="text-sm text-slate-500">{t("Account number", "លេខគណនី")}</dt>
                              <dd className="text-right text-sm font-bold text-slate-950">
                                {manualPaymentConfig?.accountNumber || "—"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-4 py-3">
                              <dt className="text-sm text-slate-500">{t("Currency", "រូបិយប័ណ្ណ")}</dt>
                              <dd className="text-sm font-bold text-slate-950">USD</dd>
                            </div>
                          </dl>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <h3 className="text-base font-extrabold text-slate-950">
                            {t("Scan ABA KHQR", "ស្កេន ABA KHQR")}
                          </h3>

                          {manualPaymentConfig?.enabled && manualPaymentConfig.qrImageUrl ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setManualQrPreviewOpen(true)}
                                className="mx-auto mt-3 block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-blue-300 hover:shadow-md"
                                aria-label={t("View payment QR larger", "មើល QR ទូទាត់ឱ្យធំ")}
                              >
                                <img
                                  src={manualPaymentConfig.qrImageUrl}
                                  alt={t("TENH manual payment QR", "QR ទូទាត់ TENH")}
                                  className="mx-auto h-[122px] w-[122px] rounded-xl object-contain"
                                />
                              </button>

                              <p className="mt-3 text-center text-sm font-medium text-slate-600">
                                {t("Scan to pay", "ស្កេនដើម្បីទូទាត់")}{" "}
                                <span className="text-xl font-extrabold text-blue-600">
                                  {formatUsdFromCents(totalCents)}
                                </span>
                              </p>
                              <p className="mt-1 text-center text-xs text-slate-500">
                                {t("After payment, upload your receipt below.", "បន្ទាប់ពីទូទាត់ សូមផ្ទុកបង្កាន់ដៃរបស់អ្នកខាងក្រោម។")}
                              </p>
                            </>
                          ) : (
                            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                              {t("Payment QR is not available right now.", "QR សម្រាប់ទូទាត់មិនអាចប្រើបាននៅពេលនេះទេ។")}
                            </div>
                          )}
                        </section>
                      </div>

                      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <h3 className="text-base font-extrabold text-slate-950">
                          {t("Upload payment receipt", "ផ្ទុកបង្កាន់ដៃទូទាត់")}
                        </h3>

                        <label className="relative mt-3 flex min-h-[108px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/20 px-4 py-4 text-center transition hover:border-blue-400 hover:bg-blue-50/40">
                          <span className="text-blue-600">
                            <PaymentUploadIcon />
                          </span>
                          <span className="mt-2 text-sm font-semibold text-slate-700">
                            {manualProof ? manualProof.name : t("Upload your receipt here", "ផ្ទុកបង្កាន់ដៃរបស់អ្នកនៅទីនេះ")}
                          </span>
                          <span className="mt-1 text-sm text-slate-500">
                            {t("or", "ឬ")} <span className="font-semibold text-blue-600">{t("click to browse", "ចុចដើម្បីជ្រើសឯកសារ")}</span>
                          </span>
                          <span className="mt-2 text-xs text-slate-400">
                            {t("PNG, JPG, WEBP or PDF (Max. 10MB)", "PNG, JPG, WEBP ឬ PDF (អតិបរមា 10MB)")}
                          </span>

                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) =>
                              setManualProof(event.target.files?.[0] ?? null)
                            }
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label={t("Upload payment receipt", "ផ្ទុកបង្កាន់ដៃទូទាត់")}
                          />
                        </label>

                        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400 font-bold">
                            !
                          </span>
                          <p>
                            {t(
                              "Make sure the transfer amount and transaction details match your order. Approval usually takes 1-2 business days.",
                              "សូមប្រាកដថាចំនួនទឹកប្រាក់ផ្ទេរ និងព័ត៌មានប្រតិបត្តិការ ត្រូវគ្នានឹងការបញ្ជាទិញរបស់អ្នក។ ជាធម្មតាការអនុម័តចំណាយពេល 1-2 ថ្ងៃធ្វើការ។",
                            )}
                          </p>
                        </div>

                        <label className="mt-4 block text-sm font-semibold text-slate-900">
                          {t("Note", "ចំណាំ")}
                          <span className="ml-1 text-xs font-normal text-slate-500">{t("(optional)", "(មិនចាំបាច់)")}</span>

                          <textarea
                            rows={2}
                            maxLength={1000}
                            value={manualCustomerNote}
                            onChange={(event) => setManualCustomerNote(event.target.value)}
                            placeholder={t("Add any information TENH billing should know", "បន្ថែមព័ត៌មានណាមួយដែលក្រុមទូទាត់ TENH គួរដឹង")}
                            className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={() => void submitManualPayment()}
                          disabled={
                            !manualPaymentConfig?.enabled ||
                            manualPaymentSubmitting ||
                            !manualProof
                          }
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                        >
                          <PaymentLockIcon />
                          {manualPaymentSubmitting
                            ? t("Submitting payment...", "កំពុងដាក់ស្នើការទូទាត់...")
                            : isKhmer
                              ? `ដាក់ស្នើការទូទាត់ · ${formatUsdFromCents(totalCents)}`
                              : `Submit payment · ${formatUsdFromCents(totalCents)}`}
                        </button>
                      </section>

                      {manualPaymentError ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                          {manualPaymentError}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
          </div>
        </section>

        <div className="mt-5 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-3">
          <div className="flex items-start gap-3 px-2">
            <span className="mt-0.5 text-emerald-600">
              <PaymentShieldIcon />
            </span>
            <div>
              <p className="text-sm font-extrabold text-slate-900">
                {t("Secure payment", "ការទូទាត់មានសុវត្ថិភាព")}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("Your payment is protected and verified.", "ការទូទាត់របស់អ្នកត្រូវបានការពារ និងផ្ទៀងផ្ទាត់។")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 border-slate-200 px-2 sm:border-l sm:pl-5">
            <span className="mt-0.5 text-amber-500">
              <PaymentClockIcon />
            </span>
            <div>
              <p className="text-sm font-extrabold text-slate-900">
                {t("One-time payment", "ការទូទាត់តែម្តង")}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("Pay once for this selected subscription period.", "បង់តែម្តងសម្រាប់រយៈពេលការជាវដែលបានជ្រើសនេះ។")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 border-slate-200 px-2 sm:border-l sm:pl-5">
            <span className="mt-0.5 text-violet-600">
              <PaymentHeadsetIcon />
            </span>
            <div>
              <p className="text-sm font-extrabold text-slate-900">
                {t("Need help?", "ត្រូវការជំនួយ?")}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {t("Contact TENH support if you need payment assistance.", "ទាក់ទងក្រុមជំនួយ TENH ប្រសិនបើអ្នកត្រូវការជំនួយអំពីការទូទាត់។")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {manualQrPreviewOpen && manualPaymentConfig?.qrImageUrl ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onClick={() => setManualQrPreviewOpen(false)}
          role="presentation"
        >
          <div
            className="relative max-h-[94vh] w-full max-w-3xl overflow-auto rounded-[28px] bg-white p-4 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setManualQrPreviewOpen(false)}
              className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
              aria-label={t("Close QR preview", "បិទការមើល QR")}
            >
              ×
            </button>

            <img
              src={manualPaymentConfig.qrImageUrl}
              alt={t("Payment QR enlarged", "QR ទូទាត់ទំហំធំ")}
              className="mx-auto max-h-[78vh] w-auto max-w-full rounded-2xl object-contain"
            />
            <p className="mt-4 text-center text-sm font-medium text-slate-600">
              {t(
                "Scan this QR code with your banking app to complete the payment.",
                "ស្កេន QR នេះជាមួយកម្មវិធីធនាគាររបស់អ្នក ដើម្បីបញ្ចប់ការទូទាត់។",
              )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
