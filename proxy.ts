import {
  createServerClient,
} from "@supabase/ssr";
import { MARKETING_HOSTS, normalizeHost } from "@/lib/display/marketing-hosts";

import {
  NextResponse,
  type NextRequest,
} from "next/server";

export async function proxy(
  request: NextRequest,
) {
  const host = normalizeHost(request.headers.get("x-forwarded-host")) ||
    normalizeHost(request.headers.get("host")) || request.nextUrl.hostname;
  const path = request.nextUrl.pathname;
  if (MARKETING_HOSTS.has(host) &&
    (path === "/login" || path === "/register" || path === "/dashboard" || path.startsWith("/dashboard/"))) {
    const appUrl = new URL("https://app.tenhchat.com");
    appUrl.pathname = path;
    appUrl.search = request.nextUrl.search;
    return NextResponse.redirect(appUrl, 307);
  }

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({
      request,
    });
  }

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(
            ({ name, value }) => {
              request.cookies.set(
                name,
                value,
              );
            },
          );

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(
            ({
              name,
              value,
              options,
            }) => {
              response.cookies.set(
                name,
                value,
                options,
              );
            },
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname =
    request.nextUrl.pathname;

  const isDashboard =
    pathname.startsWith("/dashboard");

  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register";

  if (!user && isDashboard) {
    const loginUrl =
      request.nextUrl.clone();

    loginUrl.pathname = "/login";

    return NextResponse.redirect(
      loginUrl,
    );
  }

  if (user && isAuthPage) {
    const dashboardUrl =
      request.nextUrl.clone();

    dashboardUrl.pathname =
      "/dashboard/inbox";

    return NextResponse.redirect(
      dashboardUrl,
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/login",
    "/register",
  ],
};
