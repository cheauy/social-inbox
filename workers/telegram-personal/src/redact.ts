/*
 * Every log line from the worker goes through here. Diagnostics carry session
 * ids, states and error codes only; never QR links, codes, passwords, phone
 * numbers, keys, message text or raw TDLib objects.
 */

const SENSITIVE_KEY =
  /token|secret|password|passwd|hash|key|code_value|^code$|phone|link|sealed|text|caption|hint|first_name|last_name|username|name$/i;

const SAFE_KEYS = new Set(["errorCode", "error_code", "code", "status", "event", "sessionId", "businessId", "workerId", "epoch", "reason", "state", "level", "count", "durationMs"]);

export function maskPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return digits ? "•••" : null;
  return `+${digits.slice(0, 3)} •••• ${digits.slice(-3)}`;
}

export function redactString(value: string): string {
  return value
    .replace(/tg:\/\/login\?token=[A-Za-z0-9_\-=%]+/g, "tg://login?token=[redacted]")
    .replace(/\b(v1|s1)\.[A-Za-z0-9_\-]{16,}/g, "$1.[redacted]")
    .replace(/\+?\d[\d\s\-]{6,}\d/g, "[number]");
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") return redactString(value).slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name, message: redactString(value.message).slice(0, 200) };
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!SAFE_KEYS.has(key) && SENSITIVE_KEY.test(key)) {
        out[key] = item == null ? item : "[redacted]";
      } else {
        out[key] = redact(item, depth + 1);
      }
    }
    return out;
  }
  return String(typeof value);
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

export function createLogger(write: (line: string) => void = (line) => process.stdout.write(line + "\n")): Logger {
  return (level, event, fields) => {
    write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields ?? {}) as object) }));
  };
}
