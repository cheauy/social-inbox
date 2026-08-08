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

export const runtime =
  "nodejs";

const OAUTH_STATE_COOKIE =
  "tenh_facebook_oauth_state";

const FACEBOOK_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
];

export async function GET(
  request: NextRequest,
) {
  const appId =
    process.env
      .FACEBOOK_APP_ID?.trim();

  if (!appId) {
    return NextResponse.json(
      {
        error:
          "FACEBOOK_APP_ID is missing.",
      },
      {
        status: 500,
      },
    );
  }

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  const redirectUri =
    new URL(
      "/api/facebook/oauth/callback",
      request.nextUrl.origin,
    ).toString();

  const state =
    randomBytes(32).toString(
      "hex",
    );

  const cookieStore =
    await cookies();

  cookieStore.set(
    OAUTH_STATE_COOKIE,
    state,
    {
      httpOnly: true,
      secure:
        process.env
          .NODE_ENV ===
        "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    },
  );

  const oauthUrl =
    new URL(
      `https://www.facebook.com/${graphVersion}/dialog/oauth`,
    );

  oauthUrl.searchParams.set(
    "client_id",
    appId,
  );

  oauthUrl.searchParams.set(
    "redirect_uri",
    redirectUri,
  );

  oauthUrl.searchParams.set(
    "state",
    state,
  );

  oauthUrl.searchParams.set(
    "scope",
    FACEBOOK_SCOPES.join(","),
  );

  oauthUrl.searchParams.set(
    "response_type",
    "code",
  );

  return NextResponse.redirect(
    oauthUrl,
  );
}