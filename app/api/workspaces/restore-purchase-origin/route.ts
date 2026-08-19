import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE = "tenh_purchase_origin_business_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function cancelPendingPurchase(transactionId: string, userId: string) {
  if (!transactionId) return;

  const { data: transaction } = await supabaseAdmin
    .from("billing_transactions")
    .select("id,business_id,status,metadata")
    .eq("provider", "payway")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();

  if (!transaction) return;

  const { data: membership } = await supabaseAdmin
    .from("team_members")
    .select("id,role")
    .eq("business_id", transaction.business_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership || membership.role !== "owner") return;

  if (transaction.status === "pending") {
    const metadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : {};

    await supabaseAdmin
      .from("billing_transactions")
      .update({
        status: "cancelled",
        provider_status: "CUSTOMER_CANCELLED",
        metadata: {
          ...metadata,
          customer_cancelled: true,
          customer_cancelled_at: new Date().toISOString(),
        },
      })
      .eq("id", transaction.id)
      .eq("status", "pending");
  }

  const { data: subscription } = await supabaseAdmin
    .from("business_subscriptions")
    .select(
      "business_id,status,current_period_start,current_period_end,last_paid_amount,pricing_snapshot",
    )
    .eq("business_id", transaction.business_id)
    .maybeSingle();

  if (!subscription) return;

  const snapshot =
    subscription.pricing_snapshot &&
    typeof subscription.pricing_snapshot === "object" &&
    !Array.isArray(subscription.pricing_snapshot)
      ? (subscription.pricing_snapshot as Record<string, unknown>)
      : {};

  const createdUnpaid = snapshot.created_unpaid === true;
  const paidAmount = Number(subscription.last_paid_amount);
  const neverPaid =
    subscription.last_paid_amount === null ||
    !Number.isFinite(paidAmount) ||
    paidAmount <= 0;
  const hasNoPaidPeriod =
    !subscription.current_period_start && !subscription.current_period_end;

  if (
    createdUnpaid &&
    neverPaid &&
    hasNoPaidPeriod &&
    ["expired", "pending", "incomplete"].includes(subscription.status)
  ) {
    await supabaseAdmin
      .from("business_subscriptions")
      .update({
        status: "cancelled",
        pricing_snapshot: {
          ...snapshot,
          payment_cancelled: true,
          payment_cancelled_at: new Date().toISOString(),
        },
      })
      .eq("business_id", transaction.business_id);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  let transactionId = "";
  try {
    const body = (await request.json()) as { transactionId?: unknown };
    if (typeof body.transactionId === "string") {
      transactionId = body.transactionId.trim();
    }
  } catch {
    // Body is optional for old callers.
  }

  // If PayWay just returned a cancellation, safely cancel only that exact
  // pending transaction and its never-paid placeholder workspace.
  await cancelPendingPurchase(transactionId, user.id);

  const cookieStore = await cookies();
  const originBusinessId =
    cookieStore.get(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE)?.value?.trim() ?? "";

  if (!originBusinessId) {
    return NextResponse.json({ success: true, restored: false });
  }

  // Never trust the cookie by itself. Restore only when this authenticated
  // user still has active membership AND the original subscription is usable.
  const [{ data: membership }, { data: subscription }] = await Promise.all([
    supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("business_id", originBusinessId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
    supabaseAdmin
      .from("business_subscriptions")
      .select("status")
      .eq("business_id", originBusinessId)
      .maybeSingle(),
  ]);

  if (
    !membership ||
    !subscription ||
    !["active", "trialing"].includes(subscription.status)
  ) {
    cookieStore.delete(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE);
    return NextResponse.json({ success: true, restored: false });
  }

  cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, originBusinessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  cookieStore.delete(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE);

  return NextResponse.json({
    success: true,
    restored: true,
    businessId: originBusinessId,
  });
}
