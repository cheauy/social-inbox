import "server-only";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { describePaymentAttempt } from "@/lib/billing/payment-attempt";
import { getCustomerPaymentReferences } from "@/lib/billing/customer-payment-references";
import { getBakongConfig } from "./config";
import { checkBakongTransaction } from "./provider";
import type { BakongPaymentView } from "./types";
import { decimalMinorUnits } from "./money";
import { getPendingBakongPayment } from "@/lib/billing/pending-bakong-payment";
import { KHQR_CHECKOUT_ENABLED } from "@/lib/billing/payment-cancellation-feature";

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const BAKONG_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Origin" };
export type BakongAttempt = { id: string; business_id: string; user_id: string; member_id: string; intent_id: string;
  environment: "sandbox" | "production"; credential_fingerprint: string; recipient: string; amount: number | string;
  currency: "USD"; reference: string; qr: string; md5: string; created_at: string; expires_at: string; selection: Record<string, unknown>;
  state: BakongPaymentView["state"]; verified_hash: string | null; next_check_at: string; reason: string | null; check_count: number;
  pilot_authorization_id?: string | null };
export class BakongError extends Error { constructor(public status: number, public code: string) { super(code); } }
export const bakongJson = (body: unknown, status = 200) => Response.json(body, { status, headers: BAKONG_HEADERS });
export function bakongFailure(error: unknown) {
  const status = error instanceof BakongError ? error.status : error instanceof SyntaxError ? 400 : 503;
  return bakongJson({ success: false, error: status === 404 ? "Payment unavailable." : status === 401 ? "Please sign in." :
    status === 403 ? "You cannot manage this payment." : status === 400 ? "Check your payment selection." : "Payment is temporarily unavailable. Try again.",
    code: error instanceof BakongError ? error.code : "BAKONG_UNAVAILABLE" }, status);
}

