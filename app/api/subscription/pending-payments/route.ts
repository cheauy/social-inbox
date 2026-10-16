import { hasPermission, resolvePermissions } from "@/lib/auth/permissions";
import { billingCurrency, billingNumber } from "@/lib/billing/payment-display";
import type { SubscriptionPendingPayment } from "@/lib/billing/subscription-pending-payments";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { KHQR_CHECKOUT_ENABLED, PAYMENT_CANCELLATION_ENABLED } from "@/lib/billing/payment-cancellation-feature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : "";
const paymentColumns = "id,business_id,plan_code,billing_cycle,amount,currency,status";

// This read never signs proof URLs, verifies a provider transaction or changes purchase state.
export async function GET() {
  try {
    const auth = await (await createClient()).auth.getUser();
    if (auth.error || !auth.data.user) {
      return Response.json({ success: false }, { status: (auth.error?.status ?? 0) >= 500 ? 503 : 401, headers });
    }
    const memberships = await supabaseAdmin.from("team_members").select("id,business_id,role,permissions")
      .eq("user_id", auth.data.user.id).eq("is_active", true).order("created_at", { ascending: false });
    if (memberships.error) throw new Error("Membership lookup failed");
    const members = new Map<string, NonNullable<typeof memberships.data>[number]>();
    for (const member of memberships.data ?? []) if (!members.has(member.business_id)) members.set(member.business_id, member);
    for (const [id, member] of members) {
      if (!hasPermission(resolvePermissions(member.role, member.permissions), "billing", "manage")) members.delete(id);
    }
    const items = new Map<string, SubscriptionPendingPayment>();
    if (members.size) {
      const businesses = [...members.keys()];
      const cancellationKinds = [...(KHQR_CHECKOUT_ENABLED ? ["bakong"] : []), ...(PAYMENT_CANCELLATION_ENABLED ? ["payway", "manual"] : [])];
      const [manual, uploads, billing, bakong, cancellations] = await Promise.all([
        supabaseAdmin.from("manual_payment_requests").select(paymentColumns).in("business_id", businesses)
          .in("status", ["draft", "pending", "submitted", "cancelled"]),
        supabaseAdmin.from("manual_payment_uploads").select("id,business_id,member_id,request_payload")
          .in("business_id", businesses).in("member_id", [...members.values()].map(member => member.id)).eq("state", "prepared"),
        supabaseAdmin.from("billing_transactions").select(`${paymentColumns},provider,provider_transaction_id`)
          .in("business_id", businesses).in("provider", ["payway", "bakong"]).in("status", ["draft", "pending", "submitted", "cancelled"]),
        supabaseAdmin.from("bakong_payment_attempts").select("id,business_id,expires_at,state,verified_hash")
          .in("business_id", businesses).in("state", ["pending", "review", "verified"]),
        cancellationKinds.length ? supabaseAdmin.from("payment_cancellations").select("kind,payment_id,outcome").in("business_id", businesses).in("kind", cancellationKinds) : { data: [], error: null },
      ]);
      if ([manual, uploads, billing, bakong, cancellations].some(result => result.error)) throw new Error("Payment lookup failed");
      const cancelled = new Map((cancellations.data ?? []).map(row => [`${row.kind}:${row.payment_id}`, row.outcome]));
      const now = Date.now();
      function add(kind: SubscriptionPendingPayment["kind"], row: Row, status: SubscriptionPendingPayment["status"], expiresAt: string | null = null) {
        const businessId = text(row.business_id), member = members.get(businessId);
        const id = text(kind === "payway" ? row.provider_transaction_id : row.id);
        if (!member || !id) return;
        const outcome = cancelled.get(`${kind}:${id}`);
        if (["cancelled", "paid"].includes(outcome ?? "")) return;
        // A closed unpaid KHQR checkout is hidden; its evidence stays in Billing history and admin review.
        // Funds received after closing are already in review and stay visible.
        if (outcome === "checkout_closed" && status === "pending") return;
        if (outcome && outcome !== "checkout_closed") status = "reconciliation_required";
        // Expiry is a display boundary, not a payment result or a cancellation.
        if (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt))) return;
        const key = `${kind}:${businessId}:${id}`;
        if (items.has(key)) return;
        const query = new URLSearchParams({ [kind === "bakong" ? "bakong_attempt" : kind === "manual" ? "manual_request" : "tran_id"]: id, purchase_business: businessId });
        items.set(key, { kind, id, businessId, memberId: member.id, planCode: text(row.plan_code), billingCycle: text(row.billing_cycle),
          amount: billingNumber(row.amount), currency: billingCurrency(row.currency), status, expiresAt,
          resumeUrl: `/dashboard/subscription/payment?${query}` });
      }
      // A committed manual request always takes precedence over its original upload ticket.
      for (const row of manual.data ?? []) {
        if (row.status !== "cancelled" || cancelled.get(`manual:${row.id}`) === "withdrawn") add("manual", row,
          row.status === "submitted" ? "submitted" : row.status === "cancelled" ? "reconciliation_required" : "pending");
      }
      for (const row of uploads.data ?? []) {
        if (members.get(row.business_id)?.id !== row.member_id) continue;
        const payload = row.request_payload && typeof row.request_payload === "object" && !Array.isArray(row.request_payload) ? row.request_payload as Row : {};
        add("manual", { ...payload, id: row.id, business_id: row.business_id }, "pending");
      }
      const qrAttempts = new Map((bakong.data ?? []).map(row => [row.id, row]));
      for (const row of billing.data ?? []) {
        if (row.status === "cancelled" && cancelled.get(`${row.provider}:${row.provider_transaction_id}`) !== "reconciliation_required") continue;
        if (row.provider === "payway") {
          // PayWay's provider lifetime is not a persisted expires_at; do not manufacture one.
          add("payway", row, "pending");
        } else {
          const qr = qrAttempts.get(row.id);
          if (!qr || qr.business_id !== row.business_id || typeof qr.expires_at !== "string") continue;
          // Hide only the expired unpaid checkout; received or disputed funds remain visible for review.
          if (qr.state === "pending" && !qr.verified_hash && !(Date.parse(qr.expires_at) > now)) continue;
          add("bakong", row, qr.state === "pending" ? "pending" : "reconciliation_required", qr.state === "pending" ? qr.expires_at : null);
        }
      }
    }
    return Response.json({ success: true, userId: auth.data.user.id, serverTime: new Date().toISOString(), items: [...items.values()] }, { headers });
  } catch {
    return Response.json({ success: false, error: "Unable to load payments. Try again." }, { status: 503, headers });
  }
}
