import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getCurrentMember,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { cancelPayment } from "@/lib/billing/cancel-payment";
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

async function cancelPayWayTransactionForCurrentUser(transactionId: string): Promise<CancelResult> {
  const auth = await getCurrentMember();
  if (!auth.success) return { success: false, status: auth.status, error: auth.error, transactionId };
  const transaction = await supabaseAdmin.from("billing_transactions").select("business_id")
    .eq("provider", "payway").eq("provider_transaction_id", transactionId).maybeSingle();
  if (transaction.error || !transaction.data) return { success: false, status: 404, error: "Payment unavailable.", transactionId };
  const member = await supabaseAdmin.from("team_members").select("id,role")
    .eq("business_id", transaction.data.business_id).eq("user_id", auth.user.id).eq("is_active", true).maybeSingle();
  if (!member.data || !(await memberHasPermission(member.data, "billing", "manage"))) {
    return { success: false, status: 403, error: "Billing management permission required.", transactionId };
  }
  try {
    const outcome = await cancelPayment({ kind: "payway", paymentId: transactionId, businessId: transaction.data.business_id,
      actorId: auth.user.id, memberId: member.data.id, withdraw: false });
    if (outcome !== "cancelled" && outcome !== "paid") return { success: false, status: 409,
      error: "This payment requires reconciliation. Do not pay again.", transactionId };
    if (outcome === "cancelled") await restorePurchaseOrigin(auth.user.id, transaction.data.business_id);
    return { success: true, paymentState: outcome === "paid" ? "approved" : "cancelled", transactionId, businessId: transaction.data.business_id };
  } catch {
    return { success: false, status: 409, error: "Unable to confirm cancellation. Refresh this payment. Do not pay again.", transactionId };
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ success: false }, { status: 403 });
  let transactionId = "";
  try {
    const body = (await request.json()) as { transactionId?: unknown; confirmed?: unknown };
    if (body.confirmed !== true) return NextResponse.json({ success: false, error: "Confirm cancellation first." }, { status: 400 });
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

// Provider browser returns are navigation, not authorization to cancel a payment.
export async function GET(request: NextRequest) {
  const transactionId = request.nextUrl.searchParams.get("tran_id")?.trim() ?? "";
  const url = new URL("/dashboard/subscription/payment", request.url);
  if (transactionId) url.searchParams.set("tran_id", transactionId);
  url.searchParams.set("payway", "closed");
  return NextResponse.redirect(url);
}
