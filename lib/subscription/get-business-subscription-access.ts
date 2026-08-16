import "server-only";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ManagedSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "suspended";

export type BusinessSubscriptionAccess = {
  hasSubscription: boolean;
  locked: boolean;
  reason:
    | "past_due"
    | "expired"
    | "suspended"
    | null;
  status: ManagedSubscriptionStatus | null;
  planCode: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  subscription: Record<string, unknown> | null;
};

type BusinessInput =
  | string
  | {
      id?: string | null;
      business_id?: string | null;
      businessId?: string | null;
    }
  | null
  | undefined;

function businessIdFromInput(input: BusinessInput) {
  if (typeof input === "string") {
    return input.trim();
  }

  return (
    input?.business_id?.trim() ||
    input?.businessId?.trim() ||
    input?.id?.trim() ||
    ""
  );
}

export async function getBusinessSubscriptionAccess(
  input?: BusinessInput,
  ..._compatibilityArgs: unknown[]
): Promise<BusinessSubscriptionAccess> {
  void _compatibilityArgs;

  let businessId = businessIdFromInput(input);

  if (!businessId) {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      throw new Error(authResult.error);
    }

    businessId = authResult.member.business_id;
  }

  try {
    await syncBusinessSubscriptionLifecycle(businessId);

    const { data, error } = await supabaseAdmin
      .from("business_subscriptions")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load workspace subscription access: ${error.message}`,
      );
    }

    // Legacy / Meta-review workspaces intentionally have no managed
    // business_subscriptions row. They stay open and are never silently
    // converted into a paid/trial subscription here.
    if (!data) {
      return {
        hasSubscription: false,
        locked: false,
        reason: null,
        status: null,
        planCode: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        subscription: null,
      };
    }

    // V3.10.3 is prepaid-only. Any historical "cancelled" row from the
    // retired cancellation experiment is treated as a normal expiry.
    const rawStatus =
      typeof data.status === "string" ? data.status : "";
    const status: ManagedSubscriptionStatus =
      rawStatus === "cancelled"
        ? "expired"
        : (rawStatus as ManagedSubscriptionStatus);

    const locked =
      status === "expired" ||
      status === "past_due" ||
      status === "suspended";

    const reason = locked
      ? (status as "expired" | "past_due" | "suspended")
      : null;

    return {
      hasSubscription: true,
      locked,
      reason,
      status,
      planCode:
        typeof data.plan_code === "string" ? data.plan_code : null,
      trialEndsAt:
        typeof data.trial_ends_at === "string" ? data.trial_ends_at : null,
      currentPeriodEnd:
        typeof data.current_period_end === "string"
          ? data.current_period_end
          : null,
      subscription: data as Record<string, unknown>,
    };
  } catch (error) {
    console.error("[TENH] Subscription access helper failed", {
      businessId,
      message:
        error instanceof Error ? error.message : "Unknown subscription error",
    });

    throw error;
  }
}

export default getBusinessSubscriptionAccess;
