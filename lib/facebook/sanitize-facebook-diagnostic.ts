import "server-only";

const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:access_?token|token|secret|client_?secret|app_?secret|authorization|password|appsecret_?proof|signed_?request)(?:$|_)/i;

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  "input_token",
  "appsecret_proof",
  "client_secret",
  "app_secret",
  "token",
  "authorization",
  "signed_request",
]);

function redactSensitiveQueryParams(text: string) {
  if (!text) {
    return text;
  }

  let output = text;

  try {
    const parsed = new URL(text);
    let changed = false;

    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }

    if (changed) {
      output = parsed.toString();
    }
  } catch {
    // It may be a partial URL or a normal string. Regex fallback below.
  }

  output = output.replace(
    /([?&](?:access_token|input_token|appsecret_proof|client_secret|app_secret|token|authorization|signed_request)=)[^&#\s"']+/gi,
    "$1[redacted]",
  );

  output = output.replace(
    /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/gi,
    "Bearer [redacted]",
  );

  return output;
}

function sanitizeString(value: string) {
  const redacted = redactSensitiveQueryParams(value);

  if (/^https?:\/\//i.test(redacted)) {
    return redacted.length > 500
      ? `${redacted.slice(0, 497)}...`
      : redacted;
  }

  return redacted.length > 180
    ? `[text:${redacted.length} chars]`
    : redacted;
}

export function sanitizeFacebookDiagnosticValue(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 7) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 25)
      .map((item) =>
        sanitizeFacebookDiagnosticValue(
          item,
          depth + 1,
        ),
      );
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      return sanitizeString(value);
    }

    return value;
  }

  const output: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[redacted]";
      continue;
    }

    output[key] = sanitizeFacebookDiagnosticValue(
      nested,
      depth + 1,
    );
  }

  return output;
}

export function sanitizeFacebookDiagnosticUrl(
  value: string,
) {
  return redactSensitiveQueryParams(value);
}
