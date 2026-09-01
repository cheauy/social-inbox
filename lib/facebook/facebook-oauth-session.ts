import "server-only";

import {
  decryptFacebookToken,
  encryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";

export const FACEBOOK_OAUTH_STATE_COOKIE =
  "tenh_facebook_oauth_state";

export const FACEBOOK_OAUTH_SESSION_COOKIE =
  "tenh_facebook_oauth_session";

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
