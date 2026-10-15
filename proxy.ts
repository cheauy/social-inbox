import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { MARKETING_HOSTS, normalizeHost } from "@/lib/display/marketing-hosts";
import { checkSessionPolicy } from "@/lib/auth/session-policy";
import { safeAuthReturnPath } from "@/lib/auth/return-path";
import { verifyAuthTicket } from "@/lib/auth/auth-ticket";
import { SESSION_HINT_COOKIE, isSupabaseAuthCookie, readSessionCookieHint, sessionCookiePersistence } from "@/lib/auth/session-cookie-options";

const AUTH_PAGES = new Set(["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"]);
const PRIVATE_COOKIES = new Set([SESSION_HINT_COOKIE, "tenh_auth_intent", "tenh_recovery_grant", "tenh_active_business_id"]);

function mergeVary(headers: Headers, values: string) {
  const names = new Map<string, string>();
  for (const value of `${headers.get("Vary") ?? ""},${values}`.split(",")) {
    const name = value.trim();
    if (name) names.set(name.toLowerCase(), name);
  }
  headers.set("Vary", [...names.values()].join(", "));
}

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  mergeVary(response.headers, "Cookie, Origin, Authorization");
  return response;
}

export async function proxy(request: NextRequest) {
  const host = normalizeHost(request.headers.get("x-forwarded-host")) ||
    normalizeHost(request.headers.get("host")) || request.nextUrl.hostname;
  const path = request.nextUrl.pathname;
  const dashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const authPage = AUTH_PAGES.has(path);
  if (MARKETING_HOSTS.has(host) && (authPage || dashboard)) {
    const appUrl = new URL("https://app.tenhchat.com");
    appUrl.pathname = path;
    appUrl.search = request.nextUrl.search;
    return noStore(NextResponse.redirect(appUrl, 307));
  }

  const api = path === "/api" || path.startsWith("/api/");
  const providerFlow = path === "/auth" || path.startsWith("/auth/");
  const authApi = path.startsWith("/api/auth/") || path.startsWith("/api/account/");
  const hasAuthCookie = request.cookies.getAll().some(cookie => isSupabaseAuthCookie(cookie.name));
  const privateApi = api && (authApi || hasAuthCookie || /^Bearer\s+/i.test(request.headers.get("authorization") ?? ""));
  const privateResponse = dashboard || authPage || providerFlow || privateApi;
  // API handlers own their verified client; callbacks must exchange their code first.
  if (api || providerFlow || (!dashboard && !authPage)) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    return privateResponse ? noStore(response) : response;
  }

  const cookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const headers = new Headers();
  function finish(response: NextResponse) {
    headers.forEach((value, name) => name.toLowerCase() === "vary"
      ? mergeVary(response.headers, value) : response.headers.set(name, value));
    for (const cookie of cookies.values()) response.cookies.set(cookie.name, cookie.value, cookie.options);
    return noStore(response);
  }
  function next() { return finish(NextResponse.next({ request: { headers: request.headers } })); }
  function clearPrivateCookies() {
    for (const cookie of request.cookies.getAll()) {
      if (!isSupabaseAuthCookie(cookie.name) && !PRIVATE_COOKIES.has(cookie.name)) continue;
      request.cookies.delete(cookie.name);
      cookies.set(cookie.name, { name: cookie.name, value: "", options: {
        path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 0,
      } });
    }
  }
  function login(expired: boolean) {
    const url = new URL("/login", request.nextUrl.origin);
    url.searchParams.set("next", safeAuthReturnPath(`${path}${request.nextUrl.search}`, request.nextUrl.origin));
    if (expired) url.searchParams.set("reason", "session_expired");
    return finish(NextResponse.redirect(url));
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return finish(NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 }));
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(changes, sdkHeaders) {
        for (const { name, value, options } of changes) {
          request.cookies.set(name, value);
          const cleanOptions = { ...options };
          const signed = request.cookies.get(SESSION_HINT_COOKIE)?.value;
          // Legacy sessions retain SDK persistence until reviewed reauthentication.
          if (options.maxAge !== 0 && isSupabaseAuthCookie(name) && signed) {
            delete cleanOptions.maxAge;
            delete cleanOptions.expires;
            const hint = verifyAuthTicket(signed, "persistence") ? readSessionCookieHint(signed) : null;
            Object.assign(cleanOptions, sessionCookiePersistence(hint));
          }
          cookies.set(name, { name, value, options: cleanOptions });
        }
        for (const [name, value] of Object.entries(sdkHeaders ?? {})) {
          if (name.toLowerCase() === "vary") mergeVary(headers, value);
          else headers.set(name, value);
        }
      },
    },
  });
  let user;
  try {
    const verified = await supabase.auth.getUser();
    if (verified.error && ![400, 401, 403].includes(verified.error.status ?? 0)) {
      return finish(NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 }));
    }
    user = verified.error ? null : verified.data.user;
  } catch {
    return finish(NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 }));
  }
  if (!user) {
    const expired = hasAuthCookie;
    if (expired) clearPrivateCookies();
    return dashboard ? login(expired) : next();
  }
  const policy = await checkSessionPolicy(supabase, user, { allowRecovery: true });
  if (!policy.allowed) {
    if (policy.status === 503) return finish(NextResponse.json({ error: "Session verification is temporarily unavailable." }, { status: 503 }));
    clearPrivateCookies();
    return dashboard ? login(true) : next();
  }
  if (policy.kind === "recovery") {
    return path === "/reset-password" ? next() : finish(NextResponse.redirect(new URL("/reset-password", request.nextUrl.origin)));
  }
  if (authPage) {
    const destination = safeAuthReturnPath(request.nextUrl.searchParams.get("next"), request.nextUrl.origin);
    return finish(NextResponse.redirect(new URL(destination, request.nextUrl.origin)));
  }
  return next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/login", "/register", "/verify-email", "/forgot-password", "/reset-password", "/api/:path*", "/auth/:path*"],
};
