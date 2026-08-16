import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{
    invoiceId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const currentMember = authResult.member;

  if (currentMember.role !== "owner") {
    return NextResponse.json(
      {
        success: false,
        error: "Only the workspace owner can view billing receipts.",
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const { invoiceId } = await context.params;
  const cleanInvoiceId = invoiceId.trim();

  if (!UUID_PATTERN.test(cleanInvoiceId)) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid receipt ID.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("tenh_billing_invoices")
    .select(
      [
        "id",
        "invoice_number",
        "business_id",
        "source_type",
        "source_payment_id",
        "source_transaction_id",
        "workspace_name",
        "customer_name",
        "billing_email",
        "plan_code",
        "plan_name",
        "billing_cycle",
        "billing_cycle_label",
        "amount",
        "currency",
        "payment_method",
        "provider",
        "provider_approval_code",
        "status",
        "paid_at",
        "period_start",
        "period_end",
        "issued_at",
        "created_at",
      ].join(","),
    )
    .eq("id", cleanInvoiceId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  if (error) {
    console.error("[TENH Invoice] Unable to load receipt:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load this billing receipt.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  if (!data) {
    // Use 404 for both missing and cross-workspace IDs so the route does not
    // reveal whether another TENH workspace owns a particular invoice UUID.
    return NextResponse.json(
      {
        success: false,
        error: "Billing receipt was not found.",
      },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  return NextResponse.json(
    {
      success: true,
      invoice: {
        id: data.id,
        invoiceNumber: data.invoice_number,
        sourceType: data.source_type,
        sourcePaymentId: data.source_payment_id,
        transactionId: data.source_transaction_id,
        workspaceName: data.workspace_name,
        customerName: data.customer_name,
        billingEmail: data.billing_email,
        planCode: data.plan_code,
        planName: data.plan_name,
        billingCycle: data.billing_cycle,
        billingCycleLabel: data.billing_cycle_label,
        amount: Number(data.amount),
        currency: data.currency,
        paymentMethod: data.payment_method,
        provider: data.provider,
        approvalCode: data.provider_approval_code,
        status: data.status,
        paidAt: data.paid_at,
        periodStart: data.period_start,
        periodEnd: data.period_end,
        issuedAt: data.issued_at,
        createdAt: data.created_at,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
