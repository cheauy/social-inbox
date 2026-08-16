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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTerminalFailure(status: string) {
  return ["DECLINED", "FAILED", "CANCELLED", "CANCELED"].includes(status);
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
    ...(billingTransaction.metadata ?? {}),
    payway_last_verification: {
      source,
      checked_at: new Date().toISOString(),
      request_time: check.reqTime,
      provider_status_code: providerStatusCode || null,
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
    const mappedStatus = isTerminalFailure(paymentStatus)
      ? paymentStatus === "CANCELLED" || paymentStatus === "CANCELED"
        ? "cancelled"
        : paymentStatus === "DECLINED"
          ? "declined"
          : "failed"
      : "pending";

    const { error: observeError } = await supabaseAdmin
      .from("billing_transactions")
      .update({
        status: mappedStatus,
        provider_status_code: providerStatusCode || null,
        provider_status: paymentStatus || provider.status?.message || null,
        provider_approval_code: approvalCode,
        provider_original_amount: originalAmount,
        provider_payment_amount: paymentAmount,
        provider_payment_currency: paymentCurrency,
        metadata,
      })
      .eq("id", billingTransaction.id)
      .neq("status", "approved");

    if (observeError) {
      throw new Error(observeError.message);
    }

    return {
      found: true as const,
      paymentState: mappedStatus as
        | "pending"
        | "declined"
        | "cancelled"
        | "failed",
      transactionId,
      businessId: billingTransaction.business_id,
      providerStatus: paymentStatus || provider.status?.message || null,
      providerStatusCode,
    };
  }

  if (originalAmount === null) {
    throw new Error(
      "PayWay approved the transaction but did not return original_amount for verification.",
    );
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
