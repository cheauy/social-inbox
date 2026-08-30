import "server-only";

import { createClient } from "@/lib/supabase/server";
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
      /**
       * False when the SQL helper has not been installed yet.
       * The UI degrades to "current device only" instead of erroring.
       */
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

/**
 * Supabase puts the session id in the `session_id` claim of the access
 * token. The token was already verified by getUser() before we get
 * here, so we only need to read the payload, not re-check the
 * signature.
 */
function readSessionIdFromAccessToken(
  accessToken: string | null | undefined,
) {
  if (!accessToken) {
    return null;
  }

  const parts = accessToken.split(".");

  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { session_id?: unknown };

    return typeof payload.session_id === "string"
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

function isMissingFunctionError(code: string | null | undefined) {
  // PGRST202 = function not found in schema cache.
  // 42883 = undefined_function.
  return code === "PGRST202" || code === "42883";
}

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

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const currentSessionId = readSessionIdFromAccessToken(
    session?.access_token,
  );

  const { data, error } = await supabase.rpc(
    "tenh_list_user_sessions",
  );

  if (error) {
    if (isMissingFunctionError(error.code)) {
      return {
        success: true,
        supported: false,
        currentSessionId,
        sessions: [],
      };
    }

    return {
      success: false,
      status: 500,
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

  // scope: "others" revokes every session except the one making the
  // request, so the current browser stays signed in.
  const { error } = await supabase.auth.signOut({
    scope: "others",
  });

  if (error) {
    return {
      success: false,
      status: 500,
      error: "Unable to sign out your other sessions.",
    };
  }

  return { success: true, revoked: -1 };
}

export async function revokeSession(
  sessionId: string,
): Promise<RevokeResult> {
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

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const currentSessionId = readSessionIdFromAccessToken(
    session?.access_token,
  );

  if (currentSessionId && sessionId === currentSessionId) {
    return {
      success: false,
      status: 400,
      error:
        "That is this device. Use the sign out button in your profile menu instead.",
    };
  }

  const { data, error } = await supabase.rpc(
    "tenh_revoke_user_session",
    { target_session_id: sessionId },
  );

  if (error) {
    if (isMissingFunctionError(error.code)) {
      return {
        success: false,
        status: 501,
        error:
          "Per-device sign out is not installed yet. Run supabase/sql/active-sessions.sql.",
      };
    }

    return {
      success: false,
      status: 500,
      error: "Unable to sign out that device.",
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
