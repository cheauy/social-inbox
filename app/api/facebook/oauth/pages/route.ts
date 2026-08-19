import {
  NextRequest,
  NextResponse,
} from "next/server";
import {
  cookies,
} from "next/headers";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getFacebookAuthorizedPages,
} from "@/lib/facebook/facebook-authorized-pages";
import {
  decryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";
import {
  decodeFacebookOAuthSession,
  encodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoredFacebookUserToken = {
  facebook_user_access_token_encrypted: string | null;
  facebook_user_token_expires_at: string | null;
  facebook_connected_at: string | null;
  facebook_token_status: string | null;
};

function redirectToSelector(request: NextRequest) {
  return NextResponse.redirect(
    new URL(
      "/dashboard/integrations/facebook/select",
      request.nextUrl.origin,
    ),
  );
}

function redirectToFacebookLogin(request: NextRequest) {
  return NextResponse.redirect(
    new URL(
      "/api/facebook/oauth/connect",
      request.nextUrl.origin,
    ),
  );
}

function tokenIsExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);

  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  // Do not reuse a token that is already expired or is about to expire.
  return expiresAtMs <= Date.now() + 5 * 60 * 1000;
}

function setFacebookSelectionSession({
  businessId,
  memberId,
  userAccessToken,
  userTokenExpiresAt,
}: {
  businessId: string;
  memberId: string;
  userAccessToken: string;
  userTokenExpiresAt: string | null;
}) {
  return encodeFacebookOAuthSession({
    businessId,
    memberId,
    userAccessToken,
    userTokenExpiresAt,
  });
}

export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    const url = new URL(
      "/dashboard/integrations",
      request.nextUrl.origin,
    );
    url.searchParams.set("facebook", "error");
    url.searchParams.set("message", authResult.error);
    return NextResponse.redirect(url);
  }

  const currentMember = authResult.member;
  const cookieStore = await cookies();
  const existingSessionValue = cookieStore.get(
    FACEBOOK_OAUTH_SESSION_COOKIE,
  )?.value;

  // If another valid Page-selection session is already open, use it directly.
  if (existingSessionValue) {
    try {
      const existingSession = decodeFacebookOAuthSession(
        existingSessionValue,
      );

      if (
        existingSession.businessId === currentMember.business_id &&
        existingSession.memberId === currentMember.id &&
        !tokenIsExpired(existingSession.userTokenExpiresAt)
      ) {
        return redirectToSelector(request);
      }
    } catch {
      // Fall through and rebuild the selection session from the encrypted
      // Facebook user token stored with a connected Page.
    }

    cookieStore.delete(FACEBOOK_OAUTH_SESSION_COOKIE);
  }

  const {
    data: tokenRows,
    error: tokenRowsError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      facebook_user_access_token_encrypted,
      facebook_user_token_expires_at,
      facebook_connected_at,
      facebook_token_status
    `)
    .eq("business_id", currentMember.business_id)
    .eq("platform", "facebook")
    .order("facebook_connected_at", {
      ascending: false,
    })
    .limit(10)
    .returns<StoredFacebookUserToken[]>();

  if (tokenRowsError) {
    console.warn(
      "[TENH Facebook OAuth] Unable to load a reusable Facebook user token:",
      tokenRowsError.message,
    );
    return redirectToFacebookLogin(request);
  }

  const seenTokens = new Set<string>();
  let bestToken:
    | {
        token: string;
        expiresAt: string | null;
        pageCount: number;
      }
    | null = null;

  for (const row of tokenRows ?? []) {
    if (
      !row.facebook_user_access_token_encrypted ||
      tokenIsExpired(row.facebook_user_token_expires_at)
    ) {
      continue;
    }

    let userAccessToken: string;

    try {
      userAccessToken = decryptFacebookToken(
        row.facebook_user_access_token_encrypted,
      ).trim();
    } catch {
      continue;
    }

    if (!userAccessToken || seenTokens.has(userAccessToken)) {
      continue;
    }

    seenTokens.add(userAccessToken);

    try {
      const authorized = await getFacebookAuthorizedPages(
        userAccessToken,
      );
      const pageCount = Math.max(
        authorized.pages.length,
        authorized.authorizedTargetIds.length,
      );

      if (
        pageCount > 0 &&
        (!bestToken || pageCount > bestToken.pageCount)
      ) {
        bestToken = {
          token: userAccessToken,
          expiresAt: row.facebook_user_token_expires_at,
          pageCount,
        };
      }
    } catch (error) {
      console.warn(
        "[TENH Facebook OAuth] Stored Facebook user token cannot reopen Page selection:",
        error instanceof Error
          ? error.message
          : "Unknown Facebook token error",
      );
    }
  }

  if (!bestToken) {
    // First-ever connection, expired/revoked authorization, or a different
    // Facebook account is required. Only in those cases do we reauthorize
    // through Facebook Login for Business. Soft-disconnected Page rows may still
    // provide a valid Facebook user authorization for reopening the selector.
    return redirectToFacebookLogin(request);
  }

  const encryptedSession = setFacebookSelectionSession({
    businessId: currentMember.business_id,
    memberId: currentMember.id,
    userAccessToken: bestToken.token,
    userTokenExpiresAt: bestToken.expiresAt,
  });

  cookieStore.set(
    FACEBOOK_OAUTH_SESSION_COOKIE,
    encryptedSession,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 15 * 60,
    },
  );

  return redirectToSelector(request);
}
