import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "expired"
  | "suspended"
  | "cancelled";

type ManagedSubscription = {
  plan_code: string;
  status: SubscriptionStatus;
  member_limit: number;
  channel_limit: number;
};

export type BusinessEntitlements = {
  managed: boolean;
  locked: boolean;
  planCode: string | null;
  status: SubscriptionStatus | null;
  memberLimit: number | null;
  channelLimit: number | null;
  activeMembers: number;
  activeChannels: number;
};

export type EntitlementCheck = {
  allowed: boolean;
  code:
    | "OK"
    | "LEGACY_UNMANAGED"
    | "SUBSCRIPTION_LOCKED"
    | "MEMBER_LIMIT_REACHED"
    | "CHANNEL_LIMIT_REACHED"
    | "ENTITLEMENT_ERROR";
  message?: string;
  entitlements?: BusinessEntitlements;
};

const LOCKED_STATUSES = new Set<SubscriptionStatus>([
  "past_due",
  "expired",
  "suspended",
  "cancelled",
]);

export async function getBusinessEntitlements(
  businessId: string,
): Promise<
  | { success: true; data: BusinessEntitlements }
  | { success: false; error: string }
> {
  const [subscriptionResult, memberResult, channelResult] =
    await Promise.all([
      supabaseAdmin
        .from("business_subscriptions")
        .select(`
          plan_code,
          status,
          member_limit,
          channel_limit
        `)
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

  if (subscriptionResult.error) {
    console.error(
      "[Tenh Entitlements] Unable to load subscription:",
      subscriptionResult.error,
    );
    return {
      success: false,
      error: "Unable to check workspace subscription limits.",
    };
  }

  if (memberResult.error || channelResult.error) {
    console.error(
      "[Tenh Entitlements] Unable to count workspace usage:",
      memberResult.error ?? channelResult.error,
    );
    return {
      success: false,
      error: "Unable to check current workspace usage.",
    };
  }

  const subscription =
    subscriptionResult.data as ManagedSubscription | null;

  if (!subscription) {
    // Preserve legacy Demo/Meta-review workspace while App Review is pending.
    return {
      success: true,
      data: {
        managed: false,
        locked: false,
        planCode: null,
        status: null,
        memberLimit: null,
        channelLimit: null,
        activeMembers: memberResult.count ?? 0,
        activeChannels: channelResult.count ?? 0,
      },
    };
  }

  return {
    success: true,
    data: {
      managed: true,
      locked: LOCKED_STATUSES.has(subscription.status),
      planCode: subscription.plan_code,
      status: subscription.status,
      memberLimit: subscription.member_limit,
      channelLimit: subscription.channel_limit,
      activeMembers: memberResult.count ?? 0,
      activeChannels: channelResult.count ?? 0,
    },
  };
}

export async function canActivateAnotherChannel(
  businessId: string,
): Promise<EntitlementCheck> {
  const result = await getBusinessEntitlements(businessId);

  if (!result.success) {
    return {
      allowed: false,
      code: "ENTITLEMENT_ERROR",
      message: result.error,
    };
  }

  const entitlement = result.data;

  if (!entitlement.managed) {
    return {
      allowed: true,
      code: "LEGACY_UNMANAGED",
      entitlements: entitlement,
    };
  }

  if (entitlement.locked) {
    return {
      allowed: false,
      code: "SUBSCRIPTION_LOCKED",
      message:
        "Workspace subscription is not active. Open Subscription to continue using TENH Chat.",
      entitlements: entitlement,
    };
  }

  const limit = entitlement.channelLimit ?? 0;

  if (entitlement.activeChannels >= limit) {
    return {
      allowed: false,
      code: "CHANNEL_LIMIT_REACHED",
      message:
        limit === 1
          ? "Facebook Page limit reached. Your current plan includes 1 active connection. Upgrade your plan to connect another Page."
          : `Facebook Page limit reached. Your current plan includes ${limit} active connections. Upgrade your plan to connect another Page.`,
      entitlements: entitlement,
    };
  }

  return {
    allowed: true,
    code: "OK",
    entitlements: entitlement,
  };
}

export async function canActivateAnotherMember(
  businessId: string,
): Promise<EntitlementCheck> {
  const result = await getBusinessEntitlements(businessId);

  if (!result.success) {
    return {
      allowed: false,
      code: "ENTITLEMENT_ERROR",
      message: result.error,
    };
  }

  const entitlement = result.data;

  if (!entitlement.managed) {
    return {
      allowed: true,
      code: "LEGACY_UNMANAGED",
      entitlements: entitlement,
    };
  }

  if (entitlement.locked) {
    return {
      allowed: false,
      code: "SUBSCRIPTION_LOCKED",
      message:
        "Workspace subscription is not active. Open Subscription to continue using TENH Chat.",
      entitlements: entitlement,
    };
  }

  const limit = entitlement.memberLimit ?? 0;

  if (entitlement.activeMembers >= limit) {
    return {
      allowed: false,
      code: "MEMBER_LIMIT_REACHED",
      message: `Team member limit reached. Your current plan allows up to ${limit} active team members. Upgrade your plan to add another member.`,
      entitlements: entitlement,
    };
  }

  return {
    allowed: true,
    code: "OK",
    entitlements: entitlement,
  };
}
