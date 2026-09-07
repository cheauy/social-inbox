import { NextResponse } from "next/server";

import { isMarketingOrigin } from "@/lib/display/marketing-hosts";
import { createClient } from "@/lib/supabase/server";

/*
 * Does the caller's browser already have a session on the app?
 *
 * The marketing site and the app are one deployment on two hostnames, but the
 * session cookie is host-only on app.tenhchat.com -- nothing sets a cookie
 * domain, so tenhchat.com cannot read it and has no way to know the visitor is
 * signed in. That is why the marketing page cannot decide this on the server:
 * the request that renders it arrives with no session cookie at all.
 *
 * The two hosts share a registrable domain, so a request from tenhchat.com to
 * app.tenhchat.com is cross-origin but same-site. Cookies are sent with
 * credentials: "include" and are not affected by third-party cookie blocking.
 *
 * Widening the cookie to .tenhchat.com would also work and would avoid the
 * round trip, but it would put the session on every hostname under the domain
 * and would sign everyone out once during the change. This route is additive
 * and touches no existing authentication.
 */

const NO_STORE = {
  // A cached answer would tell the next visitor on a shared machine about the
  // previous one's session.
  "Cache-Control": "no-store, max-age=0",
  Vary: "Origin",
};

function corsHeaders(origin: string | null) {
  if (!isMarketingOrigin(origin) || !origin) {
    return NO_STORE;
  }

  return {
    ...NO_STORE,
    // Echoed, never "*": a wildcard cannot be combined with credentials, and
    // only the hosts that serve the marketing page may ask.
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(request.headers.get("origin")),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");

  /*
   * Same-origin calls carry no Origin header on a simple GET, so an absent
   * origin is allowed through and simply gets no CORS headers back. An origin
   * that is present and not ours is refused outright rather than answered
   * without the headers, so the refusal is legible in the network tab instead
   * of looking like a CORS misconfiguration.
   */
  if (origin && !isMarketingOrigin(origin)) {
    return NextResponse.json(
      { error: "Origin not allowed." },
      { status: 403, headers: NO_STORE },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * Whether, and nothing else. The caller only needs to know if it should
   * hand the visitor over to the app; a name or an email here would be
   * readable by any page on the marketing host.
   */
  return NextResponse.json(
    { signedIn: Boolean(user) },
    { headers: corsHeaders(origin) },
  );
}
