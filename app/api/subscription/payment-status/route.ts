import { NextResponse } from "next/server";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { describePaymentAttempt } from "@/lib/billing/payment-attempt";
import { getCustomerPaymentReferences } from "@/lib/billing/customer-payment-references";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PAYMENT_CANCELLATION_ENABLED } from "@/lib/billing/payment-cancellation-feature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;

export async function GET(request: Request) {
  // Sample at request entry so the client can include the full request time
  // without counting database/authorization work twice in its checkout clock.
  const serverTime = new Date().toISOString();
  try {
    const params = new URL(request.url).searchParams;
    const manualId = params.get("manual_request"), transactionId = params.get("tran_id"), expectedBusiness = params.get("purchase_business");
    const receipt = params.has("receipt");
    if (params.has("manual_request") === params.has("tran_id") || params.getAll("manual_request").length > 1 || params.getAll("tran_id").length > 1 ||
      (receipt && (!manualId || params.get("receipt") !== "1" || params.getAll("receipt").length !== 1)) ||
      (manualId !== null && !uuid.test(manualId)) || (transactionId !== null && !/^[A-Za-z0-9_-]{1,20}$/.test(transactionId)) ||
      (expectedBusiness !== null && (!uuid.test(expectedBusiness) || params.getAll("purchase_business").length > 1))) {
      return NextResponse.json({ success: false, error: "One valid payment attempt is required." }, { status: 400, headers });
    }
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return NextResponse.json({ success: false, error: "Sign in to view this payment." }, { status: 401, headers });
    const source = manualId ? "manual" : "payway";
    const saved = manualId
      ? await supabaseAdmin.from("manual_payment_requests")
        .select("id,business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,pricing_snapshot,approved_at,reviewed_at,created_at")
        .eq("id", manualId).maybeSingle()
      : await supabaseAdmin.from("billing_transactions")
        .select("id,business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,pricing_snapshot,provider_status,provider_status_code,provider_original_amount,provider_payment_amount,provider_payment_currency,verified_at,created_at,metadata")
        .eq("provider", "payway").eq("provider_transaction_id", transactionId ?? "").maybeSingle();
    if (saved.error) throw new Error("Payment lookup failed.");
    let payment = saved.data as Row | null;
    let prepared = false;
    if (!payment && manualId) {
      const upload = await supabaseAdmin.rpc("tenh_get_manual_payment_upload", { p_request_id: manualId });
      if (upload.error) throw new Error("Prepared payment lookup failed.");
      if (upload.data && typeof upload.data === "object" && !Array.isArray(upload.data)) {
        payment = upload.data as Row;
        prepared = true;
      }
    }
    if (!payment || (prepared && String(payment.id).toLowerCase() !== manualId?.toLowerCase()) ||
      (expectedBusiness && payment.business_id !== expectedBusiness)) {
      return NextResponse.json({ success: false, error: "Payment attempt was not found." }, { status: 404, headers });
    }
    let membershipQuery = supabaseAdmin.from("team_members").select("id,role")
      .eq("business_id", payment.business_id).eq("user_id", user.id).eq("is_active", true);
    if (prepared) membershipQuery = membershipQuery.eq("id", payment.requested_by_member_id);
    const membership = await membershipQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (membership.error) throw new Error("Payment access lookup failed.");
    if (!membership.data || (prepared && payment.requested_by_member_id !== membership.data.id) ||
      !(await memberHasPermission(membership.data, "billing", "manage"))) {
      return NextResponse.json({ success: false, error: "Payment attempt was not found." }, { status: 404, headers });
    }
    if (receipt) {
      if (prepared) return NextResponse.json({ success: false, error: "Receipt unavailable." }, { status: 404, headers });
      const proof = await supabaseAdmin.from("manual_payment_requests").select("proof_bucket,proof_path,proof_mime_type")
        .eq("id", manualId).eq("business_id", payment.business_id).maybeSingle();
      if (proof.error) throw new Error("Receipt lookup failed.");
      const savedProof = proof.data;
      if (!savedProof || savedProof.proof_bucket !== "tenh-manual-payment-proofs" ||
        typeof savedProof.proof_path !== "string" || !savedProof.proof_path.startsWith(`${payment.business_id}/`) ||
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(savedProof.proof_mime_type)) {
        return NextResponse.json({ success: false, error: "Receipt unavailable." }, { status: 404, headers });
      }
      const signed = await supabaseAdmin.storage.from(savedProof.proof_bucket).createSignedUrl(savedProof.proof_path, 60);
      if (signed.error || !signed.data?.signedUrl) throw new Error("Receipt preview unavailable.");
      return NextResponse.json({ success: true, receipt: { url: signed.data.signedUrl, mimeType: savedProof.proof_mime_type } }, { headers });
    }
    const cancellation = PAYMENT_CANCELLATION_ENABLED ? await supabaseAdmin.from("payment_cancellations").select("outcome")
      .eq("kind", source).eq("payment_id", manualId ?? transactionId).eq("business_id", payment.business_id).maybeSingle() : { data: null, error: null };
    if (cancellation.error) throw new Error("Cancellation status unavailable.");
    const references = await getCustomerPaymentReferences([{ source, paymentId: String(payment.id) }]);
    const customerReference = references.get(`${source}:${payment.id}`) ?? null;
    if (cancellation.data && ["processing", "reconciliation_required", "withdrawn"].includes(cancellation.data.outcome) && payment.status !== "approved") {
      const attempt = describePaymentAttempt({ source, payment: { ...payment, status: "recovery_required" }, invoice: null, subscription: null, businessName: null });
      return NextResponse.json({ success: true, attempt: { ...attempt, customerReference, ...(source === "payway" ? { serverTime } : {}) } }, { headers });
    }
    if (prepared) {
      const business = await supabaseAdmin.from("businesses").select("name").eq("id", payment.business_id).maybeSingle();
      if (business.error) throw new Error("Payment workspace lookup failed.");
      const attempt = describePaymentAttempt({ source, payment, invoice: null, subscription: null, businessName: business.data?.name ?? null });
      return NextResponse.json({ success: true, attempt: { ...attempt, customerReference } }, { headers });
    }
    const [document, subscription, business, recovery] = await Promise.all([
      supabaseAdmin.from("tenh_billing_invoices")
        .select("id,business_id,source_type,source_payment_id,source_transaction_id,provider,plan_code,billing_cycle,status,amount,currency,period_start,period_end,snapshot")
        .eq("business_id", payment.business_id).eq("source_type", source).eq("source_payment_id", payment.id).maybeSingle(),
      supabaseAdmin.from("business_subscriptions")
        .select("business_id,status,plan_code,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end,pricing_snapshot,updated_at")
        .eq("business_id", payment.business_id).maybeSingle(),
      supabaseAdmin.from("businesses").select("name").eq("id", payment.business_id).maybeSingle(),
      supabaseAdmin.rpc("tenh_get_billing_recovery_queue", { p_business_id: payment.business_id }),
    ]);
    if (document.error || subscription.error || business.error || recovery.error || !Array.isArray(recovery.data)) {
      throw new Error("Payment application lookup failed.");
    }
    const attempt = describePaymentAttempt({ source, payment, invoice: document.data as Row | null,
      subscription: subscription.data as Row | null, businessName: business.data?.name ?? null,
      recoveryEvents: recovery.data as Row[] });
    // Issued receipts retain the active-owner access policy used by billing history.
    if (membership.data.role !== "owner") attempt.invoiceId = null;
    return NextResponse.json({ success: true, attempt: { ...attempt, customerReference, ...(source === "payway" ? { serverTime } : {}) } }, { headers });
  } catch (error) {
    console.error("[TENH Payment] Unable to read saved attempt:", error);
    return NextResponse.json({ success: false, error: "Payment status is temporarily unavailable." }, { status: 503, headers });
  }
}
