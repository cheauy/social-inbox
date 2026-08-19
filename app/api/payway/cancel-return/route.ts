import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getCurrentMember,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE = "tenh_purchase_origin_business_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function subscriptionUrl(request: NextRequest, transactionId: string) {
  const url = new URL("/dashboard/subscription", request.url);
  url.searchParams.set("payway", "cancelled");
  if (transactionId) url.searchParams.set("tran_id", transactionId);
  return url;
}

export async function GET(request: NextRequest) {
  const transactionId = request.nextUrl.searchParams.get("tran_id")?.trim() ?? "";
  const redirectUrl = subscriptionUrl(request, transactionId);

  if (!transactionId) {
    return NextResponse.redirect(redirectUrl);
  }

  const authResult = await getCurrentMember();
  if (!authResult.success) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: transaction, error: transactionError } = await supabaseAdmin
    .from("billing_transactions")
    .select("id,business_id,status,metadata")
    .eq("provider", "payway")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) {
    return NextResponse.redirect(redirectUrl);
  }

  const { data: transactionMember } = await supabaseAdmin
    .from("team_members")
    .select("id,role")
    .eq("business_id", transaction.business_id)
    .eq("user_id", authResult.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!transactionMember || transactionMember.role !== "owner") {
    return NextResponse.redirect(redirectUrl);
  }

  // Payment cancellation only cancels the pending payment attempt.
  // It must never turn a real active/previous subscription into Expired.
  if (transaction.status === "pending") {
    const transactionMetadata =
      transaction.metadata && typeof transaction.metadata === "object"
        ? (transaction.metadata as Record<string, unknown>)
        : {};

    await supabaseAdmin
      .from("billing_transactions")
      .update({
        status: "cancelled",
        provider_status: "CUSTOMER_CANCELLED",
        metadata: {
          ...transactionMetadata,
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

  if (subscription) {
    const snapshot =
      subscription.pricing_snapshot &&
      typeof subscription.pricing_snapshot === "object"
        ? (subscription.pricing_snapshot as Record<string, unknown>)
        : {};

    const createdUnpaid = snapshot.created_unpaid === true;
    const amount = Number(subscription.last_paid_amount);
    const neverPaid =
      subscription.last_paid_amount === null ||
      !Number.isFinite(amount) ||
      amount <= 0;
    const hasNoPaidPeriod =
      !subscription.current_period_start && !subscription.current_period_end;

    // V3.11.31 creates a locked placeholder before checkout. If THAT new
    // purchase is cancelled, mark it Cancelled instead of Expired. Existing
    // paid subscriptions are intentionally left untouched.
    if (
      transactionMember.role === "owner" &&
      createdUnpaid &&
      neverPaid &&
      hasNoPaidPeriod &&
      subscription.status === "expired"
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
        .eq("business_id", transaction.business_id)
        .eq("status", "expired");
    }
  }

  // If this checkout was started from another still-usable subscription,
  // return the browser to that exact subscription after cancellation. Never
  // restore from the cookie without validating membership + subscription state.
  const cookieStore = await cookies();
  const originBusinessId =
    cookieStore.get(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE)?.value?.trim() ?? "";

  if (originBusinessId && originBusinessId !== transaction.business_id) {
    const [{ data: originMember }, { data: originSubscription }] =
      await Promise.all([
        supabaseAdmin
          .from("team_members")
          .select("id")
          .eq("business_id", originBusinessId)
          .eq("user_id", authResult.user.id)
          .eq("is_active", true)
          .maybeSingle(),
        supabaseAdmin
          .from("business_subscriptions")
          .select("status")
          .eq("business_id", originBusinessId)
          .maybeSingle(),
      ]);

    if (
      originMember &&
      originSubscription &&
      ["active", "trialing"].includes(originSubscription.status)
    ) {
      cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, originBusinessId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }

  cookieStore.delete(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE);

  return NextResponse.redirect(redirectUrl);
}