export async function bakongActor(businessId: string) {
  if (!UUID.test(businessId)) throw new BakongError(400, "WORKSPACE_REQUIRED");
  const auth = await (await createClient()).auth.getUser();
  if (auth.error || !auth.data.user) throw new BakongError((auth.error?.status ?? 0) >= 500 ? 503 : 401, "AUTH_REQUIRED");
  const member = await supabaseAdmin.from("team_members").select("id,user_id,business_id,role,is_active")
    .eq("business_id", businessId).eq("user_id", auth.data.user.id).eq("is_active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (member.error) throw new BakongError(503, "MEMBERSHIP_UNAVAILABLE");
  if (!member.data || !(await memberHasPermission(member.data, "billing", "manage"))) throw new BakongError(403, "BILLING_FORBIDDEN");
  return { userId: auth.data.user.id, memberId: member.data.id as string, businessId, owner: member.data.role === "owner" };
}
export type BakongActor = Awaited<ReturnType<typeof bakongActor>>;

export async function loadBakongAttempt(id: string, businessId: string) {
  if (!UUID.test(id)) throw new BakongError(404, "PAYMENT_NOT_FOUND");
  const result = await supabaseAdmin.from("bakong_payment_attempts").select("*").eq("id", id).eq("business_id", businessId).maybeSingle();
  if (result.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  if (!result.data) throw new BakongError(404, "PAYMENT_NOT_FOUND");
  return result.data as BakongAttempt;
}

async function pilotStatus(config: NonNullable<ReturnType<typeof getBakongConfig>>, actor: Pick<BakongActor, "userId" | "memberId" | "businessId">, attemptId: string | null = null) {
  const result = await supabaseAdmin.rpc("tenh_bakong_pilot_status", { p_actor: actor.userId, p_business: actor.businessId,
    p_member: actor.memberId, p_fingerprint: config.fingerprint, p_recipient: config.accountId, p_attempt: attemptId });
  return result.error ? null : result.data as { eligible: boolean; canIssue: boolean; canVerify: boolean; inquiriesRemaining: number; pilot: boolean } | null;
}

/** Direct Bakong checkout is retired; configuration remains available for saved-payment reconciliation. */
export async function bakongReadiness() {
  return { enabled: false, retired: true, environment: getBakongConfig()?.environment ?? null };
}

export async function pendingBakong(businessId: string) {
  return getPendingBakongPayment(businessId);
}

/** Checkout lifecycle only. Settlement is tracked separately by state and verified_hash. */
export async function bakongCheckout(attempt: Pick<BakongAttempt, "id" | "business_id" | "expires_at">): Promise<BakongPaymentView["checkout"]> {
  if (!KHQR_CHECKOUT_ENABLED) return Date.parse(attempt.expires_at) > Date.now() ? "open" : "expired";
  const closed = await supabaseAdmin.from("payment_cancellations").select("outcome").eq("kind", "bakong")
    .eq("payment_id", attempt.id).eq("business_id", attempt.business_id).maybeSingle();
  if (closed.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  if (closed.data) return "cancelled";
  return Date.parse(attempt.expires_at) > Date.now() ? "open" : "expired";
}
const unpaid = (attempt: Pick<BakongAttempt, "state" | "verified_hash">) => attempt.state === "pending" && !attempt.verified_hash;

/** A closed unpaid checkout is never resumed; the browser must start a new purchase intent. */
export async function resumeBakongIntent(actor: BakongActor, intent: string | null) {
  if (intent === null) return { attemptId: null, closed: false };
  if (!UUID.test(intent)) throw new BakongError(400, "INVALID_PURCHASE_INTENT");
  const saved = await supabaseAdmin.from("bakong_payment_attempts").select("id,business_id,expires_at,state,verified_hash").eq("business_id", actor.businessId)
    .eq("user_id", actor.userId).eq("intent_id", intent).maybeSingle();
  if (saved.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  if (!saved.data) return { attemptId: null, closed: false };
  const closed = KHQR_CHECKOUT_ENABLED && unpaid(saved.data) && await bakongCheckout(saved.data) !== "open";
  return { attemptId: closed ? null : saved.data.id as string, closed };
}

export async function checkBakongPayment(attempt: BakongAttempt, actorUserId: string): Promise<BakongAttempt> {
  if (attempt.state === "verified") {
    const result = await supabaseAdmin.rpc("tenh_apply_bakong_payment", { p_attempt: attempt.id, p_actor: actorUserId });
    if (result.error || !result.data) throw new BakongError(503, "ACTIVATION_UNCERTAIN");
    return result.data as BakongAttempt;
  }
  if (attempt.verified_hash || attempt.state === "applied" || attempt.state === "test_paid") return attempt;
  const config = getBakongConfig();
  if (!config || config.environment !== attempt.environment || config.accountId !== attempt.recipient) throw new BakongError(503, "RECONCILIATION_CONFIGURATION_REQUIRED");
  // Revocation/expiry and the lifetime inquiry cap are enforced again by the database claim.
  if (attempt.pilot_authorization_id && !config.pilotRequested) throw new BakongError(503, "BAKONG_NOT_ENABLED");
  const claim = await supabaseAdmin.rpc("tenh_claim_bakong_check", { p_attempt: attempt.id, p_fingerprint: config.fingerprint, p_budget: config.dailyBudget });
  if (claim.error || !claim.data) throw new BakongError(503, "CHECK_UNAVAILABLE");
  if (!claim.data.claimed) {
    const current = await loadBakongAttempt(attempt.id, attempt.business_id);
    return { ...current, next_check_at: claim.data.nextCheckAt ?? current.next_check_at };
  }
  const observation = await checkBakongTransaction(config, { md5: attempt.md5, recipient: attempt.recipient,
    amount: String(attempt.amount), environment: attempt.environment });
  const saved = await supabaseAdmin.rpc("tenh_complete_bakong_check", { p_attempt: attempt.id, p_claim: claim.data.claimId,
    p_observation: observation, p_actor: actorUserId });
  if (saved.error || !saved.data) throw new BakongError(503, "VERIFICATION_UNCERTAIN");
  const result = saved.data as BakongAttempt;
  return result.state === "verified" ? checkBakongPayment(result, actorUserId) : result;
}

export async function bakongInquiryStatus(attempt: BakongAttempt, actor?: Pick<BakongActor, "userId" | "memberId">) {
  const unavailable = { canCheck: false, inquiriesRemaining: 0, reconciliationRequired: true,
    reason: "RECONCILIATION_CONFIGURATION_REQUIRED", nextCheckAt: attempt.next_check_at };
  if (attempt.state === "verified") return { ...unavailable, canCheck: true, reconciliationRequired: false, reason: null };
  if (attempt.state === "applied" || attempt.state === "test_paid") return { ...unavailable, reconciliationRequired: false, reason: null };
  const config = getBakongConfig();
  if (!config || config.environment !== attempt.environment || config.accountId !== attempt.recipient ||
    (attempt.pilot_authorization_id && !config.pilotRequested)) return unavailable;
  const result = await supabaseAdmin.rpc("tenh_bakong_inquiry_status", { p_attempt: attempt.id,
    p_fingerprint: config.fingerprint, p_budget: config.dailyBudget });
  if (result.error || !result.data) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  // Keep the original pilot's named owner scope in customer views; billing admins use their separate route.
  if (attempt.pilot_authorization_id && actor && (await pilotStatus(config, { ...actor, businessId: attempt.business_id }, attempt.id))?.eligible !== true) {
    return { ...unavailable, reason: "PILOT_AUTHORIZATION_REVIEW" };
  }
  return result.data as { canCheck: boolean; inquiriesRemaining: number; reconciliationRequired: boolean;
    reason: string | null; nextCheckAt?: string };
}

export async function bakongPaymentView(attempt: BakongAttempt, actor: Pick<BakongActor, "userId" | "memberId" | "owner">): Promise<BakongPaymentView> {
  const [billing, business, checkout] = await Promise.all([
    supabaseAdmin.from("billing_transactions").select("*").eq("id", attempt.id).eq("business_id", attempt.business_id).eq("provider", "bakong").maybeSingle(),
    supabaseAdmin.from("businesses").select("name").eq("id", attempt.business_id).maybeSingle(),
    bakongCheckout(attempt),
  ]);
  if (billing.error || !billing.data || business.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  const references = await getCustomerPaymentReferences([{ source: "bakong", paymentId: attempt.id }]);
  let application: BakongPaymentView["application"] = "none", invoiceId: string | null = null;
  if (attempt.state === "applied") {
    const [invoice, subscription] = await Promise.all([
      supabaseAdmin.from("tenh_billing_invoices").select("*").eq("business_id", attempt.business_id)
        .eq("source_type", "bakong").eq("source_payment_id", attempt.id).eq("status", "paid").maybeSingle(),
      supabaseAdmin.from("business_subscriptions").select("*").eq("business_id", attempt.business_id).maybeSingle(),
    ]);
    if (invoice.error || subscription.error) throw new BakongError(503, "APPLICATION_UNAVAILABLE");
    const described = describePaymentAttempt({ source: "bakong", payment: billing.data, invoice: invoice.data,
      subscription: subscription.data, businessName: business.data?.name ?? null });
    application = described.application === "active" || described.application === "historical" ? described.application : "review";
    if (actor.owner) invoiceId = described.invoiceId;
  }
  const minor = decimalMinorUnits(attempt.amount, "USD")?.toString().padStart(3, "0");
  if (!minor) throw new BakongError(503, "INVALID_SAVED_AMOUNT");
  const config = getBakongConfig();
  const inquiry = await bakongInquiryStatus(attempt, actor);
  // A closed checkout hides its QR. Unpaid closure is not reconciliation; received funds still are.
  const closed = unpaid(attempt) && checkout !== "open";
  const showQr = !closed && attempt.state === "pending" && inquiry.canCheck &&
    (attempt.pilot_authorization_id ? config?.pilotRequested : config?.checkoutRequested);
  return { id: attempt.id, businessId: attempt.business_id, userId: actor.userId, memberId: actor.memberId,
    workspaceName: business.data?.name ?? "TENH workspace", planCode: billing.data.plan_code, billingCycle: billing.data.billing_cycle,
    recipientName: config?.environment === attempt.environment && config.accountId === attempt.recipient ? config.merchantName : null,
    amount: `${minor.slice(0, -2)}.${minor.slice(-2)}`, currency: attempt.currency, reference: attempt.reference, transactionReference: attempt.verified_hash,
    customerReference: references.get(`bakong:${attempt.id}`) ?? null,
    environment: attempt.environment, state: attempt.state, application, invoiceId,
    qrImage: showQr ? await QRCode.toDataURL(attempt.qr, { width: 280, margin: 2 }) : null, checkout,
    createdAt: attempt.created_at, expiresAt: attempt.expires_at, nextCheckAt: inquiry.nextCheckAt ?? attempt.next_check_at, serverTime: new Date().toISOString(),
    automaticChecksRemaining: inquiry.inquiriesRemaining, reconciliationRequired: !closed && inquiry.reconciliationRequired,
    reconciliationReason: closed ? null : inquiry.reason, canCheck: inquiry.canCheck };
}
