import { Buffer } from "buffer";

// Match @supabase/ssr's base64url session cookie and 3180-character chunks.
// The existing backend validates the JWT; this is transport, not authorization.
export function sessionCookie(name: string, session: unknown, workspaceId?: string | null) {
  const encoded = "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const chunks = encoded.length <= 3180 ? [`${name}=${encoded}`] : Array.from({ length: Math.ceil(encoded.length / 3180) }, (_, i) => `${name}.${i}=${encoded.slice(i * 3180, (i + 1) * 3180)}`);
  if (workspaceId) chunks.push(`tenh_active_business_id=${encodeURIComponent(workspaceId)}`);
  return chunks.join("; ");
}
