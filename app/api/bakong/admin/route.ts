import { getBillingAdminUser } from "@/lib/billing/require-billing-admin";
import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { supabaseAdmin } from "@/lib/supabase/admin";
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
    return bakongJson({ success: true, items: rows.map((row, index) => ({ id: row.id, businessId: row.business_id,
      workspaceName: names.get(row.business_id) ?? "TENH workspace", amount: String(row.amount), currency: row.currency,
      environment: row.environment, state: row.state, reference: row.reference, transactionReference: row.verified_hash,
      reason: inquiries[index].reason ?? row.reason, canCheck: inquiries[index].canCheck,
      inquiriesRemaining: inquiries[index].inquiriesRemaining, reconciliationRequired: inquiries[index].reconciliationRequired,
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
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["attemptId", "action"].includes(key)) ||
      !UUID.test(body.attemptId) || body.action !== "reconcile") return bakongJson({ success: false }, 400);
    const result = await supabaseAdmin.from("bakong_payment_attempts").select("*").eq("id", body.attemptId).maybeSingle();
    if (result.error) throw new Error();
    if (!result.data) return bakongJson({ success: false, error: "Payment unavailable." }, 404);
    const saved = await checkBakongPayment(result.data as BakongAttempt, admin.user.id);
    return bakongJson({ success: true, id: saved.id, state: saved.state, reason: saved.reason });
  } catch (error) { return bakongFailure(error); }
}
