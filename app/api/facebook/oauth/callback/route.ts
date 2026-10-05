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
  decodeFacebookOAuthState,
  encodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
  FACEBOOK_OAUTH_STATE_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";
import {
  FACEBOOK_COOKIE_DOMAIN,
  getFacebookAppOrigin,
} from "@/lib/facebook/facebook-origin";
import { memberHasPermission } from "@/lib/auth/require-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenResult = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

type FacebookMeResult = {
  id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

async function readJson<T>(
  response: Response,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function redirectWithError(
  request: NextRequest,
  message: string,
  clearState = true,
) {
  const url = new URL(
    "/dashboard/integrations",
    getFacebookAppOrigin(request),
  );

  url.searchParams.set("facebook", "error");
  url.searchParams.set("message", message);

  const response = NextResponse.redirect(url);
  // After authentication, success/refusal consumes the browser attempt.
  if (clearState) response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    domain: FACEBOOK_COOKIE_DOMAIN,
    maxAge: 0,
  });
  return response;
}

export async function GET(
  request: NextRequest,
) {
  const authResult = await getCurrentMember(true);

  if (!authResult.success) {
    // No attempt was accepted. Its identity binding and expiry remain intact.
    return redirectWithError(
      request,
      authResult.error,
      false,
    );
  }

  const currentMember = authResult.member;
  const cookieStore = await cookies();
  const encryptedState = cookieStore.get(
    FACEBOOK_OAUTH_STATE_COOKIE,
  )?.value;

  const state = request.nextUrl.searchParams.get(
    "state",
  );
  const code = request.nextUrl.searchParams.get(
    "code",
  );
  const oauthError =
    request.nextUrl.searchParams.get(
      "error_message",
    ) ??
    request.nextUrl.searchParams.get(
      "error_description",
    );

  let attempt: ReturnType<typeof decodeFacebookOAuthState>;
  try {
    if (!encryptedState) throw new Error("Missing state.");
    attempt = decodeFacebookOAuthState(encryptedState);
  } catch {
    return redirectWithError(
      request,
      "Invalid or expired Facebook OAuth state. Start the connection again from Integrations.",
    );
  }

  // A stale callback must not consume a newer attempt in this cookie jar.
  if (!state || state !== attempt.state) {
    return redirectWithError(request, "Invalid or expired Facebook OAuth state. Start the connection again from Integrations.", false);
  }
  if (attempt.userId !== authResult.user.id ||
      attempt.businessId !== currentMember.business_id ||
      attempt.memberId !== currentMember.id) {
    return redirectWithError(request, "This Facebook authorization belongs to a different TENH workspace or member. Start again from the intended workspace.");
  }
  if (oauthError) {
    return redirectWithError(request, oauthError);
  }
  if (!(await memberHasPermission(currentMember, "channels", "manage"))) {
    return redirectWithError(request, "You no longer have permission to connect channels in this workspace.");
  }

  if (!code) {
    return redirectWithError(
      request,
      "Facebook did not return an authorization code.",
    );
  }

  const appId =
    process.env.FACEBOOK_APP_ID?.trim();
  const appSecret =
    process.env.FACEBOOK_APP_SECRET?.trim();
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0";

  if (!appId || !appSecret) {
    return redirectWithError(
      request,
      "Facebook OAuth environment variables are incomplete.",
    );
  }

  const redirectUri = new URL(
    "/api/facebook/oauth/callback",
    getFacebookAppOrigin(request),
  ).toString();

  try {
    // 1) Authorization code -> short-lived User access token.
    const codeExchangeUrl = new URL(
      `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
    );

    codeExchangeUrl.searchParams.set(
      "client_id",
      appId,
    );
    codeExchangeUrl.searchParams.set(
      "client_secret",
      appSecret,
    );
    codeExchangeUrl.searchParams.set(
      "redirect_uri",
      redirectUri,
    );
    codeExchangeUrl.searchParams.set(
      "code",
      code,
    );

    const codeExchangeResponse = await fetch(
      codeExchangeUrl,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const shortTokenResult =
      await readJson<TokenResult>(
        codeExchangeResponse,
      );

    if (
      !codeExchangeResponse.ok ||
      !shortTokenResult.access_token
    ) {
      throw new Error(
        shortTokenResult.error?.message ??
          "Unable to exchange the Facebook authorization code.",
      );
    }

    // 2) Short-lived User token -> long-lived User token.
    const longTokenUrl = new URL(
      `https://graph.facebook.com/${graphVersion}/oauth/access_token`,
    );

    longTokenUrl.searchParams.set(
      "grant_type",
      "fb_exchange_token",
    );
    longTokenUrl.searchParams.set(
      "client_id",
      appId,
    );
    longTokenUrl.searchParams.set(
      "client_secret",
      appSecret,
    );
    longTokenUrl.searchParams.set(
      "fb_exchange_token",
      shortTokenResult.access_token,
    );

    const longTokenResponse = await fetch(
      longTokenUrl,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const longTokenResult =
      await readJson<TokenResult>(
        longTokenResponse,
      );

    if (
      !longTokenResponse.ok ||
      !longTokenResult.access_token
    ) {
      throw new Error(
        longTokenResult.error?.message ??
          "Unable to exchange the Facebook User token.",
      );
    }

    const userTokenExpiresAt =
      longTokenResult.expires_in
        ? new Date(
            Date.now() +
              longTokenResult.expires_in * 1000,
          ).toISOString()
        : null;

    // Capture Meta's app-scoped Facebook user id while authorization is valid.
    // It stays encrypted inside TENH's OAuth/session and stored user-token
    // envelope; it is never exposed to the browser. This gives the
    // deauthorization callback an exact local match later without a DB change.
    let facebookUserId: string | null = null;

    try {
      const meUrl = new URL(
        `https://graph.facebook.com/${graphVersion}/me`,
      );
      meUrl.searchParams.set("fields", "id");

      const meResponse = await fetch(meUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${longTokenResult.access_token}`,
        },
      });
      const meResult = await readJson<FacebookMeResult>(meResponse);

      if (meResponse.ok && !meResult.error && meResult.id?.trim()) {
        facebookUserId = meResult.id.trim();
      } else {
        console.warn(
          "[Tenh Facebook OAuth] Could not capture app-scoped Facebook user id; deauthorization will fall back to token debugging.",
          meResult.error?.message ?? `HTTP ${meResponse.status}`,
        );
      }
    } catch (error) {
      console.warn(
        "[Tenh Facebook OAuth] Facebook user-id lookup failed; continuing connection safely.",
        error instanceof Error ? error.message : "Unknown error",
      );
    }

    // Keep the User token only in an encrypted, httpOnly, short-lived cookie.
    // The browser never receives the raw token in HTML or JavaScript.
    const encryptedSession =
      encodeFacebookOAuthSession({
        businessId: currentMember.business_id,
        memberId: currentMember.id,
        userAccessToken:
          longTokenResult.access_token,
        userTokenExpiresAt,
        facebookUserId,
      });

    const response = NextResponse.redirect(
      new URL(
        "/dashboard/integrations/facebook/select",
        getFacebookAppOrigin(request),
      ),
    );

    // Clear OAuth state using the same shared production domain.
    response.cookies.set(
      FACEBOOK_OAUTH_STATE_COOKIE,
      "",
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        domain: FACEBOOK_COOKIE_DOMAIN,
        maxAge: 0,
      },
    );

    // Share the short-lived selection session across tenhchat.com and
    // www.tenhchat.com so a canonical-host redirect cannot lose it.
    response.cookies.set(
      FACEBOOK_OAUTH_SESSION_COOKIE,
      encryptedSession,
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        domain: FACEBOOK_COOKIE_DOMAIN,
        maxAge: 15 * 60,
      },
    );

    return response;
  } catch (error) {
    console.error(
      "[Tenh Facebook OAuth] Callback failed:",
      error instanceof Error
        ? error.message
        : "Unknown error",
    );

    return redirectWithError(
      request,
      error instanceof Error
        ? error.message
        : "Unable to connect Facebook.",
    );
  }
}
