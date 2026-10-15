import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function key() {
  const secret = process.env.TENH_AUTH_COOKIE_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Authentication cookie signing is not configured.");
  return secret;
}
export function signAuthTicket(value: Record<string, unknown>, purpose: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", key()).update(`tenh-chat:${purpose}:${payload}`).digest("base64url")}`;
}
export function verifyAuthTicket(value: string | undefined, purpose: string): Record<string, unknown> | null {
  try {
    if (!value || value.length > 6000) return null;
    const [payload, mac, extra] = value.split(".");
    if (!payload || !mac || extra) return null;
    const expected = createHmac("sha256", key()).update(`tenh-chat:${purpose}:${payload}`).digest();
    const actual = Buffer.from(mac, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
