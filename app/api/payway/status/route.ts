import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
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
        .eq("business_id", member.business_id)
        .maybeSingle();

    if (transactionError) {
      throw new Error(transactionError.message);
    }

    if (!transaction) {
      return NextResponse.json(
        {
          success: false,
          error: "Payment transaction was not found for this workspace.",
        },
        { status: 404 },
      );
    }

    if (transaction.status === "approved") {
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
