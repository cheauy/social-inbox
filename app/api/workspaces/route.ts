import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasPermission, resolvePermissions } from "@/lib/auth/permissions";
import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  business_id: string;
  role: string;
  is_active: boolean;
  permissions: unknown;
};

type OwnerRow = {
  business_id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
};

type UsageRow = {
  business_id: string;
};

type BusinessRow = {
  id: string;
  name: string | null;
  slug: string | null;
};

type SubscriptionRow = {
  id: string;
  business_id: string;
  plan_code: string;
  status: string;
  member_limit: number;
  channel_limit: number;
  current_period_end: string | null;
  trial_ends_at: string | null;
  billing_cycle: string | null;
  last_paid_amount: number | string | null;
  last_paid_currency: string | null;
  pricing_snapshot: Record<string, unknown> | null;
  created_at: string | null;
};

const OPERATIONAL_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperationalSubscription(subscription: SubscriptionRow | null) {
  if (!subscription) {
    // Preserve legacy/unmanaged workspaces until they are migrated.
    return true;
  }

  if (!OPERATIONAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const userId = authResult.user.id;
  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("team_members")
    .select("id,business_id,role,is_active,permissions")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (membershipError) {
    return NextResponse.json(
      { success: false, error: "Unable to load your TENH subscriptions.", details: membershipError.message },
      { status: 500 },
    );
  }

  const membershipRows = (memberships ?? []) as unknown as MembershipRow[];
  const businessIds = [...new Set(membershipRows.map((row) => row.business_id))];

  if (businessIds.length === 0) {
    return NextResponse.json({ success: true, currentBusinessId: null, workspaces: [] });
  }

  // Keep the subscription list current before deciding whether a workspace is
  // active or eligible for reactivation. A lifecycle sync failure must not
  // hide every workspace, so fall back to the stored row and let the client
  // still treat an ended paid period as expired.
  const lifecycleResults = await Promise.allSettled(
    businessIds.map((businessId) => syncBusinessSubscriptionLifecycle(businessId)),
  );
  lifecycleResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `[TENH] Unable to synchronize subscription lifecycle for ${businessIds[index]}:`,
        result.reason,
      );
    }
  });

  const [
    businessResult,
    subscriptionResult,
    ownerResult,
    activeMembersResult,
    activeChannelsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,name,slug")
      .in("id", businessIds),
    supabaseAdmin
      .from("business_subscriptions")
      .select("id,business_id,plan_code,status,member_limit,channel_limit,current_period_end,trial_ends_at,billing_cycle,last_paid_amount,last_paid_currency,pricing_snapshot,created_at")
      .in("business_id", businessIds)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("team_members")
      .select("business_id,full_name,email,is_active")
      .in("business_id", businessIds)
      .eq("role", "owner"),
    supabaseAdmin
      .from("team_members")
      .select("business_id")
      .in("business_id", businessIds)
      .eq("is_active", true),
    supabaseAdmin
      .from("social_accounts")
      .select("business_id")
      .in("business_id", businessIds)
      .eq("is_active", true),
  ]);

  if (
    businessResult.error ||
    subscriptionResult.error ||
    ownerResult.error ||
    activeMembersResult.error ||
    activeChannelsResult.error
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load TENH subscription details.",
        details:
          businessResult.error?.message ??
          subscriptionResult.error?.message ??
          ownerResult.error?.message ??
          activeMembersResult.error?.message ??
          activeChannelsResult.error?.message,
      },
      { status: 500 },
    );
  }

  const businessRows = (businessResult.data ?? []) as unknown as BusinessRow[];
  const subscriptionRows = (subscriptionResult.data ?? []) as unknown as SubscriptionRow[];
  const businesses = new Map<string, BusinessRow>(
    businessRows.map((row) => [row.id, row]),
  );
  const subscriptions = new Map<string, SubscriptionRow>();
  for (const row of subscriptionRows) {
    // Query is newest-first, so keep only the latest subscription per workspace.
    if (!subscriptions.has(row.business_id)) {
      subscriptions.set(row.business_id, row);
    }
  }

  const ownerRows = (ownerResult.data ?? []) as unknown as OwnerRow[];
  const owners = new Map<string, OwnerRow>();
  for (const owner of ownerRows) {
    const existing = owners.get(owner.business_id);
    if (!existing || (!existing.is_active && owner.is_active)) {
      owners.set(owner.business_id, owner);
    }
  }

  const activeMemberCounts = new Map<string, number>();
  for (const row of (activeMembersResult.data ?? []) as unknown as UsageRow[]) {
    activeMemberCounts.set(
      row.business_id,
      (activeMemberCounts.get(row.business_id) ?? 0) + 1,
    );
  }

  const activeChannelCounts = new Map<string, number>();
  for (const row of (activeChannelsResult.data ?? []) as unknown as UsageRow[]) {
    activeChannelCounts.set(
      row.business_id,
      (activeChannelCounts.get(row.business_id) ?? 0) + 1,
    );
  }

  const workspaces = membershipRows.map((membership) => {
    const business = businesses.get(membership.business_id);
    const subscription = subscriptions.get(membership.business_id) ?? null;

    const owner = owners.get(membership.business_id);
    const ownerName =
      owner?.full_name?.trim() ||
      owner?.email?.trim() ||
      business?.name ||
      "Subscription Owner";

    return {
      memberId: membership.id,
      businessId: membership.business_id,
      businessName: business?.name ?? "TENH Workspace",
      ownerName,
      slug: business?.slug ?? null,
      role: membership.role,
      canManageBilling: hasPermission(
        resolvePermissions(membership.role, membership.permissions),
        "billing",
        "manage",
      ),
      usage: {
        members: activeMemberCounts.get(membership.business_id) ?? 0,
        channels: activeChannelCounts.get(membership.business_id) ?? 0,
      },
      subscription,
      subscriptionOperational: isOperationalSubscription(subscription),
    };
  });

  return NextResponse.json({
    success: true,
    currentBusinessId: authResult.member.business_id,
    workspaces,
  });
}

export async function PATCH(request: Request) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  if (authResult.member.role !== "owner" && authResult.member.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "Only an Owner can rename this workspace." },
      { status: 403 },
    );
  }

  let body: { businessName?: unknown };
  try {
    body = (await request.json()) as { businessName?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";

  if (!businessName) {
    return NextResponse.json(
      { success: false, error: "Workspace name is required." },
      { status: 400 },
    );
  }

  if (businessName.length > 120) {
    return NextResponse.json(
      { success: false, error: "Workspace name must be 120 characters or fewer." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("businesses")
    .update({ name: businessName })
    .eq("id", authResult.member.business_id)
    .select("id,name")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to save workspace name.", details: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "Workspace was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    businessId: data.id,
    businessName: data.name,
  });
}
