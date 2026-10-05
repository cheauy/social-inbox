import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
} from "@/lib/auth/require-permission";
import {
  getBusinessSubscriptionAccess,
} from "@/lib/subscription/get-business-subscription-access";
import {
  TIKTOK_OAUTH_STATE_COOKIE,
  verifyTikTokOAuthState,
} from "@/lib/tiktok/account-holder-oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALLBACK_PATH =
  "/api/tiktok/oauth/callback";
const PRODUCTION_ORIGIN =
  "https://app.tenhchat.com";

type CallbackResult =
  | "unauthorized"
  | "permission_denied"
  | "subscription_inactive"
  | "access_check_failed"
  | "configuration_missing"
  | "invalid_state"
  | "authorization_denied"
  | "malformed_callback"
  | "integration_disabled";

function finish(
  request: NextRequest,
  reason: CallbackResult,
) {
  const origin =
    process.env.NODE_ENV === "production"
      ? PRODUCTION_ORIGIN
      : request.nextUrl.origin;
  const url = new URL(
    "/dashboard/integrations",
    origin,
  );

  url.searchParams.set("tiktok", "error");
  url.searchParams.set("reason", reason);

  const response = NextResponse.redirect(url);

  response.cookies.set(
    TIKTOK_OAUTH_STATE_COOKIE,
    "",
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: CALLBACK_PATH,
      maxAge: 0,
    },
  );
  response.headers.set("Cache-Control", "no-store");

  return response;
}

function providerDenied(request: NextRequest) {
  return [
    "error",
    "error_code",
    "error_description",
    "error_message",
  ].some((name) =>
    request.nextUrl.searchParams.has(name),
  );
}

export async function GET(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return finish(request, "unauthorized");
  }

  const member = authResult.member;

  try {
    if (
      !(await memberHasPermission(
        member,
        "channels",
        "manage",
      ))
    ) {
      return finish(request, "permission_denied");
    }

    const subscription =
      await getBusinessSubscriptionAccess(
        member.business_id,
      );

    if (subscription.locked) {
      return finish(
        request,
        "subscription_inactive",
      );
    }
  } catch {
    return finish(request, "access_check_failed");
  }

  const secret =
    process.env.TIKTOK_OAUTH_STATE_SECRET?.trim() ??
    "";

  if (Buffer.byteLength(secret, "utf8") < 32) {
    return finish(request, "configuration_missing");
  }

  const returnedStates =
    request.nextUrl.searchParams.getAll("state");
  const stateResult = verifyTikTokOAuthState({
    cookieValue: request.cookies.get(
      TIKTOK_OAUTH_STATE_COOKIE,
    )?.value,
    returnedState:
      returnedStates.length === 1
        ? returnedStates[0]
        : null,
    memberId: member.id,
    businessId: member.business_id,
    secret,
  });

  if (!stateResult.success) {
    return finish(request, "invalid_state");
  }

  if (providerDenied(request)) {
    return finish(
      request,
      "authorization_denied",
    );
  }

  const codes =
    request.nextUrl.searchParams.getAll("code");

  if (
    codes.length !== 1 ||
    !codes[0].trim() ||
    codes[0].length > 4096
  ) {
    return finish(request, "malformed_callback");
  }

  // TikTok account-holder authorization is intentionally not active yet.
  // Do not exchange, log, persist, or expose the returned authorization code
  // until Business Messaging access and the storage contract are approved.
  return finish(request, "integration_disabled");
}
