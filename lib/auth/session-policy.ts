import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SessionPolicyResult =
  | {
      allowed: true;
      sessionId: string;
      authenticatedAt: string;
      expiresAt: string | null;
      remembered: boolean | null;
      kind: "normal" | "recovery" | "legacy";
      recentAuthentication: boolean;
      recentMfa: boolean;
      aal: "aal1" | "aal2";
    }
  | { allowed: false; reason: string; status: 401 | 403 | 503 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_AUTH_SECONDS = 600;
const MFA_METHODS = new Set(["totp", "mfa/totp", "mfa/phone", "mfa/webauthn"]);

function authUnavailable(error: { status?: number; name?: string } | null) {
  return Boolean(error && (error.status === 429 || (error.status ?? 0) >= 500 ||
    error.name?.includes("Retryable") || error.name === "AuthUnknownError"));
}

async function verifiedSession(client: SupabaseClient, user: Pick<User, "id">) {
  const { data: { session }, error } = await client.auth.getSession();
  if (authUnavailable(error)) throw new Error("Session verification is temporarily unavailable.");
  if (error || !session) return null;
  // Verify this exact token, rather than trusting locally decoded cookie claims.
  // The unwrapped server client avoids getClaims' symmetric-key getUser fallback
  // recursively entering the application client's getUser policy wrapper.
  const { data, error: claimsError } = await supabaseAdmin.auth.getClaims(session.access_token);
  if (authUnavailable(claimsError)) throw new Error("Session verification is temporarily unavailable.");
  const claims = data?.claims;
  if (claimsError || !claims || claims.sub !== user.id ||
      typeof claims.session_id !== "string" || !UUID.test(claims.session_id)) return null;
  return { sessionId: claims.session_id, claims };
}

type PolicyRow = {
  status: string;
  authenticated_at?: string;
  expires_at?: string | null;
  remembered?: boolean | null;
  kind?: "normal" | "recovery" | "legacy";
  server_time?: string;
};

function policyResult(
  row: PolicyRow | null,
  verified: NonNullable<Awaited<ReturnType<typeof verifiedSession>>>,
  allowRecovery: boolean,
): SessionPolicyResult {
  if (!row || typeof row.status !== "string") {
    return { allowed: false, reason: "policy-unavailable", status: 503 };
  }
  if (row.status !== "allowed") {
    return { allowed: false, reason: row.status, status: row.status === "recovery" ? 403 : 401 };
  }
  if (!row.authenticated_at || !row.server_time ||
      !["normal", "recovery", "legacy"].includes(row.kind ?? "")) {
    return { allowed: false, reason: "policy-unavailable", status: 503 };
  }
  if (row.kind === "recovery" && !allowRecovery) {
    return { allowed: false, reason: "recovery", status: 403 };
  }
  const now = Date.parse(row.server_time) / 1000;
  const authenticated = Date.parse(row.authenticated_at) / 1000;
  if (!Number.isFinite(now) || !Number.isFinite(authenticated) ||
      (row.kind !== "legacy" && (typeof row.remembered !== "boolean" ||
        !row.expires_at || !Number.isFinite(Date.parse(row.expires_at))))) {
    return { allowed: false, reason: "policy-unavailable", status: 503 };
  }
  const aal = verified.claims.aal === "aal2" ? "aal2" : "aal1";
  const amr = Array.isArray(verified.claims.amr) ? verified.claims.amr : [];
  const recentMfa = aal === "aal2" && amr.some((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const method = entry as { method?: unknown; timestamp?: unknown };
    return typeof method.method === "string" && MFA_METHODS.has(method.method) && typeof method.timestamp === "number" &&
      method.timestamp <= now && method.timestamp >= now - RECENT_AUTH_SECONDS;
  });
  return {
    allowed: true,
    sessionId: verified.sessionId,
    authenticatedAt: row.authenticated_at,
    expiresAt: row.expires_at ?? null,
    remembered: row.remembered ?? null,
    kind: row.kind!,
    recentAuthentication: authenticated <= now && authenticated >= now - RECENT_AUTH_SECONDS,
    recentMfa,
    aal,
  };
}

/** The caller supplies a user established by a successful server Auth operation. */
export async function checkSessionPolicy(
  client: SupabaseClient,
  user: Pick<User, "id">,
  options: { allowRecovery?: boolean } = {},
): Promise<SessionPolicyResult> {
  try {
    const verified = await verifiedSession(client, user);
    if (!verified) return { allowed: false, reason: "invalid-session", status: 401 };
    const { data, error } = await supabaseAdmin.rpc("tenh_inspect_session_policy", {
      p_user_id: user.id, p_session_id: verified.sessionId,
    });
    if (error) return { allowed: false, reason: "policy-unavailable", status: 503 };
    return policyResult(data, verified, options.allowRecovery === true);
  } catch {
    return { allowed: false, reason: "policy-unavailable", status: 503 };
  }
}

/** Only call immediately after successful server-controlled password/OAuth/OTP authentication. */
export async function bindSessionPolicy(
  client: SupabaseClient,
  user: Pick<User, "id">,
  rememberMe: boolean,
  kind: "normal" | "recovery" = "normal",
): Promise<SessionPolicyResult> {
  try {
    const verified = await verifiedSession(client, user);
    if (!verified) return { allowed: false, reason: "invalid-session", status: 401 };
    const { data, error } = await supabaseAdmin.rpc("tenh_bind_session_policy", {
      p_user_id: user.id, p_session_id: verified.sessionId,
      p_remember_me: rememberMe, p_kind: kind,
    });
    if (error) return { allowed: false, reason: "policy-unavailable", status: 503 };
    return policyResult(data, verified, kind === "recovery");
  } catch {
    return { allowed: false, reason: "policy-unavailable", status: 503 };
  }
}

export async function revokeSessionPolicies(
  user: Pick<User, "id">,
  sessionId: string | null,
  options: { exceptSessionId?: string } = {},
): Promise<boolean> {
  if (!UUID.test(user.id) || (sessionId !== null && !UUID.test(sessionId)) ||
      (options.exceptSessionId && !UUID.test(options.exceptSessionId))) return false;
  try {
    const { data, error } = await supabaseAdmin.rpc("tenh_revoke_session_policies", {
      p_user_id: user.id, p_session_id: sessionId,
      p_except_session_id: options.exceptSessionId ?? null,
    });
    return !error && typeof data === "number" && data >= 0;
  } catch {
    return false;
  }
}
