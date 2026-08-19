import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getTrustedSubscriptionQuote,
  type BillingCycle,
} from "@/lib/subscription/plan-catalog";

export const TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE = "tenh_purchase_origin_business_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  planCode?: unknown;
  connections?: unknown;
  users?: unknown;
  billingCycle?: unknown;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  const planCode = typeof body.planCode === "string" ? body.planCode.trim().toLowerCase() : "custom";
  const billingCycle = typeof body.billingCycle === "string" ? body.billingCycle.trim() : "";
  const quote = getTrustedSubscriptionQuote({
    planCode,
    billingCycle,
    connections: body.connections,
    users: body.users,
  });


  if (!quote) {
    return NextResponse.json({ success: false, error: "Choose a valid TENH plan, capacity, and billing duration." }, { status: 400 });
  }

  // V3.11.31.2: TENH names the subscription automatically.
  // The customer no longer needs to enter a separate business/subscription name.
  const businessName = `${quote.planName} Subscription`.slice(0, 120);

  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName =
    [metadata?.full_name, metadata?.name, metadata?.display_name]
      .find((value) => typeof value === "string" && value.trim()) as string | undefined;

  const { data, error } = await supabaseAdmin.rpc(
    "tenh_create_subscription_workspace",
    {
      p_user_id: user.id,
      p_full_name: fullName?.trim() || user.email?.split("@")[0] || "TENH Owner",
      p_email: user.email ?? "",
      p_business_name: businessName,
      p_plan_code: quote.planCode,
      p_channel_limit: quote.channels,
      p_member_limit: quote.users,
      p_billing_cycle: quote.cycle.id as BillingCycle,
      p_monthly_price_cents: quote.monthlyCents,
      p_total_price_cents: quote.totalCents,
      p_pricing_version: quote.pricingVersion,
    },
  );

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to create the new subscription.", details: error.message },
      { status: 500 },
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const businessId = row?.business_id as string | undefined;

  if (!businessId) {
    return NextResponse.json({ success: false, error: "TENH created no subscription workspace." }, { status: 500 });
  }

  const cookieStore = await cookies();

  // Preserve the workspace the Owner was actively using before TENH switches
  // into the newly-created unpaid purchase workspace. This lets Back/Cancel
  // return safely to an existing active/trialing subscription instead of
  // leaving the browser parked on an unpaid/expired placeholder.
  const previousBusinessId =
    cookieStore.get(TENH_ACTIVE_BUSINESS_COOKIE)?.value?.trim() ?? "";

  if (previousBusinessId && previousBusinessId !== businessId) {
    const { data: previousMember } = await supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("business_id", previousBusinessId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const { data: previousSubscription } = previousMember
      ? await supabaseAdmin
          .from("business_subscriptions")
          .select("status")
          .eq("business_id", previousBusinessId)
          .maybeSingle()
      : { data: null };

    if (
      previousMember &&
      (previousSubscription?.status === "active" ||
        previousSubscription?.status === "trialing")
    ) {
      cookieStore.set(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE, previousBusinessId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60,
      });
    } else {
      cookieStore.delete(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE);
    }
  }

  return NextResponse.json({
    success: true,
    businessId,
    memberId: row.member_id,
    subscriptionId: row.subscription_id,
    quote,
    paymentUrl:
      quote.planCode === "custom"
        ? `/dashboard/subscription/payment?plan=custom&cycle=${encodeURIComponent(quote.cycle.id)}` +
          `&connections=${quote.channels}&users=${quote.users}` +
          `&purchase_business=${encodeURIComponent(businessId)}`
        : `/dashboard/subscription/payment?plan=${encodeURIComponent(quote.planCode)}&cycle=${encodeURIComponent(quote.cycle.id)}` +
          `&purchase_business=${encodeURIComponent(businessId)}`,
  });
}
