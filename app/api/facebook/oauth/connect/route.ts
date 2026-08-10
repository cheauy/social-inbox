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

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
] as const;

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

  if (!appId) {
    return redirectToIntegrations(
      request,
      "FACEBOOK_APP_ID is missing.",
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
  oauthUrl.searchParams.set(
    "scope",
    FACEBOOK_SCOPES.join(","),
  );
  oauthUrl.searchParams.set(
    "response_type",
    "code",
  );

  return NextResponse.redirect(oauthUrl);
}
