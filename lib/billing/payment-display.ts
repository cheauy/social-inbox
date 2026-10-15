export type PaymentEnvironment = "sandbox" | "production" | "manual" | "unknown";
export type PaymentProvider = "payway" | "bakong" | "manual" | "unknown";
export type PaymentProvenance = {
  provider: PaymentProvider; environment: PaymentEnvironment; providerVerified: boolean; confirmedPaid: boolean;
};
export type BillingHistoryItem = PaymentProvenance & {
  id: string; sourceId: string; source: "payway" | "bakong" | "manual"; businessId: string; workspaceName: string;
  transactionId: string | null; paymentMethod: string; planCode: string; billingCycle: string;
  amount: number | null; currency: string | null; status: string; providerStatus: string | null;
  approvalCode: string | null; reviewNote: string | null; createdAt: string;
  paidAt: string | null; reviewedAt: string | null; periodStart: string | null; periodEnd: string | null;
  invoiceId: string | null; invoiceNumber: string | null;
};
export type BillingHistorySummary = {
  total: number; approved: number; pending: number; attention: number; approvedUsdTotal: number;
  testUsdTotal: number; unverifiedUsdTotal: number; receipts: number;
};
export type InvoiceRecord = PaymentProvenance & {
  id: string; invoiceNumber: string; sourceType: string; sourcePaymentId: string;
  transactionId: string | null; workspaceName: string; customerName: string | null; billingEmail: string | null;
  planCode: string; planName: string | null; billingCycle: string; billingCycleLabel: string;
  amount: number | null; currency: string | null; paymentMethod: string; approvalCode: string | null;
  status: string; paidAt: string | null; periodStart: string | null; periodEnd: string | null;
  issuedAt: string | null; createdAt: string | null;
};

