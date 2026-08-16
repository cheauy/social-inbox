import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BillingStatus =
  | "pending"
  | "approved"
  | "declined"
  | "rejected"
  | "cancelled"
  | "failed";

type PaymentSource = "payway" | "manual";

type BillingHistoryItem = {
  id: string;
  sourceId: string;
  source: PaymentSource;
  transactionId: string;
  paymentMethod: string;
  planCode: string;
  billingCycle: string;
  amount: number;
  currency: string;
  status: BillingStatus;
  providerStatus: string | null;
  approvalCode: string | null;
  reviewNote: string | null;
  createdAt: string;
  paidAt: string | null;
  reviewedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

type InvoiceLinkRow = {
  id: string;
  invoice_number: string;
  source_type: PaymentSource;
  source_payment_id: string;
};

type PayWayRow = {
  id: string;
  provider_transaction_id: string;
  plan_code: string;
  billing_cycle: string;
  amount: string | number;
  currency: string;
  status: string;
  provider_status: string | null;
  provider_approval_code: string | null;
  verified_at: string | null;
  created_at: string;
};

type ManualPaymentRow = {
  id: string;
  plan_code: string;
  billing_cycle: string;
  amount: string | number;
  currency: string;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  created_at: string;
};

function normalizeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function addBillingCycle(
  startValue: string | null,
  billingCycle: string,
) {
  if (!startValue) return null;

  const start = new Date(startValue);
  if (!Number.isFinite(start.getTime())) return null;

  const end = new Date(start);

  switch (billingCycle) {
    case "monthly":
      end.setUTCMonth(end.getUTCMonth() + 1);
      break;
    case "3-months":
      end.setUTCMonth(end.getUTCMonth() + 3);
      break;
    case "6-months":
      end.setUTCMonth(end.getUTCMonth() + 6);
      break;
    case "12-months":
      end.setUTCMonth(end.getUTCMonth() + 12);
      break;
    default:
      return null;
  }

  return end.toISOString();
}

function normalizeManualStatus(status: string): BillingStatus {
  if (status === "submitted") return "pending";
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export async function GET() {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const member = authResult.member;

    if (member.role !== "owner") {
      return NextResponse.json(
        {
          success: false,
          error: "Only the workspace owner can view billing history.",
        },
        { status: 403 },
      );
    }

    const [payWayResult, manualResult, invoiceResult] = await Promise.all([
      supabaseAdmin
        .from("billing_transactions")
        .select(
          [
            "id",
            "provider_transaction_id",
            "plan_code",
            "billing_cycle",
            "amount",
            "currency",
            "status",
            "provider_status",
            "provider_approval_code",
            "verified_at",
            "created_at",
          ].join(","),
        )
        .eq("business_id", member.business_id)
        .eq("provider", "payway")
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("manual_payment_requests")
        .select(
          [
            "id",
            "plan_code",
            "billing_cycle",
            "amount",
            "currency",
            "status",
            "review_note",
            "reviewed_at",
            "approved_at",
            "created_at",
          ].join(","),
        )
        .eq("business_id", member.business_id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("tenh_billing_invoices")
        .select("id,invoice_number,source_type,source_payment_id")
        .eq("business_id", member.business_id)
        .order("issued_at", { ascending: false })
        .limit(200),
    ]);

    if (payWayResult.error) {
      throw new Error(payWayResult.error.message);
    }

    if (manualResult.error) {
      throw new Error(manualResult.error.message);
    }

    if (invoiceResult.error) {
      throw new Error(
        `Unable to load invoice links. Run the V3.10.4 invoice migration first. ${invoiceResult.error.message}`,
      );
    }

    const invoicesBySource = new Map<string, InvoiceLinkRow>();

    const invoiceRows =
      (invoiceResult.data ?? []) as unknown as InvoiceLinkRow[];
    const payWayRows =
      (payWayResult.data ?? []) as unknown as PayWayRow[];
    const manualRows =
      (manualResult.data ?? []) as unknown as ManualPaymentRow[];

    for (const invoice of invoiceRows) {
      invoicesBySource.set(
        `${invoice.source_type}:${invoice.source_payment_id}`,
        invoice,
      );
    }

    const payWayItems: BillingHistoryItem[] = payWayRows.map(
      (row) => {
        const paidAt =
          row.status === "approved"
            ? row.verified_at ?? row.created_at
            : null;
        const invoice = invoicesBySource.get(`payway:${row.id}`) ?? null;

        return {
          id: `payway:${row.id}`,
          sourceId: row.id,
          source: "payway",
          transactionId: row.provider_transaction_id,
          paymentMethod: "ABA Pay / KHQR",
          planCode: row.plan_code,
          billingCycle: row.billing_cycle,
          amount: normalizeNumber(row.amount),
          currency: row.currency,
          status: row.status as BillingStatus,
          providerStatus: row.provider_status,
          approvalCode: row.provider_approval_code,
          reviewNote: null,
          createdAt: row.created_at,
          paidAt,
          reviewedAt: null,
          periodStart: paidAt,
          periodEnd: addBillingCycle(paidAt, row.billing_cycle),
          invoiceId: invoice?.id ?? null,
          invoiceNumber: invoice?.invoice_number ?? null,
        };
      },
    );

    const manualItems: BillingHistoryItem[] = manualRows.map(
      (row) => {
        const paidAt =
          row.status === "approved"
            ? row.approved_at ?? row.reviewed_at ?? row.created_at
            : null;
        const invoice = invoicesBySource.get(`manual:${row.id}`) ?? null;

        return {
          id: `manual:${row.id}`,
          sourceId: row.id,
          source: "manual",
          transactionId: `MAN-${String(row.id).slice(0, 8).toUpperCase()}`,
          paymentMethod: "Manual bank transfer",
          planCode: row.plan_code,
          billingCycle: row.billing_cycle,
          amount: normalizeNumber(row.amount),
          currency: row.currency,
          status: normalizeManualStatus(row.status),
          providerStatus: null,
          approvalCode: null,
          reviewNote: row.review_note,
          createdAt: row.created_at,
          paidAt,
          reviewedAt: row.reviewed_at,
          periodStart: paidAt,
          periodEnd: addBillingCycle(paidAt, row.billing_cycle),
          invoiceId: invoice?.id ?? null,
          invoiceNumber: invoice?.invoice_number ?? null,
        };
      },
    );

    const items = [...payWayItems, ...manualItems]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() -
          new Date(a.createdAt).getTime(),
      )
      .slice(0, 150);

    const approvedItems = items.filter(
      (item) => item.status === "approved",
    );

    const summary = {
      total: items.length,
      approved: approvedItems.length,
      pending: items.filter((item) => item.status === "pending").length,
      attention: items.filter((item) =>
        ["declined", "rejected", "failed"].includes(item.status),
      ).length,
      approvedUsdTotal: approvedItems
        .filter((item) => item.currency === "USD")
        .reduce((sum, item) => sum + item.amount, 0),
      receipts: approvedItems.filter((item) => Boolean(item.invoiceId)).length,
    };

    return NextResponse.json({
      success: true,
      items,
      summary,
    });
  } catch (error) {
    console.error("[TENH Billing] Unable to load billing history:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load billing history.",
      },
      { status: 500 },
    );
  }
}
