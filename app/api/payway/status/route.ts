import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember, TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { verifyAndFinalizePayWayTransaction } from "@/lib/payway/finalize-payment";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: authResult.error,
        },
        { status: authResult.status },
      );
    }

    const member = authResult.member;

    if (member.role !== "owner") {
      return NextResponse.json(
        {
          success: false,
          error: "Only the workspace owner can verify a subscription payment.",
        },
        { status: 403 },
      );
    }

    const transactionId =
      request.nextUrl.searchParams.get("tran_id")?.trim() || "";

    if (!transactionId) {
      return NextResponse.json(
        {
          success: false,
          error: "tran_id is required.",
        },
        { status: 400 },
      );
    }

    const { data: transaction, error: transactionError } =
      await supabaseAdmin
        .from("billing_transactions")
        .select("id,business_id,status,provider_status,plan_code,billing_cycle")
        .eq("provider", "payway")
        .eq("provider_transaction_id", transactionId)
        .maybeSingle();

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    if (!transaction) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment transaction was not found.",
        },
        { status: 404 },
      );
    }

    const { data: transactionMember } = await supabaseAdmin
      .from("team_members")
      .select("id,role")
      .eq("business_id", transaction.business_id)
      .eq("user_id", authResult.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!transactionMember || transactionMember.role !== "owner") {
      return NextResponse.json(
        { success: false, error: "You do not have access to this payment transaction." },
        { status: 403 },
      );
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
      return NextResponse.json({
        success: true,
        transactionId,
        paymentState: "approved",
        providerStatus: transaction.provider_status,
      });
    }

    const result = await verifyAndFinalizePayWayTransaction(
      transactionId,
      "browser-status",
    );

    if (result.paymentState === "approved" && "businessId" in result && result.businessId) {
      const cookieStore = await cookies();
      cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, result.businessId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return NextResponse.json({
      success: true,
      transactionId,
      paymentState: result.paymentState,
      providerStatus:
        "providerStatus" in result ? result.providerStatus : null,
      providerStatusCode:
        "providerStatusCode" in result
          ? result.providerStatusCode
          : null,
      subscription:
        "subscription" in result ? result.subscription : null,
    });
  } catch (error) {
    console.error("[TENH PayWay] Status verification failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify PayWay transaction.",
      },
      { status: 500 },
    );
  }
}
