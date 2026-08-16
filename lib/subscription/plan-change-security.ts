import "server-only";

import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PaidPlanCode = "mini" | "standard" | "pro";
export type BillingCycle = "monthly" | "3-months" | "6-months" | "12-months";
export type PlanChangeMode =
  | "active-paid"
  | "subscribe"
  | "suspended"
  | "unmanaged";

export type PendingPlanChange = {
  type: "downgrade";
  planCode: PaidPlanCode;
  billingCycle: BillingCycle | null;
  requestedAt: string | null;
  effectiveAt: string | null;
};

export type PlanChangeState = {
  subscription: {
    id: string;
    business_id: string;
    plan_code: string;
    status: string;
    current_period_end: string | null;
    member_limit: number;
    channel_limit: number;
    payment_provider: string | null;
    pending_plan_code: string | null;
    pending_billing_cycle: string | null;
    pending_plan_change_type: string | null;
    pending_plan_requested_at: string | null;
    pending_plan_effective_at: string | null;
  } | null;
  mode: PlanChangeMode;
  canManage: boolean;
  currentPlan: PaidPlanCode | null;
  currentRank: number;
  usage: {
    members: number;
    channels: number;
  };
  pendingChange: PendingPlanChange | null;
};

export type PurchaseEligibility = {
  allowed: boolean;
  action: "upgrade" | "subscribe" | "blocked";
  reason:
    | "allowed-upgrade"
    | "allowed-subscribe"
    | "owner-only"
    | "unmanaged"
    | "suspended"
    | "current-plan-active"
    | "schedule-downgrade"
    | "capacity";
  message: string;
};

export const paidPlanRanks: Record<PaidPlanCode, number> = {
  mini: 1,
  standard: 2,
  pro: 3,
};

const paidPlanLimits: Record<
  PaidPlanCode,
  { members: number; channels: number }
> = {
  mini: { members: 3, channels: 1 },
  standard: { members: 5, channels: 3 },
  pro: { members: 10, channels: 6 },
};

export function isPaidPlan(value: string): value is PaidPlanCode {
  return value === "mini" || value === "standard" || value === "pro";
}

export function isBillingCycle(value: string): value is BillingCycle {
  return (
    value === "monthly" ||
    value === "3-months" ||
    value === "6-months" ||
    value === "12-months"
  );
}

export async function loadPlanChangeState(
  businessId: string,
  memberRole: string,
): Promise<PlanChangeState> {
  await syncBusinessSubscriptionLifecycle(businessId);

  const [{ data: subscription, error: subscriptionError }, members, channels] =
    await Promise.all([
      supabaseAdmin
        .from("business_subscriptions")
        .select(
          [
            "id",
            "business_id",
            "plan_code",
            "status",
            "current_period_end",
            "member_limit",
            "channel_limit",
            "payment_provider",
            "pending_plan_code",
            "pending_billing_cycle",
            "pending_plan_change_type",
            "pending_plan_requested_at",
            "pending_plan_effective_at",
          ].join(","),
        )
        .eq("business_id", businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("team_members")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_active", true),
      supabaseAdmin
        .from("social_accounts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("is_active", true),
    ]);

  if (subscriptionError) {
    throw new Error(subscriptionError.message);
  }
  if (members.error) {
    throw new Error(members.error.message);
  }
  if (channels.error) {
    throw new Error(channels.error.message);
  }

  const currentPlan = subscription?.plan_code ?? null;
  const currentRank =
    currentPlan && isPaidPlan(currentPlan) ? paidPlanRanks[currentPlan] : 0;

  const currentPeriodEnd = subscription?.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : null;

  const periodStillActive =
    currentPeriodEnd === null ||
    (Number.isFinite(currentPeriodEnd) && currentPeriodEnd > Date.now());

  const mode: PlanChangeMode = !subscription
    ? "unmanaged"
    : subscription.status === "suspended"
      ? "suspended"
      : subscription.status === "active" && currentRank > 0 && periodStillActive
        ? "active-paid"
        : "subscribe";

  const pendingPlan = subscription?.pending_plan_code ?? null;
  const pendingCycle = subscription?.pending_billing_cycle ?? null;

  return {
    subscription: subscription ?? null,
    mode,
    canManage: memberRole === "owner",
    currentPlan: isPaidPlan(currentPlan ?? "") ? currentPlan : null,
    currentRank,
    usage: {
      members: members.count ?? 0,
      channels: channels.count ?? 0,
    },
    pendingChange:
      isPaidPlan(pendingPlan ?? "") &&
      subscription?.pending_plan_change_type === "downgrade"
        ? {
            type: "downgrade",
            planCode: pendingPlan as PaidPlanCode,
            billingCycle: isBillingCycle(pendingCycle ?? "")
              ? (pendingCycle as BillingCycle)
              : null,
            requestedAt: subscription.pending_plan_requested_at,
            effectiveAt: subscription.pending_plan_effective_at,
          }
        : null,
  };
}

export function getPlanPurchaseEligibility(
  state: PlanChangeState,
  targetPlan: PaidPlanCode,
): PurchaseEligibility {
  if (!state.canManage) {
    return {
      allowed: false,
      action: "blocked",
      reason: "owner-only",
      message: "Only the workspace owner can purchase or change the subscription plan.",
    };
  }

  if (state.mode === "unmanaged") {
    return {
      allowed: false,
      action: "blocked",
      reason: "unmanaged",
      message:
        "This legacy workspace does not have a managed TENH subscription. Self-service billing is disabled for it.",
    };
  }

  if (state.mode === "suspended") {
    return {
      allowed: false,
      action: "blocked",
      reason: "suspended",
      message: "This workspace is suspended. Contact TENH support before starting a payment.",
    };
  }

  const limits = paidPlanLimits[targetPlan];
  if (
    state.usage.members > limits.members ||
    state.usage.channels > limits.channels
  ) {
    return {
      allowed: false,
      action: "blocked",
      reason: "capacity",
      message: `The ${targetPlan} plan cannot fit the workspace's current active members/channels. Reduce usage before choosing this plan.`,
    };
  }

  if (state.mode === "subscribe" || !state.currentPlan) {
    return {
      allowed: true,
      action: "subscribe",
      reason: "allowed-subscribe",
      message: "Payment is required before this paid plan becomes active.",
    };
  }

  const currentRank = paidPlanRanks[state.currentPlan];
  const targetRank = paidPlanRanks[targetPlan];

  if (targetRank === currentRank) {
    return {
      allowed: false,
      action: "blocked",
      reason: "current-plan-active",
      message:
        "This plan is already active for the current paid period. Renew after the current period expires; do not create a duplicate payment.",
    };
  }

  if (targetRank < currentRank) {
    return {
      allowed: false,
      action: "blocked",
      reason: "schedule-downgrade",
      message:
        "A lower plan cannot replace an active paid plan immediately. Schedule the downgrade from Subscription instead.",
    };
  }

  return {
    allowed: true,
    action: "upgrade",
    reason: "allowed-upgrade",
    message:
      "This is an upgrade. The new plan becomes active only after the payment is approved and verified.",
  };
}
