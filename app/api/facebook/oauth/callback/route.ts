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
  encodeFacebookOAuthSession,
  FACEBOOK_OAUTH_SESSION_COOKIE,
  FACEBOOK_OAUTH_STATE_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";

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
) {
  const url = new URL(
    "/dashboard/integrations",
    request.nextUrl.origin,
  );

  url.searchParams.set("facebook", "error");
  url.searchParams.set("message", message);

  return NextResponse.redirect(url);
}

export async function GET(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return redirectWithError(
      request,
      authResult.error,
    );
  }

  const currentMember = authResult.member;
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(
    FACEBOOK_OAUTH_STATE_COOKIE,
  )?.value;

  cookieStore.delete(FACEBOOK_OAUTH_STATE_COOKIE);

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

  if (oauthError) {
    return redirectWithError(
      request,
      oauthError,
    );
  }

  if (
    !state ||
    !expectedState ||
    state !== expectedState
  ) {
    return redirectWithError(
      request,
      "Invalid Facebook OAuth state. Start the connection again from Integrations.",
    );
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
    request.nextUrl.origin,
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

    // Keep the User token only in an encrypted, httpOnly, short-lived cookie.
    // The browser never receives the raw token in HTML or JavaScript.
    const encryptedSession =
      encodeFacebookOAuthSession({
        businessId: currentMember.business_id,
        memberId: currentMember.id,
        userAccessToken:
          longTokenResult.access_token,
        userTokenExpiresAt,
      });

const response = NextResponse.redirect(
  new URL(
    "/dashboard/integrations/facebook/select",
    request.nextUrl.origin,
  ),
);

response.cookies.set(
  FACEBOOK_OAUTH_SESSION_COOKIE,
  encryptedSession,
  {
    httpOnly: true,
    secure:
      process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  },
);

return response;

    return NextResponse.redirect(
      new URL(
        "/dashboard/integrations/facebook/select",
        request.nextUrl.origin,
      ),
    );
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
