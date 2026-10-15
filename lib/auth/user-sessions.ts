import "server-only";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkSessionPolicy, revokeSessionPolicies } from "@/lib/auth/session-policy";
import {
  parseUserAgent,
  type DeviceType,
} from "@/lib/auth/parse-user-agent";

export type UserSession = {
  id: string;
  isCurrent: boolean;
  browser: string;
  operatingSystem: string;
  deviceType: DeviceType;
  label: string;
  ip: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  expiresAt: string | null;
  isElevated: boolean;
};

export type UserSessionsResult =
  | {
      success: true;
      /** Compatibility flag; an unavailable policy-aware helper now fails closed. */
      supported: boolean;
      currentSessionId: string | null;
      sessions: UserSession[];
    }
  | {
      success: false;
      status: number;
      error: string;
    };

type SessionRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
};

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeIp(value: string | null) {
  const ip = value?.trim();

  if (!ip || ip === "0.0.0.0" || ip === "::1" || ip === "127.0.0.1") {
    return null;
  }

  return ip;
}

export async function listUserSessions(): Promise<UserSessionsResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      success: false,
      status: 401,
      error: "Your session has expired. Please sign in again.",
    };
  }

  const policy = await checkSessionPolicy(supabase, user);
  if (!policy.allowed) return { success: false, status: policy.status, error: "Please sign in again before viewing active sessions." };
  const currentSessionId = policy.sessionId;
  const { data, error } = await supabaseAdmin.rpc("tenh_list_effective_user_sessions", {
    p_user_id: user.id, p_current_session_id: currentSessionId,
  });

  if (error || !Array.isArray(data)) {
    return {
      success: false,
      status: 503,
      error: "Unable to load your active sessions.",
    };
  }

  const rows = (data ?? []) as SessionRow[];

  const sessions: UserSession[] = rows.map((row) => {
    const parsed = parseUserAgent(row.user_agent);

    return {
      id: row.id,
      isCurrent: Boolean(
        currentSessionId && row.id === currentSessionId,
      ),
      browser: parsed.browser,
      operatingSystem: parsed.operatingSystem,
      deviceType: parsed.deviceType,
      label: parsed.label,
      ip: normalizeIp(row.ip),
      createdAt: row.created_at,
      lastActiveAt:
        row.refreshed_at ?? row.updated_at ?? row.created_at,
      expiresAt: row.not_after,
      isElevated: row.aal === "aal2",
    };
  });

  // Current device always sits at the top of the list.
  sessions.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }

    const aTime = a.lastActiveAt
      ? new Date(a.lastActiveAt).getTime()
      : 0;

    const bTime = b.lastActiveAt
      ? new Date(b.lastActiveAt).getTime()
      : 0;

    return bTime - aTime;
  });

  return {
    success: true,
    supported: true,
    currentSessionId,
    sessions,
  };
}

export type RevokeResult =
  | { success: true; revoked: number }
  | { success: false; status: number; error: string };

export async function revokeOtherSessions(): Promise<RevokeResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      success: false,
      status: 401,
      error: "Your session has expired. Please sign in again.",
    };
  }

  const policy = await checkSessionPolicy(supabase, user);
  if (!policy.allowed) return { success: false, status: policy.status, error: "Please sign in again before revoking sessions." };
  const ledgerRevoked = await revokeSessionPolicies(user, null, { exceptSessionId: policy.sessionId });

  // scope: "others" revokes every session except the one making the
  // request, so the current browser stays signed in.
  let providerRevoked = false;
  try { providerRevoked = !(await supabase.auth.signOut({ scope: "others" })).error; } catch { /* Report uncertainty below. */ }

  if (!ledgerRevoked || !providerRevoked) {
    return {
      success: false,
      status: 502,
      error: ledgerRevoked ? "Other sessions are blocked in TENH, but provider sign-out could not be confirmed. Retry sign-out."
        : "Provider and TENH session revocation could not both be confirmed. Retry sign-out.",
    };
  }

  return { success: true, revoked: -1 };
}

export async function revokeSession(
  sessionId: string,
): Promise<RevokeResult> {
  if (!SESSION_ID.test(sessionId)) return { success: false, status: 400, error: "A valid session identifier is required." };
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      success: false,
      status: 401,
      error: "Your session has expired. Please sign in again.",
    };
  }

  const policy = await checkSessionPolicy(supabase, user);
  if (!policy.allowed) return { success: false, status: policy.status, error: "Please sign in again before revoking sessions." };
  const currentSessionId = policy.sessionId;

  if (currentSessionId && sessionId === currentSessionId) {
    return {
      success: false,
      status: 400,
      error:
        "That is this device. Use the sign out button in your profile menu instead.",
    };
  }

  const ledgerRevoked = await revokeSessionPolicies(user, sessionId);
  let data: unknown;
  let providerError = false;
  try {
    const result = await supabase.rpc("tenh_revoke_user_session", { target_session_id: sessionId });
    data = result.data;
    providerError = Boolean(result.error);
  } catch { providerError = true; }

  if (providerError || !ledgerRevoked) {
    return {
      success: false,
      status: 502,
      error: ledgerRevoked ? "That session is blocked in TENH, but provider sign-out could not be confirmed. Retry sign-out."
        : "Provider and TENH session revocation could not both be confirmed. Retry sign-out.",
    };
  }

  if (data !== true) {
    return {
      success: false,
      status: 404,
      error: "That session is already signed out.",
    };
  }

  return { success: true, revoked: 1 };
}
