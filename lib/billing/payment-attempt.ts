import { billingCurrency, billingDate, billingNumber, paymentProvenance, type PaymentEnvironment } from "./payment-display";
import { payWayCheckoutExpiresAt, payWayCheckoutSessionClosedAt } from "@/lib/payway/checkout-lifetime";

type Row = Record<string, unknown>;
export type PaymentAttempt = {
  customerReference?: string | null;
  kind: "manual" | "payway" | "bakong"; id: string; businessId: string; businessName: string;
  planCode: string; billingCycle: string; amount: number | null; currency: string | null;
  reference: string | null; status: string; environment: PaymentEnvironment; invoiceId: string | null;
  application: "active" | "scheduled" | "pending" | "review" | "historical" | null;
  effectiveAt: string | null; reason: string | null; canRetry: false;
  checkoutExpiresAt?: string | null; serverTime?: string;
  checkoutSessionClosedAt?: string | null;
  upload?: { fileName: string; mimeType: string; sizeBytes: number };
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const sameDate = (left: unknown, right: unknown) => Boolean(billingDate(left) && billingDate(right) && Date.parse(String(left)) === Date.parse(String(right)));

/** Describe one saved attempt; never infer its result from another purchase or mutate billing. */
export function describePaymentAttempt({ source, payment, invoice, subscription, businessName, recoveryEvents = [], now = Date.now() }: {
  source: "manual" | "payway" | "bakong"; payment: Row; invoice: Row | null; subscription: Row | null;
  businessName: string | null; recoveryEvents?: Row[]; now?: number;
}): PaymentAttempt {
  const provenance = paymentProvenance(source, payment, invoice);
  const status = text(payment.status) ?? "unknown";
  const reference = source !== "manual" ? text(payment.provider_transaction_id) : text(invoice?.source_transaction_id);
  const approvedAt = billingDate(source !== "manual" ? payment.verified_at : payment.approved_at);
  const recovery = recoveryEvents.some(event => event.kind === "recovery_required" && event.source_type === source &&
    event.source_payment_id === payment.id && event.business_id === payment.business_id &&
    (!approvedAt || !billingDate(event.occurred_at) || Date.parse(String(event.occurred_at)) >= Date.parse(approvedAt)));
  const documentMatches = Boolean(invoice && invoice.source_type === source && invoice.provider === source &&
    invoice.business_id === payment.business_id && invoice.source_payment_id === payment.id && invoice.status === "paid" &&
    billingNumber(invoice.amount) === billingNumber(payment.amount) && billingCurrency(invoice.currency) === billingCurrency(payment.currency) &&
    invoice.plan_code === payment.plan_code && invoice.billing_cycle === payment.billing_cycle &&
    (source === "manual" || invoice.source_transaction_id === payment.provider_transaction_id));
  const attempt: PaymentAttempt = {
    kind: source, id: String(source === "payway" ? payment.provider_transaction_id : payment.id),
    businessId: String(payment.business_id), businessName: businessName ?? "TENH workspace",
    planCode: text(payment.plan_code) ?? "unknown", billingCycle: text(payment.billing_cycle) ?? "unknown",
    amount: billingNumber(payment.amount), currency: billingCurrency(payment.currency), reference,
    status: recovery ? "recovery_required" : status, environment: provenance.environment,
    invoiceId: documentMatches ? text(invoice?.id) : null, application: null,
    effectiveAt: null, reason: null, canRetry: false,
    ...(source === "payway" ? { checkoutExpiresAt: payWayCheckoutExpiresAt(payment.metadata), checkoutSessionClosedAt: payWayCheckoutSessionClosedAt(payment.metadata), serverTime: new Date(now).toISOString() } : {}),
  };
  const fileName = text(payment.file_name), mimeType = text(payment.mime_type), sizeBytes = billingNumber(payment.size_bytes);
  if (source === "manual" && status === "prepared" && fileName && mimeType && sizeBytes !== null && Number.isSafeInteger(sizeBytes) && sizeBytes > 0) {
    attempt.upload = { fileName, mimeType, sizeBytes };
  }
  if (recovery) return { ...attempt, application: "review", reason: "payment_requires_review" };
  if (["draft", "pending", "submitted", "processing"].includes(status)) return { ...attempt, application: "pending" };
  if (status === "recovery_required") return { ...attempt, application: "review", reason: "payment_requires_review" };
  if (status !== "approved") return attempt;
  if (!(source === "manual" ? provenance.confirmedPaid : provenance.providerVerified && provenance.environment !== "unknown")) {
    return { ...attempt, application: "review", reason: "payment_evidence_unverified" };
  }
  const start = billingDate(invoice?.period_start), end = billingDate(invoice?.period_end);
  if (!documentMatches || !start || !end || Date.parse(start) >= Date.parse(end)) {
    return { ...attempt, application: "review", reason: "application_evidence_missing" };
  }
  // CHAT has no durable paid scheduling contract; future dates alone do not prove one.
  if (Date.parse(start) > now) return { ...attempt, application: "review", reason: "application_evidence_missing" };
  if (Date.parse(end) <= now) return { ...attempt, application: "historical", reason: "saved_payment_is_historical" };
  const quote = record(payment.pricing_snapshot), currentQuote = record(subscription?.pricing_snapshot);
  const sameCustomActivation = quote.purchase_type === "custom-upgrade" &&
    sameDate(approvedAt, subscription?.updated_at) && sameDate(quote.quoted_at, currentQuote.quoted_at) &&
    sameDate(quote.new_period_end, end);
  const capacityMatches = ["member_limit", "channel_limit"].every(key => {
    const expected = billingNumber(payment[`target_${key}`]);
    return expected !== null && expected > 0 && expected === billingNumber(subscription?.[key]);
  });
  const currentMatches = subscription !== null && subscription.business_id === payment.business_id && subscription.status === "active" &&
    subscription.plan_code === payment.plan_code && subscription.billing_cycle === payment.billing_cycle && capacityMatches &&
    sameDate(subscription.current_period_end, end) && (sameDate(subscription.current_period_start, start) || sameCustomActivation);
  if (!currentMatches) return { ...attempt, application: "historical", reason: "saved_payment_is_historical" };
  return { ...attempt, application: "active", effectiveAt: start };
}
