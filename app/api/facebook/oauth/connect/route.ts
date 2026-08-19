import {
  randomBytes,
} from "node:crypto";

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
  FACEBOOK_OAUTH_SESSION_COOKIE,
  FACEBOOK_OAUTH_STATE_COOKIE,
} from "@/lib/facebook/facebook-oauth-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToIntegrations(
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

function getFacebookLoginForBusinessConfigId() {
  return (
    process.env.FACEBOOK_LOGIN_FOR_BUSINESS_CONFIG_ID?.trim() ||
    process.env.FACEBOOK_LOGIN_CONFIG_ID?.trim() ||
    ""
  );
}

export async function GET(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return redirectToIntegrations(
      request,
      authResult.error,
    );
  }

  const appId =
    process.env.FACEBOOK_APP_ID?.trim();
  const businessLoginConfigId =
    getFacebookLoginForBusinessConfigId();

  if (!appId) {
    return redirectToIntegrations(
      request,
      "FACEBOOK_APP_ID is missing.",
    );
  }

  if (!businessLoginConfigId) {
    return redirectToIntegrations(
      request,
      "FACEBOOK_LOGIN_FOR_BUSINESS_CONFIG_ID is missing. Create a Facebook Login for Business configuration in Meta, then add its Configuration ID to your TENH environment variables.",
    );
  }

  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0";

  const redirectUri = new URL(
    "/api/facebook/oauth/callback",
    request.nextUrl.origin,
  ).toString();

  const state = randomBytes(32).toString("hex");
  const cookieStore = await cookies();

  // Clear any unfinished older connection attempt first.
  cookieStore.delete(FACEBOOK_OAUTH_SESSION_COOKIE);

  cookieStore.set(
    FACEBOOK_OAUTH_STATE_COOKIE,
    state,
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    },
  );

  const oauthUrl = new URL(
    `https://www.facebook.com/${graphVersion}/dialog/oauth`,
  );

  oauthUrl.searchParams.set("client_id", appId);
  oauthUrl.searchParams.set(
    "redirect_uri",
    redirectUri,
  );
  oauthUrl.searchParams.set("state", state);

  /*
   * V3.11.32 — Facebook Login for Business.
   *
   * IMPORTANT:
   * Meta's Business Login flow uses config_id instead of scope.
   * The Meta configuration controls:
   *   - access-token type (TENH expects User Access Token),
   *   - Page asset selection,
   *   - permissions granted to TENH.
   *
   * Do not add a normal `scope` parameter here. Doing so changes the
   * authorization flow and prevents TENH from using the native Meta
   * business asset selector configured in the App Dashboard.
   */
  oauthUrl.searchParams.set(
    "config_id",
    businessLoginConfigId,
  );
  oauthUrl.searchParams.set(
    "response_type",
    "code",
  );

  return NextResponse.redirect(oauthUrl);
}
