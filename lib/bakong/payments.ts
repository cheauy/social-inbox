import "server-only";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { getTrustedPlan, buildPurchaseRecord, type SubscriptionForQuote } from "@/lib/billing/subscription-purchase";
import { describePaymentAttempt } from "@/lib/billing/payment-attempt";
import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";
import { getBakongConfig } from "./config";
import { generateBakongQr, checkBakongTransaction } from "./provider";
import type { BakongPaymentView } from "./types";
import { decimalMinorUnits } from "./money";
import { getPendingBakongPayment } from "@/lib/billing/pending-bakong-payment";

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const BAKONG_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Origin" };
export type BakongAttempt = { id: string; business_id: string; user_id: string; member_id: string; intent_id: string;
  environment: "sandbox" | "production"; credential_fingerprint: string; recipient: string; amount: number | string;
  currency: "USD"; reference: string; qr: string; md5: string; expires_at: string; selection: Record<string, unknown>;
  state: BakongPaymentView["state"]; verified_hash: string | null; next_check_at: string; reason: string | null; check_count: number };
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

export async function bakongReadiness() {
  const config = getBakongConfig();
  if (!config || !config.checkoutRequested) return { enabled: false, environment: config?.environment ?? null };
  const capacity = await supabaseAdmin.rpc("tenh_bakong_capacity", { p_fingerprint: config.fingerprint,
    p_environment: config.environment, p_recipient: config.accountId, p_budget: config.dailyBudget });
  return { enabled: !capacity.error && capacity.data?.eligible === true && capacity.data?.canIssue === true, environment: config.environment };
}

export async function pendingBakong(businessId: string) {
  return getPendingBakongPayment(businessId);
}

