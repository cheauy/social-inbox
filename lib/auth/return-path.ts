export const AUTH_RETURN_FALLBACK = "/dashboard/inbox";

/** Only application destinations, with no authentication loops or URL-parser ambiguities. */
export function safeAuthReturnPath(value: unknown, origin = "https://tenh.invalid") {
  if (typeof value !== "string" || !value || value.length > 2048 || value !== value.trim()) return AUTH_RETURN_FALLBACK;
  let decoded = value;
  try {
    for (let pass = 0; pass < 5; pass++) {
      if (/[\u0000-\u0020\u007f-\u009f\\]/.test(decoded) || !decoded.startsWith("/") || decoded.startsWith("//")) return AUTH_RETURN_FALLBACK;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (pass === 4) return AUTH_RETURN_FALLBACK;
    }
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin || url.pathname.includes("%") ||
        !(url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/") || url.pathname === "/invite/accept")) return AUTH_RETURN_FALLBACK;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return AUTH_RETURN_FALLBACK; }
}
