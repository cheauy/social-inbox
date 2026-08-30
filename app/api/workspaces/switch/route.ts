import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionStateRow = {
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

const OPERATIONAL_STATUSES = new Set(["active", "trialing"]);

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperationalSubscription(subscription: SubscriptionStateRow | null) {
  if (!subscription) {
    // Preserve legacy/unmanaged workspaces until they are migrated.
    return true;
  }

  if (!OPERATIONAL_STATUSES.has(subscription.status)) {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  let body: { businessId?: unknown };
  try {
    body = (await request.json()) as { businessId?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  const businessId =
    typeof body.businessId === "string" ? body.businessId.trim() : "";

  if (!businessId) {
    return NextResponse.json(
      { success: false, error: "Workspace is required." },
      { status: 400 },
    );
  }

  const { data: member, error } = await supabaseAdmin
    .from("team_members")
    .select("id,business_id")
    .eq("user_id", user.id)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify workspace access.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!member) {
    return NextResponse.json(
      {
        success: false,
        error: "You are not an active member of this subscription.",
      },
      { status: 403 },
    );
  }

  /*
   * Never trust the client-side workspace list as the authorization check.
   * Re-verify the destination subscription immediately before changing the
   * active-workspace cookie. This prevents a stale UI or direct request from
   * switching into an expired, suspended, past-due, or cancelled workspace.
   */
  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from("business_subscriptions")
    .select("status,current_period_end,trial_ends_at,created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify subscription status.",
        details: subscriptionError.message,
      },
      { status: 500 },
    );
  }

  if (
    !isOperationalSubscription(
      (subscription as SubscriptionStateRow | null) ?? null,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This subscription is expired or inactive. Please switch to an active workspace or buy a new subscription.",
      },
      { status: 409 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ success: true, businessId });
}
