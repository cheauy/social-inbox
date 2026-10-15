import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type AuthRateLimitAction = "login" | "signup" | "confirm" | "resend" |
  "recover" | "reset-password" | "password-update" | "recovery-email" |
  "oauth" | "admin-session-policy";

export type AuthRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  unavailable?: boolean;
};

function digest(value: string) {
  const secret = process.env.TENH_AUTH_RATE_LIMIT_SECRET ?? process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Auth rate limiter has no server secret.");
  return createHmac("sha256", secret).update("tenh-auth-rate-limit-v1\0").update(value).digest("hex");
}

function trustedIp(request: Request) {
  // Configure only a header overwritten by the deployment's trusted ingress.
  // Without an explicit trusted ingress, use a conservative shared IP bucket.
  const header = process.env.TENH_AUTH_TRUSTED_IP_HEADER;
  if (!header) return "unknown";
  const value = request.headers.get(header)?.split(",")[0]?.trim();
  return value && isIP(value) ? value.toLowerCase() : "unknown";
}

export async function consumeAuthRateLimit(
  request: Request,
  action: AuthRateLimitAction,
  identity?: string,
): Promise<AuthRateLimitResult> {
  try {
    const normalized = identity?.trim().toLowerCase();
    const { data, error } = await supabaseAdmin.rpc("tenh_consume_auth_rate_limit", {
      p_action: action,
      p_ip_hash: digest(`ip\0${trustedIp(request)}`),
      p_identity_hash: normalized ? digest(`identity\0${normalized}`) : null,
    });
    if (error || typeof data?.allowed !== "boolean" ||
        typeof data?.retry_after_seconds !== "number" ||
        !Number.isFinite(data.retry_after_seconds) || data.retry_after_seconds < 0) {
      return { allowed: false, retryAfterSeconds: 60, unavailable: true };
    }
    return { allowed: data.allowed, retryAfterSeconds: Math.ceil(data.retry_after_seconds) };
  } catch {
    return { allowed: false, retryAfterSeconds: 60, unavailable: true };
  }
}
