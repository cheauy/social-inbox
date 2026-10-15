import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember, TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { verifyAndFinalizePayWayTransaction } from "@/lib/payway/finalize-payment";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findPayWayInvoiceId(
  businessId: string,
  sourcePaymentId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("tenh_billing_invoices")
    .select("id")
    .eq("business_id", businessId)
    .eq("source_type", "payway")
    .eq("source_payment_id", sourcePaymentId)
    .maybeSingle();

  if (error) {
    // Receipt creation must never turn an already-approved payment into an
    // error screen. The customer can still continue and open Billing History.
    console.warn("[TENH PayWay] Unable to resolve receipt for transaction:", error.message);
    return null;
  }

  return typeof data?.id === "string" ? data.id : null;
}

export async function GET(request: NextRequest) {
  try {
    const preserveWorkspace = request.nextUrl.searchParams.get("preserve_workspace") === "1";
    let userId: string;
    if (preserveWorkspace) {
      const client = await createClient();
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return NextResponse.json({ success: false, error: "Sign in to verify this payment." }, { status: 401 });
      userId = user.id;
    } else {
      const authResult = await getCurrentMember();
      if (!authResult.success) return NextResponse.json({ success: false, error: authResult.error }, { status: authResult.status });
      userId = authResult.user.id;
    }

    const transactionId =
      request.nextUrl.searchParams.get("tran_id")?.trim() || "";
    const expectedBusiness = request.nextUrl.searchParams.get("purchase_business");

    if (!transactionId || (expectedBusiness !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedBusiness))) {
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

    if (!transaction || (expectedBusiness !== null && transaction.business_id !== expectedBusiness)) {
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
      .eq("user_id", userId)
      .eq("is_active", true)
      // See get-inbox-resource-access: a re-invited member can hold two
      // active rows, and maybeSingle() turns that into a 500.
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      !transactionMember ||
      !(await memberHasPermission(transactionMember, "billing", "manage"))
    ) {
      return NextResponse.json(
        { success: false, error: "You do not have Subscription & billing Manage permission for this payment transaction." },
        { status: 403 },
      );
    }

    if (transaction.status === "approved") {
      if (!preserveWorkspace) {
        const cookieStore = await cookies();
        cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, transaction.business_id, {
          httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
          path: "/", maxAge: 60 * 60 * 24 * 365,
        });
      }
      const invoiceId = await findPayWayInvoiceId(
        transaction.business_id,
        transaction.id,
      );

      return NextResponse.json({
        success: true,
        transactionId,
        businessId: transaction.business_id,
        paymentState: "approved",
        providerStatus: transaction.provider_status,
        invoiceId,
      });
    }

    const result = await verifyAndFinalizePayWayTransaction(
      transactionId,
      "browser-status",
    );
    if ("businessId" in result && result.businessId && result.businessId !== transaction.business_id) {
      throw new Error("Payment workspace did not match the saved attempt.");
    }

    if (!preserveWorkspace && result.paymentState === "approved" && "businessId" in result && result.businessId) {
      const cookieStore = await cookies();
      cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, result.businessId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    const invoiceId =
      result.paymentState === "approved"
        ? await findPayWayInvoiceId(
            transaction.business_id,
            transaction.id,
          )
        : null;

    return NextResponse.json({
      success: true,
      businessId: transaction.business_id,
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
      invoiceId,
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

// Browser verification is explicit; native clients retain the existing GET contract.
export const POST = GET;
