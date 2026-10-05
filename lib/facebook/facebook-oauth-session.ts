import "server-only";

import {
  decryptFacebookToken,
  encryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";

export const FACEBOOK_OAUTH_STATE_COOKIE =
  "tenh_facebook_oauth_state";

export const FACEBOOK_OAUTH_SESSION_COOKIE =
  "tenh_facebook_oauth_session";

export const FACEBOOK_OAUTH_STATE_MAX_AGE = 10 * 60;

type FacebookOAuthState = {
  state: string;
  userId: string;
  businessId: string;
  memberId: string;
  issuedAt: number;
};

export function encodeFacebookOAuthState(attempt: FacebookOAuthState) {
  return encryptFacebookToken(JSON.stringify({
    type: "tenh-facebook-oauth-state-v1",
    ...attempt,
  }));
}

export function decodeFacebookOAuthState(encrypted: string, now = Date.now()): FacebookOAuthState {
  const parsed = JSON.parse(decryptFacebookToken(encrypted)) as Record<string, unknown>;
  const state = cleanString(parsed.state);
  const userId = cleanString(parsed.userId);
  const businessId = cleanString(parsed.businessId);
  const memberId = cleanString(parsed.memberId);
  const issuedAt = parsed.issuedAt;
  if (parsed.type !== "tenh-facebook-oauth-state-v1" || !state || !/^[a-f0-9]{64}$/.test(state) ||
      !userId || !businessId || !memberId || typeof issuedAt !== "number" ||
      !Number.isSafeInteger(issuedAt) || issuedAt > now + 30_000 ||
      now - issuedAt >= FACEBOOK_OAUTH_STATE_MAX_AGE * 1000) {
    throw new Error("Invalid or expired Facebook OAuth state.");
  }
  return { state, userId, businessId, memberId, issuedAt };
}

export type FacebookOAuthSession = {
  businessId: string;
  memberId: string;
  userAccessToken: string;
  userTokenExpiresAt: string | null;
  facebookUserId: string | null;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export function encodeFacebookOAuthSession(
  session: FacebookOAuthSession,
) {
  return encryptFacebookToken(
    JSON.stringify(session),
  );
}

export function decodeFacebookOAuthSession(
  encrypted: string,
): FacebookOAuthSession {
  const raw = decryptFacebookToken(encrypted);
  const parsed = JSON.parse(raw) as Record<
    string,
    unknown
  >;

  const businessId = cleanString(parsed.businessId);
  const memberId = cleanString(parsed.memberId);
  const userAccessToken = cleanString(
    parsed.userAccessToken,
  );
  const userTokenExpiresAt = cleanString(
    parsed.userTokenExpiresAt,
  );
  const facebookUserId = cleanString(
    parsed.facebookUserId,
  );

  if (!businessId || !memberId || !userAccessToken) {
    throw new Error(
      "Invalid Facebook OAuth session.",
    );
  }

  return {
    businessId,
    memberId,
    userAccessToken,
    userTokenExpiresAt,
    facebookUserId,
  };
}
