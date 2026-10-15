export const SESSION_HINT_COOKIE = "tenh_session_hint";
export type SessionCookieHint = { remembered: boolean; expiresAt: string; sessionId: string };

// This browser-readable signed hint controls persistence only; the database authorizes every session.
export function readSessionCookieHint(value: string | undefined): SessionCookieHint | null {
  try {
    if (!value) return null;
    const encoded = value.split(".")[0];
    const json = typeof window === "undefined" ? Buffer.from(encoded, "base64url").toString("utf8")
      : atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const hint = JSON.parse(json);
    return typeof hint.remembered === "boolean" && typeof hint.sessionId === "string" &&
      typeof hint.expiresAt === "string" && Number.isFinite(Date.parse(hint.expiresAt)) ? hint : null;
  } catch { return null; }
}

export function sessionCookiePersistence(hint: SessionCookieHint | null) {
  return hint?.remembered ? { expires: new Date(hint.expiresAt) } : {};
}

export function isSupabaseAuthCookie(name: string) {
  return /^sb-.+-(?:auth-token|code-verifier)(?:[.\w-]*)?$/.test(name);
}

export function isProjectAuthCookie(name: string, supabaseUrl: string | undefined) {
  try {
    const base = `sb-${new URL(supabaseUrl ?? "").hostname.split(".")[0]}`;
    const prefix = `${base}-auth-token`;
    return name === prefix || name.startsWith(`${prefix}.`) || name === `${prefix}-code-verifier` || name.startsWith(`${prefix}-code-verifier.`) || name === `${base}-code-verifier` || name.startsWith(`${base}-code-verifier.`);
  } catch { return false; }
}
