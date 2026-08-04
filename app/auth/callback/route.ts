import {
  NextRequest,
  NextResponse,
} from "next/server";

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

  return NextResponse.redirect(
    new URL(next, requestUrl.origin),
  );
}