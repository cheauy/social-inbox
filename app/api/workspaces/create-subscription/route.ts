import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureWorkspaceDefaultContent } from "@/lib/settings/ensure-workspace-default-content";
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

type RpcErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function isMissingRpcSignature(error: RpcErrorLike | null | undefined) {
  if (!error) return false;

  const text = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ");

  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function/i.test(text) ||
    /function .* does not exist/i.test(text) ||
    /no function matches/i.test(text) ||
    /schema cache/i.test(text)
  );
}

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

  // "Buy new subscription" must always create a separate workspace owned by
  // the buyer. Record the caller's existing memberships first so an Agent in
  // somebody else's workspace can never accidentally pay against that joined
  // workspace if the database RPC returns the wrong business.
  const { data: existingMemberships, error: existingMembershipsError } =
    await supabaseAdmin
      .from("team_members")
      .select("business_id")
      .eq("user_id", user.id);

  if (existingMembershipsError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify your existing TENH workspaces before purchase.",
        details: existingMembershipsError.message,
      },
      { status: 500 },
    );
  }

  const existingBusinessIds = new Set(
    (existingMemberships ?? []).map((membership) => membership.business_id),
  );

  const coreRpcArgs = {
    p_user_id: user.id,
    p_full_name: fullName?.trim() || user.email?.split("@")[0] || "TENH Owner",
    p_email: user.email ?? "",
    p_business_name: businessName,
    p_plan_code: quote.planCode,
    p_channel_limit: quote.channels,
    p_member_limit: quote.users,
    p_billing_cycle: quote.cycle.id as BillingCycle,
  };

  // PostgREST resolves RPCs by the exact argument list. Keep Buy New working
  // safely across TENH database deployments that have either the current or
  // an older create-workspace function signature. Retry ONLY when PostgREST
  // explicitly says the function signature is missing, so a real RPC failure
  // can never create a duplicate workspace on retry.
  let rpcResult = await supabaseAdmin.rpc(
    "tenh_create_subscription_workspace",
    {
      ...coreRpcArgs,
      p_monthly_price_cents: quote.monthlyCents,
      p_total_price_cents: quote.totalCents,
      p_pricing_version: quote.pricingVersion,
    },
  );

  if (rpcResult.error && isMissingRpcSignature(rpcResult.error)) {
    rpcResult = await supabaseAdmin.rpc(
      "tenh_create_subscription_workspace",
      {
        ...coreRpcArgs,
        p_monthly_price_cents: quote.monthlyCents,
        p_total_price_cents: quote.totalCents,
      },
    );
  }

  if (rpcResult.error && isMissingRpcSignature(rpcResult.error)) {
    rpcResult = await supabaseAdmin.rpc(
      "tenh_create_subscription_workspace",
      coreRpcArgs,
    );
  }

  const { data, error } = rpcResult;

  if (error) {
    console.error("[TENH] Unable to create subscription workspace:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });

    return NextResponse.json(
      {
        success: false,
        error: "Unable to create the new subscription.",
        ...(process.env.NODE_ENV !== "production"
          ? { details: error.message, code: error.code }
          : {}),
      },
      { status: 500 },
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const businessId = row?.business_id as string | undefined;

  if (!businessId) {
    return NextResponse.json({ success: false, error: "TENH created no subscription workspace." }, { status: 500 });
  }

  if (existingBusinessIds.has(businessId)) {
    return NextResponse.json(
      {
        success: false,
        error: "TENH blocked this purchase because Buy new subscription must create a separate workspace.",
      },
      { status: 409 },
    );
  }

  const { data: createdMembership, error: createdMembershipError } =
    await supabaseAdmin
      .from("team_members")
      .select("id,role,is_active")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

  if (createdMembershipError || !createdMembership) {
    return NextResponse.json(
      {
        success: false,
        error: "The subscription workspace was created, but TENH could not verify its Owner membership.",
        details: createdMembershipError?.message,
      },
      { status: 500 },
    );
  }

  let purchaseMemberId = createdMembership.id;

  if (createdMembership.role !== "owner" || createdMembership.is_active !== true) {
    const { data: ownerMembership, error: ownerMembershipError } =
      await supabaseAdmin
        .from("team_members")
        .update({ role: "owner", is_active: true })
        .eq("id", createdMembership.id)
        .eq("business_id", businessId)
        .eq("user_id", user.id)
        .select("id,role,is_active")
        .maybeSingle();

    if (
      ownerMembershipError ||
      !ownerMembership ||
      ownerMembership.role !== "owner" ||
      ownerMembership.is_active !== true
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "TENH could not make you Owner of the new subscription workspace.",
          details: ownerMembershipError?.message,
        },
        { status: 500 },
      );
    }

    purchaseMemberId = ownerMembership.id;
  }

  // Seed starter content into the new subscription workspace itself. The
  // defaults are not shared rows, so later edits/deletes stay isolated here.
  try {
    await ensureWorkspaceDefaultContent(businessId);
  } catch (seedError) {
    console.error(
      "Unable to initialize new subscription starter content:",
      seedError,
    );
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
    memberId: purchaseMemberId,
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
