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
