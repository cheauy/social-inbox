import {
  NextRequest,
  NextResponse,
} from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";

import { provisionUserWorkspace } from "@/lib/onboarding/ensure-user-workspace";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
) {
  const requestUrl =
    new URL(request.url);

  const code =
    requestUrl.searchParams.get("code");

  const next =
    requestUrl.searchParams.get("next") ??
    "/dashboard/inbox";

  if (!code) {
    return NextResponse.redirect(
      new URL(
        "/login?error=missing_oauth_code",
        requestUrl.origin,
      ),
    );
  }

  const supabase =
    await createClient();

  const { error } =
    await supabase.auth
      .exchangeCodeForSession(code);

  if (error) {
    console.error(
      "OAuth callback failed:",
      error,
    );

    return NextResponse.redirect(
      new URL(
        "/login?error=oauth_callback_failed",
        requestUrl.origin,
      ),
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(
      new URL(
        "/login?error=oauth_user_missing",
        requestUrl.origin,
      ),
    );
  }

  const provision = await provisionUserWorkspace(
    user,
    request,
  );

  if (!provision.success) {
    console.error("OAuth workspace provisioning failed:", {
      code: provision.code,
      message: provision.error,
    });

    return NextResponse.redirect(
      new URL(
        "/login?error=workspace_provision_failed",
        requestUrl.origin,
      ),
    );
  }

  const destination =
    provision.trialGranted === false
      ? "/dashboard/subscription/buy?trial=not-eligible"
      : next;

  const response = NextResponse.redirect(
    new URL(destination, requestUrl.origin),
  );

  response.cookies.set(
    TENH_ACTIVE_BUSINESS_COOKIE,
    provision.member.business_id,
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    },
  );

  return response;
}
