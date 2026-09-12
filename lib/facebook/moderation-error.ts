/** Safe diagnostics: never return Page tokens, raw response bodies or headers. */
export function facebookModerationFailure(value: unknown, secrets: string[] = []) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = typeof raw.code === "number" ? raw.code : null;
  const subcode = typeof raw.error_subcode === "number" ? raw.error_subcode : null;
  const category = code === 190 || code === 102 ? "token"
    : code === 10 || code === 200 ? "permission"
    : [4, 17, 32, 613].includes(code ?? -1) ? "rate_limit"
    : code === 100 ? "request" : "provider_rejected";
  let message = typeof raw.message === "string" ? raw.message : "Meta returned no confirmation of the requested action.";
  for (const secret of secrets) if (secret) message = message.split(secret).join("[redacted]");
  message = message.replace(/(?:access_token|token)\s*[=:]\s*[^\s&"']+/gi, "token=[redacted]")
    .replace(/\bEA[A-Za-z0-9]{35,}\b/g, "[redacted]").replace(/[\u0000-\u001f]/g, " ").slice(0, 600);
  const help: Record<string, string> = {
    token: "Reconnect this Facebook Page in TENH; the Page authorization is invalid or expired.",
    permission: "The Page authorization does not permit this action. Check the app's approved permissions and the connecting person's Page access, then reconnect the Page.",
    rate_limit: "Meta is limiting requests. Wait before trying again.",
    request: "Meta rejected the request or the Page/customer identifiers. Check this Page connection and the customer's Page-scoped ID.",
    provider_rejected: "Meta did not confirm the change. The details below identify its response; this is not necessarily a missing permission.",
  };
  return { error: help[category], providerCategory: category, providerCode: code,
    providerSubcode: subcode, providerMessage: message,
    providerTraceId: typeof raw.fbtrace_id === "string" && /^[\w-]{1,160}$/.test(raw.fbtrace_id) ? raw.fbtrace_id : null };
}
