// PayWay Purchase accepts a signed lifetime in minutes (minimum 3).
export const PAYWAY_CHECKOUT_LIFETIME_MINUTES = 10;

export function createPayWayCheckoutLifetime(now = Date.now()) {
  // Match the precision of the signed UTC req_time. This is TENH's checkout
  // window; closing it never changes the saved financial outcome.
  const started = Math.floor(now / 1000) * 1000;
  return {
    checkout_lifetime_version: 1,
    checkout_lifetime_minutes: PAYWAY_CHECKOUT_LIFETIME_MINUTES,
    checkout_started_at: new Date(started).toISOString(),
    checkout_expires_at: new Date(started + PAYWAY_CHECKOUT_LIFETIME_MINUTES * 60_000).toISOString(),
  };
}

export function payWayCheckoutExpiresAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const saved = metadata as Record<string, unknown>;
  if (saved.checkout_lifetime_version !== 1 || !Number.isSafeInteger(saved.checkout_lifetime_minutes) ||
      Number(saved.checkout_lifetime_minutes) < 3 || Number(saved.checkout_lifetime_minutes) > 43_200 ||
      typeof saved.checkout_started_at !== "string" || typeof saved.checkout_expires_at !== "string") return null;
  const start = Date.parse(saved.checkout_started_at), end = Date.parse(saved.checkout_expires_at);
  return Number.isFinite(start) && Number.isFinite(end) && end - start === Number(saved.checkout_lifetime_minutes) * 60_000
    ? new Date(end).toISOString() : null;
}
