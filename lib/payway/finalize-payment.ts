import "server-only";

import { checkPayWayTransaction } from "@/lib/payway/check-transaction";
import { supabaseAdmin } from "@/lib/supabase/admin";

type VerificationSource = "callback" | "browser-status";

type BillingTransaction = {
  id: string;
  business_id: string;
  provider_transaction_id: string;
  plan_code: string;
  billing_cycle: string;
  amount: number | string;
  currency: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

function cleanStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeNumber(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usdAmountToCents(value: unknown): number | null {
  const amount = normalizeNumber(value);

  if (amount === null || amount < 0) {
    return null;
  }

  const cents = Math.round(amount * 100);

  return Math.abs(amount * 100 - cents) < 0.000001
    ? cents
    : null;
}

export async function verifyAndFinalizePayWayTransaction(
  transactionId: string,
  source: VerificationSource,
) {
  const { data: transaction, error: transactionError } =
    await supabaseAdmin
      .from("billing_transactions")
      .select(
        "id,business_id,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,metadata",
      )
      .eq("provider", "payway")
      .eq("provider_transaction_id", transactionId)
      .maybeSingle();

  if (transactionError) {
    throw new Error(transactionError.message);
  }

  if (!transaction) {
    return {
      found: false as const,
      paymentState: "not_found" as const,
      transactionId,
    };
  }

  const billingTransaction = transaction as BillingTransaction;

  const transactionMetadata =
    billingTransaction.metadata &&
    typeof billingTransaction.metadata === "object" &&
    !Array.isArray(billingTransaction.metadata)
      ? billingTransaction.metadata
      : {};

  /*
   * Account deletion can intentionally cancel a pending purchase before the
   * Auth user is removed. Never let a late PayWay callback resurrect a
   * workspace or purchase that TENH explicitly cancelled for account deletion.
   */
  if (
    billingTransaction.status === "cancelled" &&
    (
      transactionMetadata.account_user_deleted === true ||
      transactionMetadata.account_owner_deleted === true
    )
  ) {
    return {
      found: true as const,
      paymentState: "cancelled" as const,
      transactionId,
      businessId: billingTransaction.business_id,
      providerStatus: "ACCOUNT_DELETED",
      providerStatusCode: null,
    };
  }

  if (billingTransaction.status === "approved") {
    return {
      found: true as const,
      paymentState: "approved" as const,
      transactionId,
      businessId: billingTransaction.business_id,
      alreadyApproved: true,
    };
  }

  const check = await checkPayWayTransaction(transactionId);
  const provider = check.response;
  const providerData = provider.data ?? {};
  const providerStatusCode = String(provider.status?.code ?? "");
  const providerTransactionId =
    typeof provider.status?.tran_id === "string"
      ? provider.status.tran_id.trim()
      : "";
  const paymentStatus = cleanStatus(providerData.payment_status);
  const paymentStatusCode = normalizeNumber(providerData.payment_status_code);
  const originalAmount = normalizeNumber(providerData.original_amount);
  const paymentAmount = normalizeNumber(providerData.payment_amount);
  const paymentCurrency =
    typeof providerData.payment_currency === "string"
      ? providerData.payment_currency.trim().toUpperCase()
      : null;
  const approvalCode =
    typeof providerData.apv === "string" ? providerData.apv.trim() : null;

  const metadata = {
    ...transactionMetadata,
    payway_last_verification: {
      source,
      checked_at: new Date().toISOString(),
      request_time: check.reqTime,
      provider_status_code: providerStatusCode || null,
      provider_transaction_id: providerTransactionId || null,
      provider_message: provider.status?.message ?? null,
      payment_status: paymentStatus || null,
      payment_status_code: paymentStatusCode,
      original_amount: originalAmount,
      payment_amount: paymentAmount,
      payment_currency: paymentCurrency,
      transaction_date: providerData.transaction_date ?? null,
    },
  };

  const isApproved =
    providerStatusCode === "00" &&
    paymentStatusCode === 0 &&
    paymentStatus === "APPROVED";

  if (!isApproved) {
    const conflictReason = providerStatusCode !== "00"
      ? "PROVIDER_INQUIRY_NOT_VERIFIED"
      : providerTransactionId !== transactionId
        ? "PROVIDER_INQUIRY_TRANSACTION_ID_MISMATCH"
        : paymentStatus === "APPROVED"
          ? "PROVIDER_APPROVAL_STATUS_INCOMPLETE"
          : !["PENDING", "PROCESSING", "DECLINED", "FAILED", "CANCELLED", "CANCELED"].includes(paymentStatus)
            ? "PROVIDER_PAYMENT_STATUS_UNKNOWN"
            : null;
    const { data: observation, error: observeError } = await supabaseAdmin.rpc(
      "tenh_observe_payway_verification",
      {
        p_provider_transaction_id: transactionId,
        p_observation: { ...metadata.payway_last_verification,
          ...(conflictReason ? { conflict_reason: conflictReason } : {}) },
        p_callback_received: source === "callback",
      },
    );

    if (observeError) {
      throw new Error(observeError.message);
    }

    const mappedStatus = observation?.payment_state;
    if (!["pending", "approved", "declined", "cancelled", "failed", "recovery_required"].includes(mappedStatus)) {
      throw new Error("PayWay observation did not return a saved payment state.");
    }

    return {
      found: true as const,
      paymentState: mappedStatus as
        | "pending"
        | "approved"
        | "recovery_required"
        | "declined"
        | "cancelled"
        | "failed",
      transactionId,
      businessId: billingTransaction.business_id,
      providerStatus: paymentStatus || provider.status?.message || null,
      providerStatusCode,
    };
  }

  const expectedAmountCents = usdAmountToCents(billingTransaction.amount);
  const approvedAmountCents = usdAmountToCents(originalAmount);
  let conflictReason: string | null = null;
  if (originalAmount === null) {
    conflictReason = "PROVIDER_APPROVED_AMOUNT_MISSING";
  } else if (providerTransactionId !== transactionId) {
    conflictReason = "PROVIDER_APPROVED_TRANSACTION_ID_MISMATCH";
  } else if (
    expectedAmountCents === null ||
    approvedAmountCents === null ||
    approvedAmountCents !== expectedAmountCents
  ) {
    conflictReason = "PROVIDER_APPROVED_AMOUNT_MISMATCH";
  }

  /*
   * Check Transaction exposes payment_currency, which can describe the
   * customer's settlement currency rather than the original signed Purchase
   * currency. Do not reject a valid cross-currency KHQR payment by comparing
   * those two fields. TENH currently creates USD-only PayWay purchases, so
   * fail closed if the trusted local billing row is anything else.
   */
  if (billingTransaction.currency.trim().toUpperCase() !== "USD") {
    conflictReason = "SIGNED_BILLING_CURRENCY_MISMATCH";
  }

  if (conflictReason) {
    const { data: recovery, error: recoveryError } = await supabaseAdmin.rpc(
      "tenh_observe_payway_verification", {
        p_provider_transaction_id: transactionId,
        p_observation: { ...metadata.payway_last_verification,
          approval_code: approvalCode, conflict_reason: conflictReason },
        p_callback_received: source === "callback",
      });
    if (recoveryError) throw new Error("Unable to preserve conflicting PayWay approval evidence.");
    if (recovery?.payment_state !== "recovery_required") throw new Error("PayWay conflict was not recorded for billing recovery.");
    return { found: true as const, paymentState: "recovery_required" as const,
      transactionId, businessId: billingTransaction.business_id,
      providerStatus: "Conflicting payment evidence requires billing review. Your subscription has not been changed.",
      providerStatusCode };
  }

  const { data: activation, error: activationError } =
    await supabaseAdmin.rpc("tenh_activate_verified_payway_payment", {
      p_provider_transaction_id: transactionId,
      p_original_amount: originalAmount,
      p_payment_amount: paymentAmount,
      p_payment_currency: paymentCurrency,
      p_payment_status: paymentStatus,
      p_payment_status_code: paymentStatusCode,
      p_approval_code: approvalCode,
      p_provider_payload: provider,
      p_callback_received: source === "callback",
    });

  if (activationError) {
    throw new Error(activationError.message);
  }

  const activationRow = Array.isArray(activation)
    ? activation[0] ?? null
    : activation;

  if (activationRow?.subscription_status === "recovery_required") {
    return {
      found: true as const,
      paymentState: "recovery_required" as const,
      transactionId,
      businessId: billingTransaction.business_id,
      providerStatus: "Payment requires billing review. Your subscription has not been changed.",
      providerStatusCode,
    };
  }

  if (
    !activationRow ||
    activationRow.plan_code !== billingTransaction.plan_code ||
    activationRow.subscription_status !== "active"
  ) {
    throw new Error(
      "PayWay activation did not return the expected active TENH subscription.",
    );
  }

  return {
    found: true as const,
    paymentState: "approved" as const,
    transactionId,
    businessId: billingTransaction.business_id,
    alreadyApproved: Boolean(activationRow?.already_approved),
    subscription: activationRow
      ? {
          planCode: activationRow.plan_code,
          status: activationRow.subscription_status,
          currentPeriodEnd: activationRow.current_period_end,
          memberLimit: activationRow.member_limit,
          channelLimit: activationRow.channel_limit,
        }
      : null,
  };
}
