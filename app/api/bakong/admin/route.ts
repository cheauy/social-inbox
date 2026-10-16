import { getBillingAdminUser } from "@/lib/billing/require-billing-admin";
import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { KHQR_CHECKOUT_ENABLED } from "@/lib/billing/payment-cancellation-feature";
import { requireKhqrCheckoutSchema } from "@/lib/billing/require-khqr-checkout-schema";
import { bakongFailure, bakongJson, bakongInquiryStatus, checkBakongPayment, UUID, type BakongAttempt } from "@/lib/bakong/payments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const admin = await getBillingAdminUser();
  if (!admin.success) return bakongJson({ success: false, error: admin.error }, admin.status);
  try {
    const cursor = new URL(request.url).searchParams.get("before");
    let query = supabaseAdmin.from("bakong_payment_attempts")
      .select("*")
      .in("state", ["pending", "verified", "review"]).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(51);
    if (cursor) {
      if (!/^[A-Za-z0-9_-]{1,300}$/.test(cursor)) return bakongJson({ success: false }, 400);
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (!UUID.test(value.id) || typeof value.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) return bakongJson({ success: false }, 400);
      query = query.or(`created_at.lt.${value.createdAt},and(created_at.eq.${value.createdAt},id.lt.${value.id})`);
    }
    const result = await query;
    if (result.error) throw new Error();
    const rows = (result.data ?? []).slice(0, 50);
    const ids = [...new Set(rows.map(row => row.business_id))];
    const businesses = ids.length ? await supabaseAdmin.from("businesses").select("id,name").in("id", ids) : { data: [], error: null };
    if (businesses.error) throw new Error();
    const names = new Map((businesses.data ?? []).map(row => [row.id, row.name]));
    const last = rows.at(-1);
    const inquiries = await Promise.all(rows.map(row => bakongInquiryStatus(row as BakongAttempt)));
    const reviewIds = KHQR_CHECKOUT_ENABLED ? rows.filter(row => row.environment === "production" && row.state === "review" && row.verified_hash &&
      ["CANCELLATION_PAYMENT_REVIEW", "LATE_PAYMENT_REVIEW"].includes(row.reason)).map(row => row.id) : [];
    let reviews: Record<string, { canApplyOriginal: boolean; reason: string | null }> = {};
    if (reviewIds.length) {
      const preview = await supabaseAdmin.rpc("tenh_bakong_original_plan_preview", { p_attempts: reviewIds });
      if (preview.error || !preview.data) throw new Error();
      reviews = preview.data;
    }
    return bakongJson({ success: true, items: rows.map((row, index) => ({ id: row.id, businessId: row.business_id,
      workspaceName: names.get(row.business_id) ?? "TENH workspace", amount: String(row.amount), currency: row.currency,
      environment: row.environment, state: row.state, reference: row.reference, transactionReference: row.verified_hash,
      reason: inquiries[index].reason ?? row.reason, canCheck: inquiries[index].canCheck,
      inquiriesRemaining: inquiries[index].inquiriesRemaining, reconciliationRequired: inquiries[index].reconciliationRequired,
      planCode: row.selection?.planCode ?? null, billingCycle: row.selection?.billingCycle ?? null,
      canApplyOriginal: reviews[row.id]?.canApplyOriginal === true, resolutionConflict: reviews[row.id]?.reason ?? null,
      createdAt: row.created_at })),
      nextCursor: (result.data?.length ?? 0) > 50 && last ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.created_at })).toString("base64url") : null });
  } catch (error) { return bakongFailure(error); }
}
export async function POST(request: Request) {
  const validation = validateAuthMutationRequest(request);
  if (!validation.success) return bakongJson(validation, validation.status);
  const admin = await getBillingAdminUser();
  if (!admin.success) return bakongJson({ success: false, error: admin.error }, admin.status);
  try {
    const body = await request.json();
    if (body?.action === "apply_original_plan") {
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => !["attemptId", "action", "requestId", "reason", "expectedTransactionReference", "confirmed"].includes(key)) ||
        !UUID.test(body.attemptId) || !UUID.test(body.requestId) || body.confirmed !== true ||
        typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 500 ||
        typeof body.expectedTransactionReference !== "string" || !/^[a-f0-9]{64}$/.test(body.expectedTransactionReference)) return bakongJson({ success: false }, 400);
      if (!KHQR_CHECKOUT_ENABLED) return bakongJson({ success: false, code: "RESOLUTION_UNAVAILABLE",
        error: "Original-plan resolution is not enabled. The saved payment remains available for review." }, 503);
      await requireKhqrCheckoutSchema();
      const resolution = await supabaseAdmin.rpc("tenh_apply_reviewed_bakong_original_plan", {
        p_attempt: body.attemptId, p_actor: admin.user.id, p_request: body.requestId,
        p_reason: body.reason.trim(), p_expected_hash: body.expectedTransactionReference,
      });
      if (resolution.error?.code === "22023") return bakongJson({ success: false, outcome: "conflict", code: "REVIEWED_IDENTITY_CHANGED",
        error: "The reviewed payment or request identity changed. Refresh saved status and review it again." }, 409);
      if (resolution.error || !resolution.data) return bakongJson({ success: false, code: "RESOLUTION_UNCERTAIN",
        error: "The resolution result is not confirmed. Retry the same request or refresh saved status before taking another action." }, 503);
      const saved = resolution.data;
      return bakongJson({ success: saved.outcome === "applied", outcome: saved.outcome, code: saved.reason,
        resolutionId: saved.resolutionId, invoiceId: saved.invoiceId, businessId: saved.businessId,
        ...(saved.outcome === "applied" ? {} : { error: "The payment stays in review. Resolve the reported conflict before applying any plan." }) }, saved.outcome === "applied" ? 200 : 409);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["attemptId", "action"].includes(key)) ||
      !UUID.test(body.attemptId) || body.action !== "reconcile") return bakongJson({ success: false }, 400);
    const result = await supabaseAdmin.from("bakong_payment_attempts").select("*").eq("id", body.attemptId).maybeSingle();
    if (result.error) throw new Error();
    if (!result.data) return bakongJson({ success: false, error: "Payment unavailable." }, 404);
    if (result.data.state === "review" && result.data.verified_hash) {
      return bakongJson({ success: false, code: "SETTLEMENT_REVIEW_REQUIRED", requiresOperatorResolution: true,
        error: "Confirmed funds need operator review. Reconcile cannot resolve this case or change the current plan." }, 409);
    }
    const saved = await checkBakongPayment(result.data as BakongAttempt, admin.user.id);
    return bakongJson({ success: true, id: saved.id, state: saved.state, reason: saved.reason });
  } catch (error) { return bakongFailure(error); }
}
