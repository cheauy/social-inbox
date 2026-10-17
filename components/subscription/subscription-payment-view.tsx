"use client";

import Script from "next/script";
import { useRouter } from "next/navigation";
import { PaymentAttemptView, paymentAttemptUrl } from "./payment-attempt-view";
import { CheckoutDialog } from "./checkout-dialog";
import { ManualQrPreview } from "./manual-qr-preview";
import {
  useEffect,
  useMemo,
  useRef,
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

function PaymentCheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
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
  | "recovery_required"
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
  savedTransactionTotalCents?: number | null;
  transactionReturnOnly?: boolean;
  /** Buy keeps discovery/plugin preparation on its disabled button. */
  inlineBuy?: boolean;
  onCheckoutOpened?: () => void;
  onCheckoutError?: (message: string) => void;

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
  customUpgradeExtensionBillingCycle?: string | null;
  customUpgradeCurrentPeriodEnd?: string | null;
  customUpgradeNewPeriodEnd?: string | null;

  upgradeFromPlanCode?: string | null;
  upgradeTotalCents?: number | null;
};

export function SubscriptionPaymentView(props: SubscriptionPaymentViewProps) {
  const [sessionEpoch, setSessionEpoch] = useState(0);
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange(event => {
      if (event !== "INITIAL_SESSION" && event !== "TOKEN_REFRESHED") setSessionEpoch(value => value + 1);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return <PaymentCheckout key={`${sessionEpoch}:${JSON.stringify(props)}`} {...props} />;
}

function PaymentCheckout({
  planCode,
  billingCycle,
  initialPayWayReturn = null,
  initialTransactionId = null,
  savedTransactionTotalCents = null,
  transactionReturnOnly = false,
  inlineBuy = false,
  onCheckoutOpened,
  onCheckoutError,
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
  customUpgradeExtensionBillingCycle = null,
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
    if (savedTransactionTotalCents !== null) return savedTransactionTotalCents;
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
    savedTransactionTotalCents,
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

  const router = useRouter();
  const manualPaymentEndpoint = purchaseBusinessId
    ? `/api/manual-payments?mode=checkout&purchase_business=${encodeURIComponent(purchaseBusinessId)}`
    : "/api/manual-payments?mode=checkout";
  const [statusAttempt, setStatusAttempt] = useState<{ kind: "manual" | "payway" | "bakong"; id: string } | null>(
    initialTransactionId ? { kind: "payway", id: initialTransactionId } : null,
  );
  const submitting = useRef(false);
  const manualAttemptId = useRef<string | null>(null);
  const alive = useRef(true);
  const checkoutRequest = useRef<AbortController | null>(null);
  const manualSubmissionRequest = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; checkoutRequest.current?.abort(); manualSubmissionRequest.current?.abort(); }; }, []);

  function enterAttempt(kind: "manual" | "payway" | "bakong", id: string) {
    if (!alive.current) return;
    setStatusAttempt({ kind, id });
    onCheckoutOpened?.();
    // Navigation failure cannot undo a saved payment or expose payment controls again.
    try { router.replace(paymentAttemptUrl(kind, id, purchaseBusinessId)); } catch { /* The status remains mounted. */ }
  }

  const [checkoutMethod, setCheckoutMethod] =
    useState<CheckoutMethod | null>(inlineBuy ? null : "payway");
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] =
    useState(false);
  const [checkoutError, setCheckoutError] =
    useState<string | null>(null);
  const [payWayReviewAttempt, setPayWayReviewAttempt] = useState<string | null>(null);
  const [bakongSafety, setBakongSafety] = useState(!purchaseBusinessId);
  const [bakongLoadError, setBakongLoadError] = useState(false);
  const [bakongUncertain, setBakongUncertain] = useState(false);
  useEffect(() => {
    if (statusAttempt || !purchaseBusinessId) return;
    const controller = new AbortController();
    async function load() {
      setBakongSafety(false); setBakongLoadError(false);
      try {
        const params = new URLSearchParams({ purchase_business: purchaseBusinessId! });
        const intent = new URL(window.location.href).searchParams.get("purchase_intent");
        if (intent) params.set("purchase_intent", intent);
        const response = await fetch(`/api/bakong/checkout?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success || result.businessId !== purchaseBusinessId || !result.userId || !result.memberId) throw new Error();
        if (controller.signal.aborted) return;
        if (result.resumeAttemptId || result.pendingAttemptId) enterAttempt("bakong", result.resumeAttemptId || result.pendingAttemptId);
        else if (intent && (result.intentClosed === true || result.retired === true)) {
          // An absent/closed retired intent cannot create another Bakong payment.
          const url = new URL(window.location.href); url.searchParams.delete("purchase_intent");
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        } else if (intent) setBakongUncertain(true);
        setBakongSafety(true);
      } catch { if (!controller.signal.aborted) setBakongLoadError(true); }
    }
    void load();
    return () => controller.abort();
  // PaymentCheckout is keyed by workspace, purchase props and authenticated session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseBusinessId, statusAttempt]);

  const [payWayPluginReady, setPayWayPluginReady] =
    useState(false);
  const [payWayTransactionId, setPayWayTransactionId] =
    useState<string | null>(initialTransactionId);
  const [payWayPaymentState, setPayWayPaymentState] =
    useState<PayWayPaymentState>(
      initialTransactionId
        ? "waiting"
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
  const [manualLoadError, setManualLoadError] = useState<string | null>(null);
  const [manualCustomerNote, setManualCustomerNote] =
    useState("");
  const [manualProof, setManualProof] =
    useState<File | null>(null);
  const [manualQrPreviewOpen, setManualQrPreviewOpen] =
    useState(false);

  useEffect(() => {
    if (statusAttempt) return;
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
  }, [statusAttempt]);

  useEffect(() => {
    if (statusAttempt) return;
    let cancelled = false;
    const controller = new AbortController();

    async function loadManualPayment() {
      setManualPaymentLoading(true);
      setManualLoadError(null);

      try {
        const response = await fetch(
          manualPaymentEndpoint,
          { cache: "no-store", signal: controller.signal },
        );

        const result = (await response.json()) as {
          success?: boolean;
          error?: string;
          config?: ManualPaymentConfig;
          request?: ManualPaymentRequest | null;
          businessId?: string;
          preparedAttempt?: { id: string; businessId: string; canResume: boolean } | null;
          payWayAttemptId?: string | null;
          payWayReviewRequired?: boolean;
        };

        if (!response.ok || !result.success || !result.businessId || (purchaseBusinessId && result.businessId !== purchaseBusinessId)) {
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
            enterAttempt("manual", latestRequest.id);
          } else if (result.preparedAttempt && result.preparedAttempt.businessId === result.businessId) {
            if (!result.preparedAttempt.canResume) throw new Error(t("An unfinished payment needs its requester's review.", "សំណើទូទាត់មិនទាន់រួច ត្រូវការអ្នកស្នើពិនិត្យ។"));
            enterAttempt("manual", result.preparedAttempt.id);
          } else if (result.payWayAttemptId) {
            if (result.payWayReviewRequired) {
              setPayWayReviewAttempt(result.payWayAttemptId);
              onCheckoutOpened?.();
            } else enterAttempt("payway", result.payWayAttemptId);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setManualPaymentConfig(null);
          setManualLoadError(
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
      controller.abort();
    };
  // Navigation is only a side effect of an identity-checked discovery response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualPaymentEndpoint, statusAttempt]);

  async function startPayWayCheckout() {
    if (checkoutMethod !== "payway" || transactionReturnOnly || submitting.current || statusAttempt || manualPaymentLoading || manualLoadError || !bakongSafety) return;
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

    submitting.current = true;
    const controller = new AbortController();
    checkoutRequest.current = controller;
    setCheckoutLoading(true);
    setCheckoutError(null);
    setPayWayStatusText(null);
    setPayWayInvoiceId(null);

    try {
      const response = await fetch(
        "/api/payway/checkout",
        {
          method: "POST",
          signal: controller.signal,
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
            ...(customUpgrade
              ? {
                  customUpgrade: true,
                  extensionBillingCycle:
                    customUpgradeExtensionBillingCycle ?? "none",
                }
              : {}),
          }),
        },
      );

      const text = await response.text();
      let result: {
        success?: boolean;
        error?: string;
        checkoutUrl?: string;
        transactionId?: string;
        manualRequestId?: string;
        bakongAttemptId?: string;
        businessId?: string;
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

      if (!alive.current || controller.signal.aborted) return;
      if (
        !response.ok ||
        !result.success ||
        !result.checkoutUrl ||
        !result.transactionId ||
        !result.fields
      ) {
        if (result.bakongAttemptId && result.businessId === purchaseBusinessId) {
          enterAttempt("bakong", result.bakongAttemptId);
          return;
        }
        if (result.transactionId) {
          enterAttempt("payway", result.transactionId);
          return;
        }
        if (result.manualRequestId) {
          enterAttempt("manual", result.manualRequestId);
          return;
        }
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

      if (!alive.current) return;
      setPayWayTransactionId(result.transactionId);
      enterAttempt("payway", result.transactionId);
      setPayWayPaymentState("waiting");
      setPayWayStatusText(
        t("Complete payment in the ABA PayWay secure checkout. TENH will verify the transaction automatically.", "សូមបញ្ចប់ការទូទាត់ក្នុង ABA PayWay។ TENH នឹងផ្ទៀងផ្ទាត់ប្រតិបត្តិការដោយស្វ័យប្រវត្តិ។"),
      );

      payWayBridge.checkout();
    } catch (error) {
      if (!alive.current || controller.signal.aborted) return;
      // Reopening checks saved transactions before another checkout can be attempted.
      setManualLoadError(t("Unable to open payment. Reload to check the saved attempt.", "មិនអាចបើកការទូទាត់។ ផ្ទុកឡើងវិញដើម្បីពិនិត្យសំណើដែលបានរក្សាទុក។"));
      setCheckoutError(
        error instanceof Error
          ? error.message
          : t("Unable to start ABA PayWay checkout.", "មិនអាចចាប់ផ្តើមការទូទាត់ ABA PayWay បានទេ។"),
      );
    } finally {
      submitting.current = false;
      if (alive.current) setCheckoutLoading(false);
    }
  }

  useEffect(() => {
    if (!inlineBuy || statusAttempt || (!manualPaymentLoading && bakongSafety)) return;
    const timer = setTimeout(() => onCheckoutError?.(t("Checkout preparation took too long. Try again.", "ការរៀបចំការទូទាត់យូរពេក។ សូមព្យាយាមម្តងទៀត។")), 30000);
    return () => clearTimeout(timer);
  // This only bounds discovery; it never cancels a saved payment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineBuy, manualPaymentLoading, bakongSafety, statusAttempt, onCheckoutError]);
  useEffect(() => {
    if (!inlineBuy || statusAttempt) return;
    const failure = manualLoadError || (bakongLoadError ? t("Unable to check existing payment. Try again.", "មិនអាចពិនិត្យការទូទាត់ដែលមានបានទេ។ សូមព្យាយាមម្តងទៀត។") : null);
    if (failure) { onCheckoutError?.(failure); return; }
    // Reveal the method chooser after discovery. Provider preparation starts
    // only from its explicit selected-method action, never from Buy itself.
    if (!manualPaymentLoading && bakongSafety) onCheckoutOpened?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineBuy, statusAttempt, manualPaymentLoading, bakongSafety, manualLoadError, bakongLoadError, onCheckoutError, onCheckoutOpened]);

  async function manualStage<T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, milliseconds = 20000): Promise<T> {
    if (parent.aborted) throw new Error("Checkout closed.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      return await Promise.race([run(controller.signal), new Promise<T>((_, reject) => {
        abort = () => { controller.abort(); reject(new Error(t("Submission is not confirmed yet. Please try again with the same receipt.", "ការដាក់ស្នើមិនទាន់បានបញ្ជាក់ទេ។ សូមព្យាយាមម្ដងទៀតជាមួយបង្កាន់ដៃដដែល។"))); };
        parent.addEventListener("abort", abort, { once: true });
        timer = setTimeout(abort, milliseconds);
      })]);
    } finally { clearTimeout(timer); parent.removeEventListener("abort", abort); }
  }

  async function submitManualPayment() {
    if (checkoutMethod !== "manual" || transactionReturnOnly || submitting.current || statusAttempt || manualPaymentLoading || !bakongSafety) return;
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

    if (manualProof.size <= 0 || manualProof.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(manualProof.type)) {
      setManualPaymentError(t("Use a JPG, PNG, WebP or PDF up to 10 MB.", "ប្រើ JPG, PNG, WebP ឬ PDF រហូតដល់ 10 MB។"));
      return;
    }
    submitting.current = true;
    const request = new AbortController();
    manualSubmissionRequest.current = request;
    manualAttemptId.current ??= crypto.randomUUID();
    setManualPaymentSubmitting(true);
    setManualPaymentError(null);

    try {
      const { response: prepareResponse, result: prepareResult } = await manualStage(async signal => {
      const prepareResponse = await fetch(
        "/api/manual-payments",
        {
          signal,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "prepare-upload",
            requestId: manualAttemptId.current,
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
            ...(customUpgrade
              ? {
                  customUpgrade: true,
                  extensionBillingCycle:
                    customUpgradeExtensionBillingCycle ?? "none",
                }
              : {}),
            fileName: manualProof.name,
            mimeType: manualProof.type,
            sizeBytes: manualProof.size,
          }),
        },
      );

      const prepareResult = (await prepareResponse.json()) as {
        success?: boolean;
        error?: string;
        code?: string;
        requestId?: string;
        proofUploaded?: boolean;
        bakongAttemptId?: string;
        businessId?: string;
        upload?: {
          bucket: string;
          path: string;
          token: string | null;
        };
      };
      return { response: prepareResponse, result: prepareResult };
      }, request.signal);

      if (
        !prepareResponse.ok ||
        !prepareResult.success ||
        !prepareResult.requestId ||
        !prepareResult.upload
      ) {
        if (prepareResult.bakongAttemptId && prepareResult.businessId === purchaseBusinessId) {
          enterAttempt("bakong", prepareResult.bakongAttemptId);
          return;
        }
        // A definite validation rejection did not commit an upload reservation.
        if ([401, 403].includes(prepareResponse.status)) setManualLoadError(prepareResult.error ?? t("Check the existing payment before trying again.", "ពិនិត្យការទូទាត់ដែលមាន មុនព្យាយាមម្ដងទៀត។"));
        throw new Error(
          prepareResult.error ??
            t("Unable to prepare the payment proof upload.", "មិនអាចរៀបចំការផ្ទុកភស្តុតាងការទូទាត់បានទេ។"),
        );
      }

      if (prepareResult.requestId !== manualAttemptId.current || !alive.current) throw new Error("Payment attempt changed.");
      const supabase = createClient();
      const { bucket, path, token } = prepareResult.upload;

      if (!prepareResult.proofUploaded && !token) throw new Error("Upload link unavailable.");
      const uploadError = prepareResult.proofUploaded ? null : (await manualStage(() => supabase.storage
        .from(bucket)
        .uploadToSignedUrl(
          path,
          token!,
          manualProof,
          {
            contentType: manualProof.type,
          },
        ), request.signal)).error;

      if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
        throw new Error(uploadError.message);
      }
      if (!alive.current) return;

      const { response: finalizeResponse, result } = await manualStage(async signal => {
      const finalizeResponse = await fetch(
        "/api/manual-payments",
        {
          signal,
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
            ...(customUpgrade
              ? {
                  customUpgrade: true,
                  extensionBillingCycle:
                    customUpgradeExtensionBillingCycle ?? "none",
                }
              : {}),
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
      return { response: finalizeResponse, result };
      }, request.signal);

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

      if (result.request.id !== manualAttemptId.current || !["submitted", "approved", "rejected", "cancelled"].includes(result.request.status)) throw new Error("Payment submission is not confirmed. Please check its status and try again.");
      if (!alive.current) return;
      setManualPaymentRequest(result.request);
      setManualCustomerNote("");
      setManualProof(null);
      setManualDialogOpen(false);
      enterAttempt("manual", result.request.id);
    } catch (error) {
      if (!alive.current) return;
      // A lost finalization reply may already have committed. Close only after
      // an exact, authorized saved-state read confirms this same submitted proof.
      if (manualAttemptId.current) {
        try {
          const query = new URLSearchParams({ manual_request: manualAttemptId.current });
          if (purchaseBusinessId) query.set("purchase_business", purchaseBusinessId);
          const { response, saved } = await manualStage(async signal => {
            const response = await fetch(`/api/subscription/payment-status?${query}`, { cache: "no-store", signal });
            return { response, saved: await response.json() };
          }, request.signal, 10000);
          if (!alive.current) return;
          if (response.ok && saved.success && saved.attempt?.kind === "manual" && saved.attempt.id === manualAttemptId.current &&
              ["submitted", "approved", "rejected", "cancelled"].includes(saved.attempt.status) && saved.attempt.businessId && (!purchaseBusinessId || saved.attempt.businessId === purchaseBusinessId)) {
            setManualDialogOpen(false); setManualProof(null); setManualCustomerNote("");
            enterAttempt("manual", manualAttemptId.current); return;
          }
        } catch { /* Retain the same proof and request ID for an idempotent retry. */ }
      }
      if (!alive.current) return;
      // Keep the dialog, selected proof and same request identity on failure.
      setManualPaymentError(
        error instanceof Error
          ? error.message
          : t("Unable to submit manual payment proof.", "មិនអាចដាក់ស្នើភស្តុតាងការទូទាត់បានទេ។"),
      );
    } finally {
      if (manualSubmissionRequest.current === request) manualSubmissionRequest.current = null;
      submitting.current = false;
      if (alive.current) setManualPaymentSubmitting(false);
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
          body: JSON.stringify({ transactionId: payWayTransactionId, confirmed: true }),
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

  const showPreviousManualRejection =
    manualPaymentRequest?.status === "rejected";
  const showPreviousManualApproval =
    manualPaymentRequest?.status === "approved";

  if (statusAttempt) {
    return <PaymentAttemptView kind={statusAttempt.kind} attemptId={statusAttempt.id} businessId={purchaseBusinessId} />;
  }
  if (payWayReviewAttempt) return <section className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
    <div data-payment-card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-slate-950">{t("Previous payment needs review", "ការទូទាត់ពីមុនត្រូវការពិនិត្យ")}</h1>
      <p role="status" className="mt-3 text-sm leading-6 text-slate-600">{t("An earlier payment is still unconfirmed. Billing support must reconcile it before another checkout can open. If you already paid, do not pay again.", "ការទូទាត់ពីមុនមិនទាន់បានបញ្ជាក់។ សូមទាក់ទងផ្នែកគាំទ្រការទូទាត់ ដើម្បីពិនិត្យមុនពេលបើកការទូទាត់ថ្មី។ ប្រសិនបើអ្នកបានបង់ប្រាក់រួច សូមកុំបង់ម្ដងទៀត។")}</p>
      <a href={paymentAttemptUrl("payway", payWayReviewAttempt, purchaseBusinessId)} className="mt-4 inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold">{t("View saved payment", "មើលការទូទាត់ដែលបានរក្សាទុក")}</a>
      <a href="/dashboard/subscription" className="mt-4 block text-sm text-blue-700">{t("Back to subscription", "ត្រឡប់ទៅការជាវ")}</a>
    </div>
  </section>;
  if (bakongUncertain) return <section className="mx-auto mt-6 max-w-xl rounded-2xl border bg-white p-5">
    <h1 className="text-xl font-bold">{t("Payment status", "ស្ថានភាពទូទាត់")}</h1>
    <p role="status" className="mt-3 text-sm">{checkoutError ?? t("Checking the original payment attempt.", "កំពុងពិនិត្យប្រតិបត្តិការទូទាត់ដើម។")}</p>
    <button type="button" className="mt-4 min-h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50" onClick={() => window.location.reload()}>{t("Retry this attempt", "ព្យាយាមប្រតិបត្តិការនេះម្ដងទៀត")}</button>
    <a className="mt-4 block text-sm text-blue-700" href="/dashboard/subscription">{t("Back to subscription", "ត្រឡប់ទៅការជាវ")}</a>
  </section>;
  if (manualPaymentLoading || manualLoadError || !bakongSafety) {
    if (inlineBuy) return null;
    return <section className="mx-auto w-full max-w-md px-4 py-8 sm:py-12" aria-live="polite">
      <div data-payment-card className="relative rounded-2xl border border-slate-200 bg-white px-5 pb-7 pt-14 text-center shadow-sm sm:px-7">
      <a href="/dashboard/subscription" aria-label={t("Close payment status", "បិទស្ថានភាពទូទាត់")} className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl text-slate-400 focus-visible:outline-2 focus-visible:outline-teal-600">×</a>
      {!manualLoadError && !bakongLoadError ? <div aria-hidden="true" className="mx-auto mb-6 h-16 w-16 rounded-full border-[5px] border-teal-100 border-t-teal-600 motion-safe:animate-spin motion-reduce:animate-none" /> : null}
      <h1 className="text-xl font-bold text-slate-950">{manualLoadError || bakongLoadError ? t("Unable to prepare checkout", "មិនអាចរៀបចំការទូទាត់បានទេ") : t("Preparing checkout", "កំពុងរៀបចំការទូទាត់")}</h1>
      <p className="mt-3 text-sm text-slate-500" role={manualLoadError || bakongLoadError ? "alert" : "status"}>{(bakongLoadError ? t("Unable to check existing payment.", "មិនអាចពិនិត្យការទូទាត់ដែលមានបានទេ។") : manualLoadError) ?? t("Checking for an earlier payment before continuing.", "កំពុងពិនិត្យការទូទាត់ពីមុន មុននឹងបន្ត។")}</p>
      {manualLoadError || bakongLoadError ? <button type="button" className="mt-4 min-h-11 rounded-xl border px-4" onClick={() => window.location.reload()}>{t("Try again", "ព្យាយាមម្តងទៀត")}</button> : null}
      </div>
    </section>;
  }

  return (
    <div data-checkout-page className="min-h-full bg-white px-4 py-5 sm:px-5">
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

      <div data-checkout-scroll className="mx-auto w-full max-w-[960px]">
        <header className="relative mb-6 pr-14">
          <div className="flex min-h-11 items-center gap-2.5 text-sm font-extrabold tracking-wide text-slate-950">
            <img src="/images/tenh_logo.png" alt="" className="h-8 w-8 object-contain" /> TENH CHAT
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">{t("Checkout", "ទូទាត់")}</h1>
          <button type="button"
            onClick={() => {
              if (payWayPaymentState === "approved") {
                finishApprovedPayWayPayment(false);
                return;
              }
              void leaveCheckoutSafely();
            }}
            aria-label={t("Close checkout", "បិទការទូទាត់")}
            className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-xl text-2xl text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">×</button>
        </header>

        <section data-checkout-layout className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-7 lg:gap-y-0">
          <aside data-order-summary className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 text-slate-950 shadow-sm sm:p-5 lg:col-start-2 lg:row-start-1 lg:rounded-b-none lg:border-b-0">
            <h2 className="text-base font-bold text-slate-950">{t("Order summary", "សង្ខេបការបញ្ជាទិញ")}</h2>
            <div className="mt-4 border-b border-slate-100 pb-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/95 shadow-sm">
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
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {checkoutKind === "upgrade" && currentDurationLabel
                      ? `${currentDurationLabel} → ${targetDurationLabel}`
                      : targetDurationLabel}
                  </p>
                  {customUpgradeRemainingDays !== null && checkoutKind === "upgrade" ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {isKhmer
                        ? `នៅសល់ ${customUpgradeRemainingDays} ថ្ងៃក្នុងរយៈពេលបច្ចុប្បន្ន`
                        : `${customUpgradeRemainingDays} day${customUpgradeRemainingDays === 1 ? "" : "s"} remaining in the current period`}
                    </p>
                  ) : null}
                </div>
              </div>

            </div>

            <dl className="mt-3 grid gap-1">
              <div className="flex items-center justify-between gap-3 py-1.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500">
                    <PaymentLinkIcon />
                  </span>
                  <dt className="text-sm font-medium text-slate-500">
                    {t("Connections", "ការតភ្ជាប់")}
                  </dt>
                </div>
                <dd className="text-right text-sm font-extrabold">
                  {checkoutKind === "upgrade" && summaryConnectionsBefore !== null
                    ? `${summaryConnectionsBefore} → ${summaryConnectionsAfter}`
                    : summaryConnectionsAfter}
                  {checkoutKind === "upgrade" && connectionsDelta !== null && connectionsDelta > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">+{connectionsDelta}</span>
                  ) : null}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-3 py-1.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500">
                    <PaymentUsersIcon />
                  </span>
                  <dt className="text-sm font-medium text-slate-500">
                    {t("Team members", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  </dt>
                </div>
                <dd className="text-right text-sm font-extrabold">
                  {checkoutKind === "upgrade" && summaryUsersBefore !== null
                    ? `${summaryUsersBefore} → ${summaryUsersAfter}`
                    : summaryUsersAfter}
                  {checkoutKind === "upgrade" && usersDelta !== null && usersDelta > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">+{usersDelta}</span>
                  ) : null}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-3 py-1.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500">
                    <PaymentClockIcon />
                  </span>
                  <dt className="text-sm font-medium text-slate-500">
                    {t("Duration", "រយៈពេលការជាវ")}
                  </dt>
                </div>
                <dd className="text-right text-sm font-extrabold">
                  {checkoutKind === "upgrade" && currentDurationLabel
                    ? `${currentDurationLabel} → ${targetDurationLabel}`
                    : targetDurationLabel}
                  {checkoutKind === "upgrade" && customUpgradeExtensionMonths !== null && customUpgradeExtensionMonths > 0 ? (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">+{customUpgradeExtensionMonths} mo</span>
                  ) : null}
                </dd>
              </div>

              {checkoutKind === "upgrade" && currentExpiryLabel && newExpiryLabel ? (
                <div className="border-t border-slate-100 pt-3">
                  <dt className="text-xs font-medium text-slate-500">
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


          </aside>

          <div data-payment-method-card className="relative min-w-0 lg:col-start-1 lg:row-start-1 lg:row-span-2"><div className="py-1">
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

              <h2 className="text-base font-bold text-slate-950">{t("Pay with", "ទូទាត់ជាមួយ")}</h2>
              <fieldset data-checkout-method-chooser className="mt-3 grid min-w-0 gap-3" disabled={checkoutLoading || manualPaymentSubmitting}>
                <legend className="sr-only">{t("Payment method", "វិធីទូទាត់")}</legend>
                {(["payway", "manual"] as const).map(method => {
                  const disabled = method === "manual" && (transactionReturnOnly || manualPaymentLoading || !manualPaymentConfig?.enabled);
                  return <label key={method} className={`flex min-h-24 min-w-0 items-center gap-3 rounded-2xl border p-4 transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${checkoutMethod === method ? "border-blue-400 bg-blue-50/50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-300"}`}>
                    {method === "payway" ? <img src="/images/aba-khqr.png" alt="" className="h-12 w-12 shrink-0 rounded-xl object-contain" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white"><PaymentBankIcon /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-bold text-slate-950">{method === "payway" ? "ABA PayWay" : t("Bank transfer", "ផ្ទេរប្រាក់តាមធនាគារ")}</span>
                      <span className="mt-1 block text-sm text-slate-500">{method === "payway" ? t("Scan with any bank", "ស្កេនជាមួយធនាគារណាមួយ") : t("Upload receipt", "ផ្ទុកបង្កាន់ដៃ")}</span>
                    </span>
                    <input type="radio" name="checkout-method" value={method} checked={checkoutMethod === method} disabled={disabled}
                      onChange={() => { setCheckoutMethod(method); if (method === "payway") setManualPaymentError(null); else setCheckoutError(null); }}
                      className="h-5 w-5 shrink-0 accent-blue-600" />
                  </label>;
                })}
              </fieldset>
              <p className="mt-5 flex items-center gap-2 text-sm leading-6 text-slate-500"><PaymentLockIcon className="h-4 w-4 shrink-0" />{t("One-time payment. No auto-renewal.", "ការទូទាត់តែម្តង។ មិនបន្តដោយស្វ័យប្រវត្តិ។")}</p>

              {!checkoutMethod ? <p role="status" className="mt-5 text-sm text-slate-500">{t("Choose a payment method to continue.", "ជ្រើសរើសវិធីទូទាត់ដើម្បីបន្ត។")}</p> : null}

            </div>
          </div>
            <footer data-checkout-footer className="relative rounded-2xl border border-slate-200 bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-sm sm:px-5 lg:col-start-2 lg:row-start-2 lg:rounded-t-none lg:border-t-0">
        <div className="mx-auto w-full max-w-[960px]">
          {checkoutError ? <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{checkoutError}</p> : null}
          <div className="flex flex-col gap-4">
            <div className="min-w-0"><p className="text-sm text-slate-500">{t("Total", "សរុប")}</p><p className="text-2xl font-extrabold tracking-tight text-slate-950">{formatUsdFromCents(totalCents)}</p></div>
            <button type="button" onClick={() => { if (checkoutMethod === "manual") setManualDialogOpen(true); else if (checkoutMethod === "payway") void startPayWayCheckout(); }}
              disabled={!checkoutMethod || transactionReturnOnly || checkoutLoading || manualPaymentSubmitting || manualPaymentLoading || !bakongSafety || (checkoutMethod === "payway" && !payWayPluginReady) || (checkoutMethod === "manual" && !manualPaymentConfig?.enabled)}
              className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 sm:min-w-48">
              <PaymentLockIcon />{checkoutLoading ? t("Opening ABA PayWay…", "កំពុងបើក ABA PayWay…") : t("Checkout", "ទូទាត់")}
            </button>
          </div>
        </div>
      </footer>
        </section>

      </div>

      <CheckoutDialog open={manualDialogOpen} busy={manualPaymentSubmitting} title={t("Manual bank transfer", "ផ្ទេរប្រាក់តាមធនាគារដោយដៃ")}
        description={t("Make sure the transfer amount and transaction details match your order. Approval usually takes 1-2 business days.", "សូមប្រាកដថាចំនួនប្រាក់និងព័ត៌មានប្រតិបត្តិការត្រូវនឹងការបញ្ជាទិញ។ ការអនុម័តជាធម្មតាចំណាយពេល 1-2 ថ្ងៃធ្វើការ។")}
        closeLabel={t("Close transfer details", "បិទព័ត៌មានផ្ទេរប្រាក់")} onClose={() => { if (!submitting.current) { setManualDialogOpen(false); setManualQrPreviewOpen(false); } }}>
        <div className="space-y-3.5">
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

                      <div className="grid gap-2.5 md:grid-cols-2">
                        <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                          <h3 className="text-base font-extrabold text-slate-950">
                            {t("Transfer details", "ព័ត៌មានផ្ទេរប្រាក់")}
                          </h3>

                          <dl className="mt-3 divide-y divide-dashed divide-slate-200">
                            <div className="flex items-center justify-between gap-3 py-2.5">
                              <dt className="text-sm text-slate-500">{t("Payment amount", "ចំនួនទឹកប្រាក់ទូទាត់")}</dt>
                              <dd className="text-base font-extrabold text-slate-950">
                                {formatUsdFromCents(totalCents)}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3 py-2.5">
                              <dt className="text-sm text-slate-500">{t("Bank", "ធនាគារ")}</dt>
                              <dd className="min-w-0 max-w-[60%] break-words text-right text-sm font-bold text-slate-950">
                                {manualPaymentConfig?.bankName || "—"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3 py-2.5">
                              <dt className="text-sm text-slate-500">{t("Account name", "ឈ្មោះគណនី")}</dt>
                              <dd className="min-w-0 max-w-[60%] break-words text-right text-sm font-bold text-slate-950">
                                {manualPaymentConfig?.accountName || "—"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3 py-2.5">
                              <dt className="text-sm text-slate-500">{t("Account number", "លេខគណនី")}</dt>
                              <dd className="min-w-0 max-w-[60%] break-words text-right text-sm font-bold text-slate-950">
                                {manualPaymentConfig?.accountNumber || "—"}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3 py-2.5">
                              <dt className="text-sm text-slate-500">{t("Currency", "រូបិយប័ណ្ណ")}</dt>
                              <dd className="text-sm font-bold text-slate-950">USD</dd>
                            </div>
                          </dl>
                        </section>

                        <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                          <h3 className="text-base font-extrabold text-slate-950">
                            {t("Scan ABA KHQR", "ស្កេន ABA KHQR")}
                          </h3>

                          {manualPaymentConfig?.enabled && manualPaymentConfig.qrImageUrl ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setManualQrPreviewOpen(true)}
                                disabled={manualPaymentSubmitting}
                                aria-haspopup="dialog"
                                className="mx-auto mt-3 block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-blue-300 hover:shadow-md"
                                aria-label={t("View QR code", "មើលកូដ QR")}
                              >
                                <img
                                  src={manualPaymentConfig.qrImageUrl}
                                  alt={t("TENH manual payment QR", "QR ទូទាត់ TENH")}
                                  className="mx-auto h-32 w-32 max-w-full object-contain"
                                />
                                <span className="mt-2 block text-center text-xs font-semibold text-blue-700">{t("View QR code", "មើលកូដ QR")}</span>
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

                      <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
                        <h3 className="text-base font-extrabold text-slate-950">
                          {t("Upload payment receipt", "ផ្ទុកបង្កាន់ដៃទូទាត់")}
                        </h3>

                        <label className="relative mt-3 flex min-h-[96px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-blue-200 bg-blue-50/20 px-4 py-4 text-center transition hover:border-blue-400 hover:bg-blue-50/40">
                          <span className="text-blue-600">
                            <PaymentUploadIcon />
                          </span>
                          <span className="mt-2 max-w-full break-words text-sm font-semibold text-slate-700">
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
                            disabled={manualPaymentSubmitting}
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) =>
                              setManualProof(event.target.files?.[0] ?? null)
                            }
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            aria-label={t("Upload payment receipt", "ផ្ទុកបង្កាន់ដៃទូទាត់")}
                          />
                        </label>

                        <label className="mt-4 block text-sm font-semibold text-slate-900">
                          {t("Note", "ចំណាំ")}
                          <span className="ml-1 text-xs font-normal text-slate-500">{t("(optional)", "(មិនចាំបាច់)")}</span>

                          <textarea
                            rows={2}
                            disabled={manualPaymentSubmitting}
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
                          aria-busy={manualPaymentSubmitting}
                          disabled={
                            transactionReturnOnly ||
                            !manualPaymentConfig?.enabled ||
                            manualPaymentSubmitting ||
                            !manualProof
                          }
                          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
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
                        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {manualPaymentError}
                        </div>
                      ) : null}
                    </div>
      </CheckoutDialog>
      <ManualQrPreview open={manualDialogOpen && manualQrPreviewOpen && Boolean(manualPaymentConfig?.qrImageUrl)}
        src={manualPaymentConfig?.qrImageUrl ?? ""} onClose={() => setManualQrPreviewOpen(false)} />
    </div>
  );
}
