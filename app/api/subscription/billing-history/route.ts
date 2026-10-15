import { NextResponse } from "next/server";
import { getBillingOwnerAccess } from "@/lib/billing/owner-access";
import { billingCurrency, billingDate, billingNumber, paymentMethodLabel, paymentProvenance, type BillingHistoryItem } from "@/lib/billing/payment-display";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;

export async function GET() {
  try {
    const auth = await getBillingOwnerAccess();
    if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status, headers });
    if (!auth.businessIds.length) return NextResponse.json({ success: false, error: "Only an owner can view billing history." }, { status: 403, headers });
    const [payway, manual, invoices, businesses] = await Promise.all([
      supabaseAdmin.from("billing_transactions")
        .select("id,business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,provider_status,provider_status_code,provider_original_amount,provider_payment_amount,provider_payment_currency,provider_approval_code,verified_at,created_at,metadata")
        .in("business_id", auth.businessIds).in("provider", ["payway", "bakong"]).order("created_at", { ascending: false }).limit(300),
      supabaseAdmin.from("manual_payment_requests")
        .select("id,business_id,plan_code,billing_cycle,amount,currency,status,review_note,reviewed_at,approved_at,created_at")
        .in("business_id", auth.businessIds).order("created_at", { ascending: false }).limit(300),
      supabaseAdmin.from("tenh_billing_invoices")
        .select("id,business_id,invoice_number,source_type,source_payment_id,source_transaction_id,workspace_name,provider,status,amount,currency,paid_at,period_start,period_end,snapshot")
        .in("business_id", auth.businessIds).eq("status", "paid").order("issued_at", { ascending: false }).limit(600),
      supabaseAdmin.from("businesses").select("id,name").in("id", auth.businessIds),
    ]);
    if (payway.error || manual.error || invoices.error || businesses.error) throw new Error("Billing data lookup failed.");
    const names = new Map((businesses.data ?? []).map(row => [row.id, text(row.name)]));
    const issued = new Map<string, Row>();
    for (const invoice of (invoices.data ?? []) as Row[]) {
      const key = `${invoice.business_id}:${invoice.source_type}:${invoice.source_payment_id}`;
      if (!issued.has(key)) issued.set(key, invoice);
    }
    const item = (row: Row, source: "manual" | "payway" | "bakong"): BillingHistoryItem => {
      const bakongState = source === "bakong" ? (row.metadata as Row | null)?.bakong_state : null;
      const status = bakongState === "test_paid" ? "test_paid" : row.status === "approved" ? "approved" :
        bakongState === "verified" ? "verified" : bakongState === "review" ? "recovery_required" : row.status === "submitted" ? "pending" : String(row.status ?? "unknown");
      const invoice = issued.get(`${row.business_id}:${source}:${row.id}`) ?? null;
      const provenance = paymentProvenance(source, row, invoice);
      const approved = status === "approved";
      const safeProviderStatus = ["APPROVED", "PENDING", "DECLINED", "FAILED", "CANCELLED", "CANCELED", "PROCESSING"].includes(String(row.provider_status)) ? String(row.provider_status) : null;
      return {
        id: `${source}:${row.id}`, sourceId: String(row.id), source, businessId: String(row.business_id),
        workspaceName: text(invoice?.workspace_name) ?? names.get(String(row.business_id)) ?? "?",
        ...provenance,
        transactionId: text(invoice?.source_transaction_id) ?? (source !== "manual" ? text(row.provider_transaction_id) : null),
        paymentMethod: paymentMethodLabel(provenance.provider), planCode: String(row.plan_code ?? ""), billingCycle: String(row.billing_cycle ?? ""),
        amount: billingNumber(invoice ? invoice.amount : row.amount), currency: billingCurrency(invoice ? invoice.currency : row.currency), status,
        providerStatus: source !== "manual" ? safeProviderStatus : null,
        approvalCode: provenance.providerVerified ? text(row.provider_approval_code) : null,
        reviewNote: source === "manual" ? text(row.review_note) : null, createdAt: String(row.created_at ?? ""),
        paidAt: approved ? billingDate(invoice ? invoice.paid_at : source !== "manual" ? row.verified_at : row.approved_at ?? row.reviewed_at) : null,
        reviewedAt: source === "manual" ? billingDate(row.reviewed_at) : null,
        // Coverage belongs to the issued historical snapshot, never the current plan or an estimated cycle.
        periodStart: approved && invoice ? billingDate(invoice.period_start) : null,
        periodEnd: approved && invoice ? billingDate(invoice.period_end) : null,
        invoiceId: approved && invoice ? String(invoice.id) : null,
        invoiceNumber: approved && invoice ? text(invoice.invoice_number) : null,
      };
    };
    const items = [...((payway.data ?? []) as Row[]).map(row => item(row, row.provider === "bakong" ? "bakong" : "payway")), ...((manual.data ?? []) as Row[]).map(row => item(row, "manual"))]
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || b.id.localeCompare(a.id)).slice(0, 500);
    const approved = items.filter(item => item.status === "approved");
    const totalUsd = (entries: BillingHistoryItem[]) => entries.filter(item => item.currency === "USD").reduce((sum, item) => sum + (item.amount ?? 0), 0);
    return NextResponse.json({ success: true, items, summary: {
      total: items.length, approved: approved.length, pending: items.filter(item => item.status === "pending").length,
      attention: items.filter(item => ["declined", "failed", "rejected", "recovery_required", "unknown"].includes(item.status)).length,
      approvedUsdTotal: totalUsd(approved.filter(item => item.confirmedPaid)),
      testUsdTotal: totalUsd(items.filter(item => (item.status === "approved" || item.status === "test_paid") && item.environment === "sandbox")),
      unverifiedUsdTotal: totalUsd(approved.filter(item => !item.confirmedPaid && item.environment !== "sandbox")),
      receipts: approved.filter(item => item.invoiceId).length,
    } }, { headers });
  } catch (error) {
    console.error("[TENH Billing] Unable to load billing history:", error);
    return NextResponse.json({ success: false, error: "Billing is temporarily unavailable." }, { status: 500, headers });
  }
}