export async function resumeBakongIntent(actor: BakongActor, intent: string | null) {
  if (intent === null) return null;
  if (!UUID.test(intent)) throw new BakongError(400, "INVALID_PURCHASE_INTENT");
  const saved = await supabaseAdmin.from("bakong_payment_attempts").select("id").eq("business_id", actor.businessId)
    .eq("user_id", actor.userId).eq("intent_id", intent).maybeSingle();
  if (saved.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  return saved.data?.id as string | null;
}

export async function prepareBakongPayment(actor: BakongActor, body: Record<string, unknown>) {
  const intent = typeof body.purchaseIntent === "string" ? body.purchaseIntent : "";
  if (!UUID.test(intent)) throw new BakongError(400, "PURCHASE_INTENT_REQUIRED");
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  if ([body.renewSame, body.customUpgrade].some(v => v !== undefined && typeof v !== "boolean") ||
      [body.connections, body.users].some(v => v !== undefined && v !== null && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1))) throw new BakongError(400, "INVALID_SELECTION");
  const selection = { planCode: text(body.planCode), billingCycle: text(body.billingCycle), connections: body.connections ?? null,
    users: body.users ?? null, renewSame: body.renewSame === true, customUpgrade: body.customUpgrade === true,
    extensionBillingCycle: text(body.extensionBillingCycle) || "none" };
  const saved = await supabaseAdmin.from("bakong_payment_attempts").select("*").eq("business_id", actor.businessId)
    .eq("user_id", actor.userId).eq("intent_id", intent).maybeSingle();
  if (saved.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
  if (saved.data) {
    if (Object.keys(selection).some(key => JSON.stringify(saved.data.selection?.[key]) !== JSON.stringify(selection[key as keyof typeof selection]))) throw new BakongError(400, "PURCHASE_INTENT_CHANGED");
    return saved.data as BakongAttempt;
  }
  const pending = await pendingBakong(actor.businessId);
  if (pending) return loadBakongAttempt(pending, actor.businessId);
  const config = getBakongConfig();
  if (!config || !(await bakongReadiness()).enabled) throw new BakongError(503, "BAKONG_NOT_ENABLED");
  if (selection.renewSame && !actor.owner) throw new BakongError(403, "OWNER_REQUIRED");
  if (selection.renewSame && selection.customUpgrade) throw new BakongError(400, "INVALID_SELECTION");
  await syncBusinessSubscriptionLifecycle(actor.businessId);
  const current = await supabaseAdmin.from("business_subscriptions").select("*").eq("business_id", actor.businessId).maybeSingle();
  if (current.error || !current.data) throw new BakongError(503, "SUBSCRIPTION_UNAVAILABLE");
  const subscription = current.data as SubscriptionForQuote;
  if (subscription.status === "suspended") throw new BakongError(403, "SUBSCRIPTION_SUSPENDED");
  const trusted = getTrustedPlan(selection.planCode, selection.billingCycle, selection.connections, selection.users,
    selection.renewSame, selection.customUpgrade, selection.extensionBillingCycle, subscription);
  if (!trusted) throw new BakongError(400, "INVALID_QUOTE");
  const id = randomUUID(), qr = generateBakongQr(config, id, trusted.quote.totalCents);
  const record = buildPurchaseRecord(id, actor.businessId, actor.memberId, trusted, subscription);
  const result = await supabaseAdmin.rpc("tenh_prepare_bakong_payment", { p_record: record, p_actor: actor.userId,
    p_member: actor.memberId, p_intent: intent, p_selection: selection, p_environment: config.environment,
    p_fingerprint: config.fingerprint, p_recipient: config.accountId, p_qr: qr.qr, p_md5: qr.md5,
    p_reference: qr.reference, p_expires_at: qr.expiresAt, p_budget: config.dailyBudget });
  if (result.error || !result.data) {
    // A committed/lost preparation or another tab is reconciled before another QR can be displayed.
    const recovered = await pendingBakong(actor.businessId);
    if (recovered) return loadBakongAttempt(recovered, actor.businessId);
    throw new BakongError(result.error?.code === "23505" ? 409 : 503, result.error?.code === "23505" ? "TENH_BILLING_PURCHASE_PENDING" : "PREPARATION_UNCERTAIN");
  }
  return result.data as BakongAttempt;
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

export async function bakongPaymentView(attempt: BakongAttempt, actor: Pick<BakongActor, "userId" | "memberId" | "owner">): Promise<BakongPaymentView> {
  const [billing, business] = await Promise.all([
    supabaseAdmin.from("billing_transactions").select("*").eq("id", attempt.id).eq("business_id", attempt.business_id).eq("provider", "bakong").maybeSingle(),
    supabaseAdmin.from("businesses").select("name").eq("id", attempt.business_id).maybeSingle(),
  ]);
  if (billing.error || !billing.data || business.error) throw new BakongError(503, "PAYMENT_UNAVAILABLE");
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
  let showQr = false;
  const config = getBakongConfig();
  if (attempt.state === "pending" && config?.checkoutRequested && config.environment === attempt.environment && config.accountId === attempt.recipient) {
    const capacity = await supabaseAdmin.rpc("tenh_bakong_capacity", { p_fingerprint: config.fingerprint, p_environment: config.environment,
      p_recipient: config.accountId, p_budget: config.dailyBudget });
    showQr = !capacity.error && capacity.data?.eligible === true && capacity.data?.canVerify === true;
  }
  return { id: attempt.id, businessId: attempt.business_id, userId: actor.userId, memberId: actor.memberId,
    workspaceName: business.data?.name ?? "TENH workspace", planCode: billing.data.plan_code, billingCycle: billing.data.billing_cycle,
    amount: `${minor.slice(0, -2)}.${minor.slice(-2)}`, currency: attempt.currency, reference: attempt.reference, transactionReference: attempt.verified_hash,
    environment: attempt.environment, state: attempt.state, application, invoiceId,
    qrImage: showQr && Date.parse(attempt.expires_at) > Date.now() ? await QRCode.toDataURL(attempt.qr, { width: 280, margin: 2 }) : null,
    expiresAt: attempt.expires_at, nextCheckAt: attempt.next_check_at, serverTime: new Date().toISOString(),
    automaticChecksRemaining: Math.max(0, 3 - attempt.check_count),
    canCheck: attempt.state === "pending" || attempt.state === "verified" || (attempt.state === "review" && !attempt.verified_hash) };
}
