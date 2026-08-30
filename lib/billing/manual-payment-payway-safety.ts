import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

const RECENT_PENDING_MS = 15 * 60 * 1000;
const RECENT_APPROVED_MS = 48 * 60 * 60 * 1000;

type ManualPaymentTarget = {
  businessId: string;
  planCode: string;
  billingCycle: string;
  amount: number;
  targetMemberLimit: number | null;
  targetChannelLimit: number | null;
  manualCreatedAt?: string | null;
};

type PayWayConflictKind =
  | "none"
  | "pending"
  | "approved";

export type ManualPaymentPayWaySafety = {
  blocked: boolean;
  kind: PayWayConflictKind;
  message: string | null;
  transaction: {
    id: string;
    transactionId: string;
    status: string;
    planCode: string;
    billingCycle: string;
    amount: number;
    currency: string;
    createdAt: string;
    verifiedAt: string | null;
  } | null;
};

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameAmount(left: unknown, right: number) {
  const number = asNumber(left);
  return number !== null && Math.abs(number - right) < 0.005;
}

function sameOptionalLimit(
  rowValue: unknown,
  targetValue: number | null,
) {
  if (targetValue === null) return true;
  const rowNumber = asNumber(rowValue);
  return rowNumber === null || rowNumber === targetValue;
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

/**
 * Cross-provider safety guard for manual bank-transfer payments.
 *
 * This does not trust a screenshot/receipt as proof that money was sent by a
 * different payment method. It checks TENH's own PayWay transaction records.
 * A matching approved ABA/PayWay payment from the recent purchase window blocks
 * a second manual payment. A matching PayWay checkout that is still recent and
 * pending also blocks manual submission temporarily while PayWay verification
 * is still expected to complete.
 *
 * Old historical PayWay purchases do not permanently block later legitimate
 * renewals: approved matching is limited to a recent window unless another
 * server-side subscription-state check blocks the duplicate separately.
 */
export async function getManualPaymentPayWaySafety(
  target: ManualPaymentTarget,
): Promise<ManualPaymentPayWaySafety> {
  const { data, error } = await supabaseAdmin
    .from("billing_transactions")
    .select(
      [
        "id",
        "provider_transaction_id",
        "plan_code",
        "billing_cycle",
        "amount",
        "currency",
        "status",
        "target_member_limit",
        "target_channel_limit",
        "verified_at",
        "created_at",
      ].join(","),
    )
    .eq("business_id", target.businessId)
    .eq("provider", "payway")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(
      `Unable to verify recent ABA PayWay payments. ${error.message}`,
    );
  }

  const now = Date.now();
  const manualCreatedAt = timestamp(target.manualCreatedAt);

  const matching = (data ?? []).filter((row) => {
    if (row.plan_code !== target.planCode) return false;
    if (row.billing_cycle !== target.billingCycle) return false;
    if (!sameAmount(row.amount, target.amount)) return false;
    if (
      !sameOptionalLimit(
        row.target_member_limit,
        target.targetMemberLimit,
      )
    ) {
      return false;
    }
    if (
      !sameOptionalLimit(
        row.target_channel_limit,
        target.targetChannelLimit,
      )
    ) {
      return false;
    }
    return true;
  });

  const approved = matching.find((row) => {
    if (row.status !== "approved") return false;

    const paidAt =
      timestamp(row.verified_at) ?? timestamp(row.created_at);
    if (paidAt === null) return false;

    // If this manual request already existed, protect against an ABA payment
    // that completed shortly before OR after the manual proof was submitted.
    const referenceTime = manualCreatedAt ?? now;
    return Math.abs(referenceTime - paidAt) <= RECENT_APPROVED_MS;
  });

  if (approved) {
    return {
      blocked: true,
      kind: "approved",
      message:
        "TENH already has a matching verified ABA PayWay payment for this purchase. Do not create or approve a second manual payment.",
      transaction: {
        id: approved.id,
        transactionId: approved.provider_transaction_id,
        status: approved.status,
        planCode: approved.plan_code,
        billingCycle: approved.billing_cycle,
        amount: Number(approved.amount),
        currency: approved.currency,
        createdAt: approved.created_at,
        verifiedAt: approved.verified_at,
      },
    };
  }

  const pending = matching.find((row) => {
    if (row.status !== "pending") return false;
    const createdAt = timestamp(row.created_at);
    return createdAt !== null && now - createdAt <= RECENT_PENDING_MS;
  });

  if (pending) {
    return {
      blocked: true,
      kind: "pending",
      message:
        "A matching ABA PayWay checkout was started recently and may still be verifying. Wait for it to finish or cancel it before using manual payment.",
      transaction: {
        id: pending.id,
        transactionId: pending.provider_transaction_id,
        status: pending.status,
        planCode: pending.plan_code,
        billingCycle: pending.billing_cycle,
        amount: Number(pending.amount),
        currency: pending.currency,
        createdAt: pending.created_at,
        verifiedAt: pending.verified_at,
      },
    };
  }

  return {
    blocked: false,
    kind: "none",
    message: null,
    transaction: null,
  };
}