export function billingNumber(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
export function billingCurrency(value: unknown) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null;
}
export function billingDate(value: unknown): string | null {
  return typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value)) ? value : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function has(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function positiveCents(value: unknown): number | null {
  if (typeof value === "string" && !/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const amount = billingNumber(value);
  if (amount === null || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) && Math.abs(amount - cents / 100) < Number.EPSILON * Math.max(1, amount) ? cents : null;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Read saved evidence only. Never return the provider payload to a browser.
export function paymentProvenance(source: string, payment: Record<string, unknown> | null, invoice?: Record<string, unknown> | null): PaymentProvenance {
  const unknown: PaymentProvenance = { provider: "unknown", environment: "unknown", providerVerified: false, confirmedPaid: false };
  if (!payment || (source !== "manual" && source !== "payway" && source !== "bakong")) return unknown;
  if ((source !== "manual" && payment.provider !== source) ||
    (source === "manual" && has(payment, "provider") && payment.provider !== "manual")) return unknown;
  const approved = payment.status === "approved";
  const amount = billingNumber(payment.amount), currency = billingCurrency(payment.currency);
  const cents = positiveCents(payment.amount);
  const identityMatches = nonempty(payment.id) && nonempty(payment.business_id) &&
    (source === "manual" || nonempty(payment.provider_transaction_id)) && (!invoice || (
    invoice.source_type === source && invoice.provider === source && invoice.source_payment_id === payment.id &&
    invoice.business_id === payment.business_id && billingNumber(invoice.amount) === amount && billingCurrency(invoice.currency) === currency &&
    (source === "manual" || (nonempty(payment.provider_transaction_id) && invoice.source_transaction_id === payment.provider_transaction_id)) &&
    (!approved || invoice.status === "paid")
  ));
  if (!identityMatches) return unknown;
  const metadata = record(payment.metadata), snapshot = record(invoice?.snapshot);
  const snapshotMetadata = record(snapshot.metadata);
  if ((invoice && has(invoice, "snapshot") && invoice.snapshot !== snapshot) ||
    (has(snapshot, "metadata") && snapshot.metadata !== snapshotMetadata) ||
    [snapshot, snapshotMetadata].some((saved) => (
      (has(saved, "provider") && saved.provider !== source) || (has(saved, "source_type") && saved.source_type !== source) ||
      (has(saved, "source_payment_id") && saved.source_payment_id !== payment.id) ||
      (has(saved, "business_id") && saved.business_id !== payment.business_id)
    ))) return unknown;
  if (source === "manual" && [snapshot, snapshotMetadata].some((saved) =>
    (has(saved, "environment") && saved.environment !== "manual") || has(saved, "live_enabled"))) return unknown;
  if (source === "manual") return {
    provider: "manual", environment: "manual", providerVerified: false,
    confirmedPaid: approved && cents !== null && currency !== null,
  };
  if (source === "bakong") {
    const evidence = record(metadata.bakong_verification);
    const environment: PaymentEnvironment = metadata.environment === "production" || metadata.environment === "sandbox" ? metadata.environment : "unknown";
    const valid = environment !== "unknown" && evidence.environment === environment &&
      metadata.live_enabled === (environment === "production") && evidence.currency === currency && currency === "USD" &&
      positiveCents(evidence.amount) === cents && cents !== null && typeof evidence.recipient === "string" && evidence.recipient.length > 0 &&
      typeof evidence.hash === "string" && /^[a-f0-9]{64}$/.test(evidence.hash) &&
      typeof evidence.md5 === "string" && /^[a-f0-9]{32}$/.test(evidence.md5) &&
      [snapshot, snapshotMetadata].every(saved => (!has(saved, "environment") || saved.environment === environment) &&
        (!has(saved, "live_enabled") || saved.live_enabled === (environment === "production")));
    return { provider: "bakong", environment: valid ? environment : "unknown", providerVerified: valid,
      confirmedPaid: approved && valid && environment === "production" };
  }
  let environment: PaymentEnvironment = metadata.environment === "sandbox" || metadata.environment === "production" ? metadata.environment : "unknown";
  const environmentConflict = (has(metadata, "live_enabled") && (
    typeof metadata.live_enabled !== "boolean" || metadata.live_enabled !== (environment === "production")
  )) || [snapshot, snapshotMetadata].some((saved) => (
    (has(saved, "environment") && saved.environment !== environment) ||
    (has(saved, "live_enabled") && (typeof saved.live_enabled !== "boolean" || saved.live_enabled !== (environment === "production")))
  ));
  const snapshotConflict = ["provider_status", "provider_status_code"].some((key) => has(snapshot, key) && snapshot[key] !== payment[key]) ||
    (has(snapshot, "provider_original_amount") && positiveCents(snapshot.provider_original_amount) !== cents) ||
    (has(snapshot, "provider_payment_amount") && billingNumber(snapshot.provider_payment_amount) !== billingNumber(payment.provider_payment_amount)) ||
    (has(snapshot, "provider_payment_currency") && snapshot.provider_payment_currency !== payment.provider_payment_currency);
  const payload = record(metadata.payway_verified_payload), gateway = record(payload.status), data = record(payload.data);
  const payloadValid = metadata.payway_verified_payload === payload && payload.status === gateway && payload.data === data &&
    gateway.code === "00" && gateway.tran_id === payment.provider_transaction_id &&
    data.payment_status === "APPROVED" && (data.payment_status_code === 0 || data.payment_status_code === "0") &&
    positiveCents(data.original_amount) === cents &&
    (!has(data, "original_currency") || data.original_currency === currency) &&
    (!has(data, "transaction_id") || data.transaction_id === payment.provider_transaction_id) &&
    (!has(data, "payment_amount") || billingNumber(data.payment_amount) === billingNumber(payment.provider_payment_amount)) &&
    (!has(data, "payment_currency") || data.payment_currency === payment.provider_payment_currency);
  const payloadConflict = has(metadata, "payway_verified_payload") && !payloadValid;
  const observation = record(metadata.payway_last_verification);
  const verifiedAt = billingDate(payment.verified_at), checkedAt = billingDate(observation.checked_at);
  const observationConflicts = has(metadata, "payway_last_verification") &&
    (!checkedAt || !verifiedAt || Date.parse(checkedAt) >= Date.parse(verifiedAt)) && (
    metadata.payway_last_verification !== observation ||
    observation.provider_status_code !== "00" || observation.payment_status !== "APPROVED" ||
    (observation.payment_status_code !== 0 && observation.payment_status_code !== "0") ||
    observation.provider_transaction_id !== payment.provider_transaction_id ||
    positiveCents(observation.original_amount) !== cents || Boolean(observation.conflict_reason)
  );
  const evidenceConflict = environmentConflict || snapshotConflict || payloadConflict || (approved && observationConflicts);
  if (evidenceConflict) environment = "unknown";
  // Older approvals retain the activation columns even when the raw provider payload was not saved.
  const providerVerified = approved && !evidenceConflict && Boolean(verifiedAt) && currency === "USD" && cents !== null &&
    nonempty(payment.provider_transaction_id) && positiveCents(payment.provider_original_amount) === cents &&
    payment.provider_status === "APPROVED" && String(payment.provider_status_code) === "0" &&
    (!has(metadata, "payway_verified_payload") || payloadValid);
  return { provider: "payway", environment, providerVerified,
    confirmedPaid: approved && providerVerified && environment === "production" };
}

export function paymentStatusLabel(payment: Pick<PaymentProvenance, "environment" | "confirmedPaid"> & { status: string; providerVerified?: boolean }, khmer = false) {
  const t = (en: string, km: string) => khmer ? km : en;
  switch (payment.status) {
    case "approved": return payment.environment === "sandbox" ? t("Test payment", "ការទូទាត់សាកល្បង") : payment.confirmedPaid ? t("Paid", "បានបង់ប្រាក់") : t("Approved · unverified", "បានអនុម័ត · មិនទាន់ផ្ទៀងផ្ទាត់");
    case "submitted": case "pending": return t("Payment pending.", "កំពុងរង់ចាំការទូទាត់។");
    case "draft": return t("Draft", "សេចក្ដីព្រាង");
    case "declined": return t("Declined", "ត្រូវបានបដិសេធ");
    case "rejected": return t("Rejected", "ត្រូវបានច្រានចោល");
    case "failed": return t("Failed", "បានបរាជ័យ");
    case "canceled": case "cancelled": return t("Cancelled", "បានលុបចោល");
    case "test_paid": return t("Test payment confirmed", "បានបញ្ជាក់ការទូទាត់សាកល្បង");
    case "verified": return payment.providerVerified && payment.environment === "production" ? t("Payment received", "បានទទួលការទូទាត់") : t("Needs review", "ត្រូវការពិនិត្យ");
    case "recovery_required": return t("Needs review", "ត្រូវការពិនិត្យ");
    default: return t("Unknown status", "មិនស្គាល់ស្ថានភាព");
  }
}
export function paymentEnvironmentLabel(environment: PaymentEnvironment, khmer = false) {
  const labels = { sandbox: ["Test payment", "ការទូទាត់សាកល្បង"], production: ["Production", "ការទូទាត់ពិត"], manual: ["Manual transfer", "ផ្ទេរប្រាក់ដោយដៃ"], unknown: ["Unverified", "មិនទាន់ផ្ទៀងផ្ទាត់"] };
  return (labels[environment] ?? labels.unknown)[khmer ? 1 : 0];
}
export function paymentMethodLabel(provider: PaymentProvider, khmer = false) {
  return provider === "bakong" ? "Bakong KHQR" : provider === "payway" ? "ABA PayWay" : provider === "manual" ? (khmer ? "ផ្ទេរប្រាក់ដោយដៃ" : "Manual transfer") : (khmer ? "មិនស្គាល់វិធីទូទាត់" : "Unknown method");
}
export function paymentVerificationLabel(payment: PaymentProvenance & { status: string }, khmer = false) {
  if (payment.status !== "approved") return paymentStatusLabel(payment, khmer);
  if (payment.environment === "sandbox") return khmer ? "ការសាកល្បងប៉ុណ្ណោះ · មិនមែនការទូទាត់ប្រាក់ពិត" : "Test only · no real-money settlement";
  if (payment.provider === "payway" && payment.providerVerified && payment.environment === "production") return khmer ? "បានផ្ទៀងផ្ទាត់ដោយ PayWay" : "Verified by PayWay";
  if (payment.provider === "bakong" && payment.providerVerified && payment.environment === "production") return khmer ? "បានផ្ទៀងផ្ទាត់ការទូទាត់ Bakong" : "Bakong payment verified";
  if (payment.provider === "manual" && payment.confirmedPaid) return khmer ? "បានអនុម័តដោយ TENH" : "Approved by TENH";
  return khmer ? "មិនទាន់ផ្ទៀងផ្ទាត់ការទូទាត់" : "Payment unverified";
}
export function formatBillingMoney(amount: number | null, currency: string | null, khmer = false) {
  if (amount === null || !Number.isFinite(amount) || !currency) return "—";
  try { return new Intl.NumberFormat(khmer ? "km-KH" : "en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount); }
  catch { return "—"; }
}
export function formatBillingDate(value: string | null, withTime = false, khmer = false) {
  if (!billingDate(value)) return "—";
  return new Intl.DateTimeFormat(khmer ? "km-KH" : "en-US", { year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(new Date(value!));
}
