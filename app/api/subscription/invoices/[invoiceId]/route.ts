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

type InvoiceRow = {
  id: string;
  invoice_number: string;
  business_id: string;
  source_type: string;
  source_payment_id: string;
  source_transaction_id: string;
  workspace_name: string;
  customer_name: string | null;
  billing_email: string | null;
  plan_code: string;
  plan_name: string;
  billing_cycle: string;
  billing_cycle_label: string;
  amount: string | number;
  currency: string;
  payment_method: string;
  provider: string;
  provider_approval_code: string | null;
  status: string;
  paid_at: string;
  period_start: string;
  period_end: string;
  issued_at: string;
  created_at: string;
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

  const invoiceData =
    data as unknown as InvoiceRow | null;

  if (!invoiceData) {
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
        id: invoiceData.id,
        invoiceNumber: invoiceData.invoice_number,
        sourceType: invoiceData.source_type,
        sourcePaymentId: invoiceData.source_payment_id,
        transactionId: invoiceData.source_transaction_id,
        workspaceName: invoiceData.workspace_name,
        customerName: invoiceData.customer_name,
        billingEmail: invoiceData.billing_email,
        planCode: invoiceData.plan_code,
        planName: invoiceData.plan_name,
        billingCycle: invoiceData.billing_cycle,
        billingCycleLabel: invoiceData.billing_cycle_label,
        amount: Number(invoiceData.amount),
        currency: invoiceData.currency,
        paymentMethod: invoiceData.payment_method,
        provider: invoiceData.provider,
        approvalCode: invoiceData.provider_approval_code,
        status: invoiceData.status,
        paidAt: invoiceData.paid_at,
        periodStart: invoiceData.period_start,
        periodEnd: invoiceData.period_end,
        issuedAt: invoiceData.issued_at,
        createdAt: invoiceData.created_at,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
