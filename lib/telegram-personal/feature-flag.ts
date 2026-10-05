/**
 * Telegram Personal is off unless BOTH are set on the web app:
 *   TENH_TELEGRAM_PERSONAL_ENABLED=true
 *   TENH_TELEGRAM_PERSONAL_BUSINESS_IDS=<comma-separated workspace ids> | *
 * "*" opens self-service to every workspace once the feature is approved.
 */
export function isTelegramPersonalEnabled(
  env: Record<string, string | undefined>,
  businessId: string | null | undefined,
) {
  if (env.TENH_TELEGRAM_PERSONAL_ENABLED !== "true" || !businessId) return false;
  const allowed = (env.TENH_TELEGRAM_PERSONAL_BUSINESS_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes("*") || allowed.includes(businessId);
}

/** The worker's X25519 public key; without it no login input can be accepted. */
export function telegramPersonalSealPublicKey(env: Record<string, string | undefined>) {
  const value = env.TELEGRAM_PERSONAL_SEAL_PUBLIC_KEY?.trim();
  return value ? value : null;
}
