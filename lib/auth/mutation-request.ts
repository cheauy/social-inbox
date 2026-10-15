import "server-only";

/** Browser Auth mutations require an exact, server-configured origin and JSON. */
export function validateAuthMutationRequest(request: Request) {
  const forbidden = () => ({ success: false as const, status: 403 as const,
    code: "AUTH_REQUEST_ORIGIN", error: "This authentication request is not allowed." });
  try {
    const target = new URL(request.url);
    const configured = process.env.TENH_APP_ORIGIN?.trim() || process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
    const local = process.env.NODE_ENV !== "production" && !configured &&
      ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    const trusted = new URL(configured || (local ? target.origin : "https://app.tenhchat.com"));
    const supplied = request.headers.get("origin");
    if (trusted.username || trusted.password || trusted.pathname !== "/" || trusted.search || trusted.hash ||
      (trusted.protocol !== "https:" && !(local && trusted.protocol === "http:")) ||
      target.origin !== trusted.origin || supplied !== trusted.origin ||
      !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return forbidden();
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return forbidden();
  } catch { return forbidden(); }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return { success: false as const, status: 415 as const, code: "AUTH_REQUEST_CONTENT_TYPE",
      error: "Authentication requests require application/json." };
  }
  return { success: true as const };
}
