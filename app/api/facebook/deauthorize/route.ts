import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  markFacebookSocialAccountAuthorizationNeedsAttention,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  decryptFacebookUserAuthorization,
} from "@/lib/facebook/facebook-token-crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const MAX_CALLBACK_BODY_BYTES = 32 * 1024;
const MAX_SIGNED_REQUEST_LENGTH = 16 * 1024;
const LEGACY_DEBUG_TOKEN_LIMIT = 40;

type SignedRequestPayload = {
  algorithm?: string;
  issued_at?: number;
  user_id?: string | number;
};

type FacebookAccountRow = {
  id: string;
  facebook_user_access_token_encrypted: string | null;
  facebook_token_status: string | null;
};

type DebugTokenPayload = {
  data?: {
    app_id?: string;
    user_id?: string;
    is_valid?: boolean;
  };
  error?: {
    message?: string;
    code?: number;
  };
};

function badRequest(error: string) {
  return NextResponse.json(
    { success: false, error },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

function parseAndVerifySignedRequest(
  signedRequest: string,
  appSecret: string,
): SignedRequestPayload | null {
  const separator = signedRequest.indexOf(".");

  if (
    separator <= 0 ||
    separator === signedRequest.length - 1 ||
    signedRequest.indexOf(".", separator + 1) !== -1
  ) {
    return null;
  }

  const encodedSignature = signedRequest.slice(0, separator);
  const encodedPayload = signedRequest.slice(separator + 1);

  let actualSignature: Buffer;
  let payload: SignedRequestPayload;

  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SignedRequestPayload;
  } catch {
    return null;
  }

  if (payload.algorithm?.toUpperCase() !== "HMAC-SHA256") {
    return null;
  }

  const expectedSignature = createHmac("sha256", appSecret)
    .update(encodedPayload, "utf8")
    .digest();

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  // Reject a callback timestamp that is implausibly in the future, but allow
  // old/retried callbacks. Replays are harmless because marking an already
  // revoked connection is idempotent and notification creation is transition-
  // guarded.
  if (
    typeof payload.issued_at === "number" &&
    payload.issued_at * 1000 > Date.now() + 5 * 60_000
  ) {
    return null;
  }

  return payload;
}

async function debugFacebookUserId({
  userAccessToken,
  appAccessToken,
}: {
  userAccessToken: string;
  appAccessToken: string;
}) {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
  const configuredAppId = process.env.FACEBOOK_APP_ID?.trim() || null;
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/debug_token`,
  );
  url.searchParams.set("input_token", userAccessToken);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
      },
    });
    const text = await response.text();
    const payload = text.trim()
      ? (JSON.parse(text) as DebugTokenPayload)
      : ({} as DebugTokenPayload);
    const userId = payload.data?.user_id?.trim() || null;
    const tokenAppId = payload.data?.app_id?.trim() || null;

    if (
      !userId ||
      (configuredAppId && tokenAppId && tokenAppId !== configuredAppId)
    ) {
      return null;
    }

    // Meta can report is_valid=false after deauthorization while still
    // identifying which app-scoped user the old token belonged to. We use only
    // the identity here; the token is never treated as valid or restored.
    return userId;
  } catch (error) {
    console.warn(
      "[TENH Facebook Deauthorize] Legacy token debug failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const appId = process.env.FACEBOOK_APP_ID?.trim();

  if (!appSecret || !appId) {
    console.error(
      "[TENH Facebook Deauthorize] FACEBOOK_APP_ID / FACEBOOK_APP_SECRET is missing.",
    );
    return NextResponse.json(
      { success: false, error: "Facebook callback configuration is incomplete." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CALLBACK_BODY_BYTES) {
    return badRequest("Facebook callback body is too large.");
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CALLBACK_BODY_BYTES) {
    return badRequest("Facebook callback body is too large.");
  }

  const signedRequest = new URLSearchParams(rawBody)
    .get("signed_request")
    ?.trim();

  if (!signedRequest || signedRequest.length > MAX_SIGNED_REQUEST_LENGTH) {
    return badRequest("Facebook signed_request is missing or invalid.");
  }

  const payload = parseAndVerifySignedRequest(signedRequest, appSecret);
  const facebookUserId =
    payload && payload.user_id !== undefined
      ? String(payload.user_id).trim()
      : "";

  if (!payload || !facebookUserId) {
    return badRequest("Facebook signed_request verification failed.");
  }

  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      facebook_user_access_token_encrypted,
      facebook_token_status
    `)
    .eq("platform", "facebook")
    .eq("is_active", true)
    .not("facebook_user_access_token_encrypted", "is", null)
    .order("facebook_connected_at", { ascending: false })
    .limit(200)
    .returns<FacebookAccountRow[]>();

  if (error) {
    console.error(
      "[TENH Facebook Deauthorize] Unable to load Facebook connections:",
      error.message,
    );
    // Return 500 so Meta may retry instead of silently losing the callback.
    return NextResponse.json(
      { success: false, error: "Unable to apply Facebook deauthorization." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const candidates = (data ?? []).filter(
    (row) => row.facebook_token_status !== "disconnected",
  );
  const matchedIds = new Set<string>();
  const legacyTokens = new Map<string, string[]>();

  for (const row of candidates) {
    if (!row.facebook_user_access_token_encrypted) {
      continue;
    }

    try {
      const authorization = decryptFacebookUserAuthorization(
        row.facebook_user_access_token_encrypted,
      );

      if (authorization.userId === facebookUserId) {
        matchedIds.add(row.id);
        continue;
      }

      // Rows created before this update do not contain the encrypted user id.
      // Keep a deduplicated token -> account mapping for a bounded Meta
      // debug_token fallback. New/reconnected rows skip this network fallback.
      if (!authorization.userId && authorization.accessToken) {
        const ids = legacyTokens.get(authorization.accessToken) ?? [];
        ids.push(row.id);
        legacyTokens.set(authorization.accessToken, ids);
      }
    } catch (decryptError) {
      console.warn(
        "[TENH Facebook Deauthorize] Unable to inspect one stored User authorization:",
        decryptError instanceof Error ? decryptError.message : "Unknown error",
      );
    }
  }

  if (matchedIds.size === 0 && legacyTokens.size > 0) {
    const appAccessToken =
      process.env.FACEBOOK_APP_ACCESS_TOKEN?.trim() || `${appId}|${appSecret}`;
    let checked = 0;

    for (const [token, accountIds] of legacyTokens) {
      if (checked >= LEGACY_DEBUG_TOKEN_LIMIT) {
        break;
      }
      checked += 1;

      const debugUserId = await debugFacebookUserId({
        userAccessToken: token,
        appAccessToken,
      });

      if (debugUserId === facebookUserId) {
        for (const accountId of accountIds) {
          matchedIds.add(accountId);
        }
      }
    }
  }

  const revocationMessage =
    "Facebook reported that TENH authorization was removed. Reconnect Facebook from Integrations to resume Messenger and comment delivery. Existing TENH history is preserved.";

  let revokedConnections = 0;
  for (const socialAccountId of matchedIds) {
    if (
      await markFacebookSocialAccountAuthorizationNeedsAttention({
        socialAccountId,
        status: "revoked",
        message: revocationMessage,
      })
    ) {
      revokedConnections += 1;
    }
  }

  if (revokedConnections === 0) {
    // Never guess and revoke unrelated Pages. Legacy rows that could not be
    // matched immediately remain protected by TENH's hourly token watchdog.
    console.warn(
      "[TENH Facebook Deauthorize] Valid Meta deauthorization received but no local connection could be matched safely. The watchdog remains the fallback.",
    );
  } else {
    console.log(
      "[TENH Facebook Deauthorize] Facebook authorization marked revoked.",
      { revokedConnections },
    );
  }

  return NextResponse.json(
    {
      success: true,
      revokedConnections,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
