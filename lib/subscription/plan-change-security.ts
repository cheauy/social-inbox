import "server-only";

import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PaidPlanCode = "mini" | "standard" | "pro";
export type PlanChangeMode =
  | "active-paid"
  | "subscribe"
  | "suspended"
  | "unmanaged";

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
  } | null;
  mode: PlanChangeMode;
  canManage: boolean;
  isOwner: boolean;
  currentPlan: PaidPlanCode | null;
  currentRank: number;
  usage: {
    members: number;
    channels: number;
  };
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

const paidPlanRanks: Record<PaidPlanCode, number> = {
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

export async function loadPlanChangeState(
  businessId: string,
  access: string | { canManage: boolean; isOwner: boolean },
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

  /*
   * The business_subscriptions select string above is built with
   * array.join(","), so Supabase's generated TypeScript types can
   * infer GenericStringError even though maybeSingle() returns the
   * selected subscription row correctly at runtime.
   *
   * Normalize the result once here and keep the existing prepaid
   * plan-change behavior unchanged.
   */
  const subscriptionData =
    subscription as unknown as
      PlanChangeState["subscription"];

  const currentPlanValue =
    subscriptionData?.plan_code ?? null;

  const currentPlan: PaidPlanCode | null =
    currentPlanValue &&
    isPaidPlan(currentPlanValue)
      ? currentPlanValue
      : null;

  const currentRank =
    currentPlan
      ? paidPlanRanks[currentPlan]
      : 0;

  const currentPeriodEnd = subscriptionData?.current_period_end
    ? new Date(subscriptionData.current_period_end).getTime()
    : null;

  const periodStillActive =
    currentPeriodEnd === null ||
    (Number.isFinite(currentPeriodEnd) && currentPeriodEnd > Date.now());

  const mode: PlanChangeMode = !subscriptionData
    ? "unmanaged"
    : subscriptionData.status === "suspended"
      ? "suspended"
      : subscriptionData.status === "active" && currentRank > 0 && periodStillActive
        ? "active-paid"
        : "subscribe";

  const isOwner =
    typeof access === "string" ? access === "owner" : access.isOwner;
  const canManage =
    typeof access === "string" ? access === "owner" : access.canManage;

  return {
    subscription: subscriptionData ?? null,
    mode,
    canManage,
    isOwner,
    currentPlan,
    currentRank,
    usage: {
      members: members.count ?? 0,
      channels: channels.count ?? 0,
    },
  };
}

export function getPlanPurchaseEligibility(
  state: PlanChangeState,
  targetPlan: PaidPlanCode,
): PurchaseEligibility {
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
    if (!state.isOwner) {
      return {
        allowed: false,
        action: "blocked",
        reason: "owner-only",
        message:
          "Only the workspace Owner can reactivate or replace this workspace subscription. Team members can still buy a new subscription for their own workspace.",
      };
    }

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
        "A lower plan cannot replace an active paid plan immediately. Buy it as a new prepaid subscription for the next period instead.",
    };
  }

  if (!state.canManage) {
    return {
      allowed: false,
      action: "blocked",
      reason: "owner-only",
      message:
        "Subscription & billing Manage permission is required to upgrade this workspace subscription.",
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
