/** Mock-only policy experiment. No credentials, URLs, QR SDK, or database access.
 * This module deliberately lives outside lib/app and has no runtime consumers.
 * Input is an adapter result from a server lookup, never a browser payment claim.
 */
export type MockIntent = Readonly<{
  id: string;
  businessId: string;
  environment: "mock";
  recipient: string;
  currency: "USD" | "KHR";
  amountMinor: number;
  qrMd5: string;
  expiresAtMs: number;
  baseline: string;
  state: "pending" | "approved" | "recovery_required" | "cancelled";
}>;

export type MockLookup = Readonly<{
  environment: "mock";
  requestedMd5: string;
  httpStatus: number;
  body: unknown;
}>;

export type Decision =
  | { state: "pending" | "recovery_required"; reason: string }
  | { state: "verified"; transactionHash: string }
  | { state: "already_approved" | "cancelled" };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Strict decimal conversion: no floating arithmetic, exponent, or rounding. */
export function amountToMinor(value: unknown, currency: "USD" | "KHR"): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const precision = currency === "USD" ? 2 : 0;
  if (/[^0]/.test(fraction.slice(precision))) return null;
  const minor = Number(whole + fraction.slice(0, precision).padEnd(precision, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function evaluateMockLookup(intent: MockIntent, lookup: MockLookup, nowMs: number): Decision {
  if (intent.state === "approved") return { state: "already_approved" };
  if (intent.state === "cancelled") return { state: "cancelled" };
  const recovery = (reason: string): Decision => ({ state: "recovery_required", reason });
  if (intent.state === "recovery_required") return recovery("EXISTING_REVIEW_HOLD");
  if (intent.environment !== "mock" || lookup.environment !== "mock") return recovery("ENVIRONMENT_UNCONFIRMED");
  if (!/^[a-f0-9]{32}$/.test(intent.qrMd5) || lookup.requestedMd5 !== intent.qrMd5) return recovery("LOOKUP_BINDING_MISMATCH");
  if (!Number.isSafeInteger(intent.amountMinor) || intent.amountMinor <= 0 ||
      !Number.isSafeInteger(intent.expiresAtMs) || !Number.isSafeInteger(nowMs)) return recovery("INVALID_INTENT");
  const expired = nowMs >= intent.expiresAtMs;
  const body = object(lookup.body);
  if (lookup.httpStatus !== 200 || !body) return {
    state: expired ? "recovery_required" : "pending", reason: "INQUIRY_UNAVAILABLE",
  };
  if (body.responseCode === 1 && body.errorCode === 1 && body.data === null) return {
    state: expired ? "recovery_required" : "pending", reason: expired ? "EXPIRED_UNRECONCILED" : "NOT_FOUND",
  };
  // Never map an unknown/failed response to cancellation or payment approval.
  if (body.responseCode !== 0 || (body.errorCode !== undefined && body.errorCode !== null)) return recovery("INQUIRY_NOT_VERIFIED");
  const data = object(body.data);
  if (!data || typeof data.hash !== "string" || !/^[a-f0-9]{64}$/.test(data.hash)) return recovery("TRANSACTION_HASH_MISSING");
  if (data.toAccountId !== intent.recipient) return recovery("RECIPIENT_MISMATCH");
  if (data.currency !== intent.currency) return recovery("CURRENCY_MISMATCH");
  if (amountToMinor(data.amount, intent.currency) !== intent.amountMinor) return recovery("AMOUNT_MISMATCH");
  // Legacy API examples contain no authoritative paid-at timestamp. A late
  // success remains recoverable, but cannot automatically change entitlements.
  if (expired) return recovery("LATE_SUCCESS_REQUIRES_RECONCILIATION");
  return { state: "verified", transactionHash: data.hash };
}
