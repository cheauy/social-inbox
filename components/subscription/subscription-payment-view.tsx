"use client";

import Script from "next/script";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import {
  TENH_BILLING_CYCLES,
  TENH_PLANS,
  calculatePlanTotalCents,
  calculateCustomTotalCents,
  formatUsdFromCents,
  type BillingCycle,
  type PlanCode,
} from "@/lib/subscription/plan-catalog";

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
  customConnections?: number | null;
  customUsers?: number | null;
  renewSame?: boolean;
  renewalTotalCents?: number | null;
  upgradeFromPlanCode?: PlanCode | null;
  upgradeTotalCents?: number | null;
  customUpgrade?: boolean;
  customUpgradeTotalCents?: number | null;
  customUpgradeCurrentPeriodEnd?: string | null;
  customUpgradeNewPeriodEnd?: string | null;
  purchaseBusinessId?: string | null;
};

function formatSubscriptionDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

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
) {
  switch (state) {
    case "approved":
      return "Payment approved";
    case "declined":
      return "Payment declined";
    case "cancelled":
      return "Payment cancelled";
    case "failed":
      return "Payment verification failed";
    case "pending":
    case "waiting":
      return "Waiting for payment confirmation";
    case "idle":
    default:
      return "Ready for checkout";
  }
}

