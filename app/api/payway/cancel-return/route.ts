import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getCurrentMember,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { closePayWayTransaction } from "@/lib/payway/close-transaction";
import { verifyAndFinalizePayWayTransaction } from "@/lib/payway/finalize-payment";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE = "tenh_purchase_origin_business_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CancelResult =
  | {
      success: true;
      paymentState: "cancelled" | "approved";
      transactionId: string;
      businessId: string;
    }
  | {
      success: false;
      status: number;
      error: string;
      transactionId: string;
    };

function subscriptionUrl(
  request: NextRequest,
  transactionId: string,
  state: "cancelled" | "approved" | "cancel_failed",
) {
  const url = new URL("/dashboard/subscription", request.url);
  url.searchParams.set("payway", state);
  if (transactionId) url.searchParams.set("tran_id", transactionId);
  return url;
}

async function restorePurchaseOrigin(
  userId: string,
  transactionBusinessId: string,
) {
  const cookieStore = await cookies();
  const originBusinessId =
    cookieStore.get(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE)?.value?.trim() ?? "";

  if (originBusinessId && originBusinessId !== transactionBusinessId) {
    const [{ data: originMember }, { data: originSubscription }] =
      await Promise.all([
        supabaseAdmin
          .from("team_members")
          .select("id")
          .eq("business_id", originBusinessId)
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle(),
        supabaseAdmin
          .from("business_subscriptions")
          .select("status,current_period_end")
          .eq("business_id", originBusinessId)
          .maybeSingle(),
      ]);

    const periodEnd = originSubscription?.current_period_end
      ? Date.parse(originSubscription.current_period_end)
      : Number.NaN;
    const stillUsable =
      originSubscription?.status === "trialing" ||
      (originSubscription?.status === "active" &&
        (!Number.isFinite(periodEnd) || periodEnd > Date.now()));

    if (originMember && stillUsable) {
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
}

async function markUnpaidPlaceholderCancelled(businessId: string) {
  const { data: subscription } = await supabaseAdmin
    .from("business_subscriptions")
    .select(
      "business_id,status,current_period_start,current_period_end,last_paid_amount,pricing_snapshot",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  if (!subscription) return;

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

  if (
    createdUnpaid &&
    neverPaid &&
    hasNoPaidPeriod &&
    ["expired", "cancelled"].includes(subscription.status)
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
      .eq("business_id", businessId);
  }
}

async function cancelPayWayTransactionForCurrentUser(
  transactionId: string,
): Promise<CancelResult> {
  const authResult = await getCurrentMember();
  if (!authResult.success) {
    return {
      success: false,
      status: authResult.status,
      error: authResult.error,
      transactionId,
    };
  }

  const { data: transaction, error: transactionError } = await supabaseAdmin
    .from("billing_transactions")
    .select("id,business_id,status,metadata")
    .eq("provider", "payway")
    .eq("provider_transaction_id", transactionId)
    .maybeSingle();

  if (transactionError || !transaction) {
    return {
      success: false,
      status: 404,
      error: "Payment transaction was not found.",
      transactionId,
    };
  }

  const { data: transactionMember } = await supabaseAdmin
    .from("team_members")
    .select("id,role")
    .eq("business_id", transaction.business_id)
    .eq("user_id", authResult.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (
    !transactionMember ||
    !(await memberHasPermission(transactionMember, "billing", "manage"))
  ) {
    return {
      success: false,
      status: 403,
      error: "You do not have permission to cancel this payment.",
      transactionId,
    };
  }

  if (transaction.status === "approved") {
    const cookieStore = await cookies();
    cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, transaction.business_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    cookieStore.delete(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE);
    return {
      success: true,
      paymentState: "approved",
      transactionId,
      businessId: transaction.business_id,
    };
  }

  let verifiedState: string | null = null;
  if (transaction.status === "pending") {
    try {
      const verification = await verifyAndFinalizePayWayTransaction(
        transactionId,
        "browser-status",
      );
      verifiedState = verification.paymentState;

      if (verification.paymentState === "approved") {
        const cookieStore = await cookies();
        cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, transaction.business_id, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
        cookieStore.delete(TENH_PURCHASE_ORIGIN_BUSINESS_COOKIE);
        return {
          success: true,
          paymentState: "approved",
          transactionId,
          businessId: transaction.business_id,
        };
      }
    } catch (error) {
      // A status check can briefly fail while PayWay is creating the
      // transaction. We still attempt PayWay Close Transaction below.
      console.warn("[TENH PayWay] Pre-cancel status verification failed:", error);
    }
  }

  const alreadyTerminal =
    transaction.status !== "pending" ||
    ["cancelled", "declined", "failed"].includes(verifiedState ?? "");

  let closeInfo: Record<string, unknown> = {
    attempted: false,
    already_terminal: alreadyTerminal,
  };

  if (!alreadyTerminal) {
    try {
      const closeResult = await closePayWayTransaction(transactionId);
      closeInfo = {
        attempted: true,
        succeeded: closeResult.closed,
        request_time: closeResult.reqTime,
        status_code: closeResult.response.status?.code ?? null,
        message: closeResult.response.status?.message ?? null,
      };

      if (!closeResult.closed) {
        return {
          success: false,
          status: 502,
          error:
            closeResult.response.status?.message ||
            "ABA PayWay did not confirm that the transaction was closed.",
          transactionId,
        };
      }
    } catch (error) {
      console.error("[TENH PayWay] Close Transaction failed:", error);
      return {
        success: false,
        status: 502,
        error:
          error instanceof Error
            ? error.message
            : "Unable to close the ABA PayWay transaction.",
        transactionId,
      };
    }
  }

  const transactionMetadata =
    transaction.metadata && typeof transaction.metadata === "object"
      ? (transaction.metadata as Record<string, unknown>)
      : {};

  const { error: cancelError } = await supabaseAdmin
    .from("billing_transactions")
    .update({
      status: "cancelled",
      provider_status: "CUSTOMER_CANCELLED",
      metadata: {
        ...transactionMetadata,
        customer_cancelled: true,
        customer_cancelled_at: new Date().toISOString(),
        payway_close: closeInfo,
      },
    })
    .eq("id", transaction.id)
    .neq("status", "approved");

  if (cancelError) {
    return {
      success: false,
      status: 500,
      error: "The PayWay transaction was closed, but TENH could not save its cancelled state.",
      transactionId,
    };
  }

  await markUnpaidPlaceholderCancelled(transaction.business_id);
  await restorePurchaseOrigin(authResult.user.id, transaction.business_id);

  return {
    success: true,
    paymentState: "cancelled",
    transactionId,
    businessId: transaction.business_id,
  };
}

export async function POST(request: NextRequest) {
  let transactionId = "";
  try {
    const body = (await request.json()) as { transactionId?: unknown };
    transactionId =
      typeof body.transactionId === "string" ? body.transactionId.trim() : "";
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid cancellation request." },
      { status: 400 },
    );
  }

  if (!transactionId) {
    return NextResponse.json(
      { success: false, error: "Payment transaction ID is required." },
      { status: 400 },
    );
  }

  const result = await cancelPayWayTransactionForCurrentUser(transactionId);
  if ("status" in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  const transactionId = request.nextUrl.searchParams.get("tran_id")?.trim() ?? "";
  if (!transactionId) {
    return NextResponse.redirect(subscriptionUrl(request, "", "cancelled"));
  }

  const result = await cancelPayWayTransactionForCurrentUser(transactionId);

  if (result.success && result.paymentState === "approved") {
    return NextResponse.redirect(subscriptionUrl(request, transactionId, "approved"));
  }

  if (!result.success) {
    const authResult = await getCurrentMember();
    if (!authResult.success && authResult.status === 401) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.redirect(
      subscriptionUrl(request, transactionId, "cancel_failed"),
    );
  }

  return NextResponse.redirect(subscriptionUrl(request, transactionId, "cancelled"));
}