export function SubscriptionPaymentView({
  planCode,
  billingCycle,
  initialPayWayReturn = null,
  initialTransactionId = null,
  customConnections = null,
  customUsers = null,
  renewSame = false,
  renewalTotalCents = null,
  upgradeFromPlanCode = null,
  upgradeTotalCents = null,
  customUpgrade = false,
  customUpgradeTotalCents = null,
  customUpgradeCurrentPeriodEnd = null,
  customUpgradeNewPeriodEnd = null,
  purchaseBusinessId = null,
}: SubscriptionPaymentViewProps) {
  const router = useRouter();

  async function returnToSubscription() {
    try {
      await fetch("/api/workspaces/restore-purchase-origin", {
        method: "POST",
        cache: "no-store",
      });
    } catch {
      // Navigation still works if there is no purchase-origin context.
    }

    router.push("/dashboard/subscription");
    router.refresh();
  }

  const plan = useMemo(
    () =>
      planCode === "custom" &&
      customConnections !== null &&
      customUsers !== null
        ? {
            id: "custom" as const,
            name: "Custom",
            description: "Custom TENH subscription",
            channels: customConnections,
            users: customUsers,
          }
        : TENH_PLANS.find((item) => item.id === planCode) ?? null,
    [planCode, customConnections, customUsers],
  );
  const cycle = useMemo(
    () =>
      TENH_BILLING_CYCLES.find(
        (item) => item.id === billingCycle,
      ) ?? null,
    [billingCycle],
  );
  const totalCents = useMemo(
    () =>
      customUpgradeTotalCents !== null &&
      Number.isFinite(customUpgradeTotalCents)
        ? customUpgradeTotalCents
        : upgradeTotalCents !== null &&
      Number.isFinite(upgradeTotalCents)
        ? upgradeTotalCents
        : renewSame &&
            renewalTotalCents !== null &&
            Number.isFinite(renewalTotalCents)
          ? renewalTotalCents
          : planCode === "custom" &&
            customConnections !== null &&
            customUsers !== null
          ? calculateCustomTotalCents(
              customConnections,
              customUsers,
              billingCycle,
            )
          : calculatePlanTotalCents(planCode, billingCycle),
    [
      planCode,
      billingCycle,
      customConnections,
      customUsers,
      renewSame,
      renewalTotalCents,
      upgradeTotalCents,
      customUpgradeTotalCents,
    ],
  );

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
      initialPayWayReturn === "approved"
        ? "approved"
        : initialTransactionId
          ? "waiting"
          : initialPayWayReturn === "cancelled"
            ? "cancelled"
            : "idle",
    );
  const [payWayStatusText, setPayWayStatusText] =
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
    if (initialPayWayReturn !== "cancelled") return;

    let cancelled = false;

    async function finalizeCancelledReturn() {
      try {
        await fetch("/api/workspaces/restore-purchase-origin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            transactionId: initialTransactionId ?? "",
          }),
        });
      } finally {
        if (!cancelled) {
          window.location.replace(
            "/dashboard/subscription?payway=cancelled",
          );
        }
      }
    }

    void finalizeCancelledReturn();

    return () => {
      cancelled = true;
    };
  }, [initialPayWayReturn, initialTransactionId]);

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
  }, [manualPaymentRequest?.status]);

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
        } = {};

        if (text.trim()) {
          result = JSON.parse(text) as typeof result;
        }

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to verify PayWay payment.",
          );
        }

        if (cancelled) return;

        const nextState = result.paymentState ?? "pending";
        setPayWayPaymentState(nextState);
        setPayWayStatusText(result.providerStatus ?? null);

        if (nextState === "approved") {
          /*
           * V3.11.31.31 — keep the official ABA PayWay success popup open.
           *
           * Do NOT force-navigate TENH here. PayWay owns its success modal and
           * the customer decides when to close it, click outside it, download
           * the PayWay receipt, or use PayWay's Continue Shopping action.
           * TENH has already verified + activated the payment server-side.
           */
          setCheckoutError(null);
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
        "PayWay secure checkout is still loading. Please try again in a moment.",
      );
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError(null);
    setPayWayStatusText(null);

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
            renewSame,
            customUpgrade,
            ...(planCode === "custom"
              ? { connections: customConnections, users: customUsers }
              : {}),
            paymentMethod: "abapay_khqr",
            ...(purchaseBusinessId ? { purchaseBusinessId } : {}),
          }),
        },
      );

      const text = await response.text();
      let result: {
        success?: boolean;
        error?: string;
        details?: string;
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
          [
            result.error ?? "Unable to start ABA PayWay checkout.",
            result.details ? `Database: ${result.details}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
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
        "Complete payment in the ABA PayWay secure checkout. TENH will verify the transaction automatically.",
      );

      payWayBridge.checkout();
    } catch (error) {
      setCheckoutError(
        error instanceof Error
          ? error.message
          : "Unable to start ABA PayWay checkout.",
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function submitManualPayment() {
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
            renewSame,
            customUpgrade,
            ...(planCode === "custom"
              ? { connections: customConnections, users: customUsers }
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
            renewSame,
            customUpgrade,
            ...(planCode === "custom"
              ? { connections: customConnections, users: customUsers }
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
        details?: string;
        request?: ManualPaymentRequest;
      };

      if (
        !finalizeResponse.ok ||
        !result.success ||
        !result.request
      ) {
        throw new Error(
          [
            result.error ??
              "Unable to submit manual payment proof.",
            result.details ? `Database: ${result.details}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      setManualPaymentRequest(result.request);
      setManualCustomerNote("");
      setManualProof(null);
    } catch (error) {
      setManualPaymentError(
        error instanceof Error
          ? error.message
          : "Unable to submit manual payment proof.",
      );
    } finally {
      setManualPaymentSubmitting(false);
    }
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
    <div className="min-h-full bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
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
                  "ABA PayWay checkout plugin is not ready."
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
            "Unable to load PayWay secure checkout. Refresh the page and try again.",
          );
        }}
      />

      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <button
              type="button"
              onClick={() => void returnToSubscription()}
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-blue-600"
            >
              <span aria-hidden="true">←</span>
              Back to plans
            </button>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
              Secure payment
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              {customUpgrade || upgradeTotalCents !== null ? "Complete your upgrade" : "Complete your subscription"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Choose how you want to pay. TENH verifies the selected plan and amount on the server before activation.
            </p>
          </div>
        </div>

        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <aside className="border-b border-blue-800 bg-gradient-to-b from-blue-700 via-blue-800 to-blue-950 p-6 text-white sm:p-8 lg:border-b-0 lg:border-r lg:border-blue-800">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
                Order summary
              </p>

              <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.10] p-5 shadow-sm backdrop-blur-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-2xl font-bold">
                      {plan.name}
                    </p>
                    <p className="mt-1 text-sm text-blue-100/75">
                      {cycle.label}
                    </p>
                  </div>
                  <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-200">
                    TENH Chat
                  </span>
                </div>

                <div className="mt-6 border-t border-white/10 pt-5">
                  <div className="flex items-end justify-between gap-4">
                    <p className="text-sm font-medium text-blue-100/75">
                      {customUpgrade || upgradeTotalCents !== null ? "Upgrade price" : "Total to pay"}
                    </p>
                    <p className="text-3xl font-black tracking-tight">
                      {formatUsdFromCents(totalCents)}
                    </p>
                  </div>
                  <p className="mt-2 text-right text-xs text-blue-100/65">
                    {upgradeTotalCents !== null
                      ? "USD · You pay only the difference for this prepaid period"
                      : "USD · Automatically calculated from your selected package"}
                  </p>
                </div>
              </div>

            

              {upgradeTotalCents !== null && upgradeFromPlanCode ? (
                <div className="mt-4 rounded-2xl border border-blue-300/20 bg-blue-400/10 p-4 text-sm text-blue-100">
                  Upgrade keeps this subscription ID and starts the selected higher-plan period after approved payment.
                </div>
              ) : null}

              <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-4">
                  <dt className="text-xs font-medium text-blue-100/65">
                    Social connections
                  </dt>
                  <dd className="mt-1 text-base font-bold">
                    {plan.channels}
                  </dd>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-4">
                  <dt className="text-xs font-medium text-blue-100/65">
                    Team members
                  </dt>
                  <dd className="mt-1 text-base font-bold">
                    {plan.users}
                  </dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={() => void returnToSubscription()}
                className="mt-5 inline-flex text-sm font-semibold text-blue-300 hover:text-blue-200"
              >
                Change package
              </button>

              {checkoutMethod === "manual" ? (
                <div className="mt-7 border-t border-white/15 pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
                        Scan to pay
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        ABA KHQR bank transfer
                      </p>
                      <p className="mt-1 text-xs leading-5 text-blue-100/75">
                        Scan the QR code, complete the transfer, then upload your receipt on the right.
                      </p>
                    </div>
                  </div>

                  {manualPaymentConfig?.enabled ? (
                    manualPaymentConfig.qrImageUrl ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setManualQrPreviewOpen(true)}
                          className="mt-4 block w-full cursor-zoom-in rounded-[24px] border border-white/20 bg-white p-3 text-left shadow-xl transition hover:-translate-y-0.5 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-white/25"
                          aria-label="View payment QR larger"
                        >
                          <img
                            src={manualPaymentConfig.qrImageUrl}
                            alt="TENH manual payment QR"
                            className="mx-auto h-auto w-full max-w-[390px] rounded-2xl object-contain"
                          />
                        </button>
                        <p className="mt-3 text-center text-xs leading-5 text-blue-100/80">
                          Click the QR code to view it larger.
                        </p>
                      </>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-white/30 bg-white/10 p-5 text-center text-sm text-blue-100">
                        Payment QR is not available right now.
                      </div>
                    )
                  ) : (
                    <div className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-300/10 p-4 text-sm text-amber-100">
                      Manual payment is not configured yet.
                    </div>
                  )}
                </div>
              ) : null}
            </aside>

            <div className="p-5 sm:p-7 lg:p-8">
              <p className="text-sm font-bold text-slate-950">
                Payment method
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Select ABA KHQR or submit a manual bank-transfer receipt.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutMethod("payway");
                    setManualPaymentError(null);
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    checkoutMethod === "payway"
                      ? "border-blue-500 bg-blue-50 ring-4 ring-blue-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <img
                      src="/images/aba-khqr.png"
                      alt="ABA KHQR"
                      className="h-11 w-11 shrink-2 rounded-xl object-contain"
                    />
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-950">
                        ABA KHQR
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Scan to pay with any banking app
                      </p>
                    </div>
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
                      ? "border-emerald-500 bg-emerald-50 ring-4 ring-emerald-100"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-6 w-6"
                        aria-hidden="true"
                      >
                        <path d="M4 7h12" strokeLinecap="round" />
                        <path d="m13 4 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M20 17H8" strokeLinecap="round" />
                        <path d="m11 14-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-bold text-slate-950">
                        Manual bank transfer
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        Transfer, upload receipt, and wait for review.
                      </p>
                    </div>
                  </div>
                </button>
              </div>

              {checkoutMethod === "payway" ? (
                <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
                        ABA PayWay
                      </p>
                      <p className="mt-1 text-lg font-bold text-slate-950">
                        Total {formatUsdFromCents(totalCents)} 
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
                      className="inline-flex min-w-[210px] items-center justify-center rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      {checkoutLoading
                        ? "Opening ABA PayWay..."
                        : !payWayPluginReady
                          ? "Loading PayWay..."
                          : "Checkout"}
                    </button>
                  </div>

                    {customUpgrade ? (
                <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  <p className="font-bold">Custom Upgrade</p>
                  <p className="mt-1">Your same Subscription ID stays active. Current expiry {formatSubscriptionDate(customUpgradeCurrentPeriodEnd)}{customUpgradeNewPeriodEnd && customUpgradeNewPeriodEnd !== customUpgradeCurrentPeriodEnd ? ` → ${formatSubscriptionDate(customUpgradeNewPeriodEnd)}` : ""}.</p>
                </div>
              ) : null}

                  {checkoutError ? (
                    <div className="mt-4 whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                        {payWayStateLabel(payWayPaymentState)}
                      </p>
                      <p className="mt-1 text-xs opacity-80">
                        {payWayTransactionId
                          ? `Transaction ${payWayTransactionId}`
                          : "No payment was applied."}
                        {payWayStatusText
                          ? ` · ${payWayStatusText}`
                          : ""}
                      </p>

                      {payWayPaymentState === "approved" ? (
                        <div className="mt-3 border-t border-emerald-200 pt-3">
                          <p className="text-xs leading-5 text-emerald-800">
                            Payment is complete. TENH will not redirect you automatically. The official ABA success window can stay open until you choose what to do next.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href="/dashboard/subscription"
                              className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
                            >
                              Back to subscription
                            </Link>
                            <Link
                              href="/dashboard/subscription/billing-history"
                              className="inline-flex items-center justify-center rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50"
                            >
                              View TENH receipt
                            </Link>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {checkoutMethod === "manual" ? (
                <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50/70 p-5 shadow-sm sm:p-6">
                  {hasSubmittedManual ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold">
                          ✓
                        </div>
                        <div className="min-w-0">
                          <p className="text-base font-bold">
                            Payment submitted
                          </p>
                          <p className="mt-1 leading-6 text-amber-700">
                            TENH billing is reviewing your transfer. Approval typically takes 1-2 business days. This page checks the status automatically.
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-amber-100 bg-white/80 p-3">
                        <p className="break-all font-mono text-xs">
                          Request {manualPaymentRequest.id}
                        </p>
                        <p className="mt-2 text-xs">
                          {manualPaymentRequest.planCode.toUpperCase()} · {manualPaymentRequest.billingCycle} · {new Intl.NumberFormat("en-US", { style: "currency", currency: manualPaymentRequest.currency }).format(manualPaymentRequest.amount)}
                        </p>
                        <p className="mt-1 text-xs">
                          Receipt: {manualPaymentRequest.proofFileName}
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
                              <p className="font-bold">
                                Previous payment was rejected
                              </p>
                              <p className="mt-1 text-xs leading-5">
                                {manualPaymentRequest.reviewNote ||
                                  "Check the transfer details and submit a new receipt."}
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
                              <p className="font-bold">
                                Last manual payment was approved
                              </p>
                              <p className="mt-1 text-xs leading-5 text-emerald-700">
                                You can submit a new payment here if you are purchasing another billing period.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      

                      <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.13em] text-blue-600">
                              Payment amount
                            </p>
                            <p className="mt-1 text-3xl font-black tracking-tight text-slate-950">
                              {formatUsdFromCents(totalCents)}
                            </p>
                          </div>
                          <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-slate-600">
                            Automatically generated.
                            <br />Customer cannot edit it.
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <label className="block text-sm font-semibold text-slate-900">
                          Payment receipt
                          <span className="ml-1 text-red-500">*</span>
                          <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                            Upload a clear JPG, PNG, WEBP, or PDF showing the completed transfer.
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(event) =>
                              setManualProof(
                                event.target.files?.[0] ?? null,
                              )
                            }
                            className="mt-3 block w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2 text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2.5 file:font-semibold file:text-white hover:file:bg-blue-500"
                          />
                        </label>

                        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-700">
                          Please ensure the transaction details match your order. Approval typically takes 1-2 business days.
                        </p>

                        <label className="mt-4 block text-sm font-semibold text-slate-900">
                          Note
                          <span className="ml-1 text-xs font-normal text-slate-500">
                            (optional)
                          </span>
                          <textarea
                            rows={4}
                            maxLength={1000}
                            value={manualCustomerNote}
                            onChange={(event) =>
                              setManualCustomerNote(event.target.value)
                            }
                            placeholder="Add any information TENH billing should know"
                            className="mt-2 w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          void submitManualPayment();
                        }}
                        disabled={
                          !manualPaymentConfig?.enabled ||
                          manualPaymentSubmitting ||
                          !manualProof
                        }
                        className="inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {manualPaymentSubmitting
                          ? "Submitting payment..."
                          : "Submit payment"}
                      </button>

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
          </div>
        </section>
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
              aria-label="Close QR preview"
            >
              ×
            </button>

            <img
              src={manualPaymentConfig.qrImageUrl}
              alt="Payment QR enlarged"
              className="mx-auto max-h-[78vh] w-auto max-w-full rounded-2xl object-contain"
            />
            <p className="mt-4 text-center text-sm font-medium text-slate-600">
              Scan this QR code with your banking app to complete the payment.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}