import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bindSessionPolicy } from "@/lib/auth/session-policy";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { signAuthTicket } from "@/lib/auth/auth-ticket";
import { safeAuthReturnPath } from "@/lib/auth/return-path";
import { AUTH_NO_STORE, AUTH_RECOVERY_COOKIE, clearAuthSessionCookies, setAuthSessionCookies } from "@/lib/auth/auth-flow";

export const dynamic = "force-dynamic";
/** The provider validates the single-use token against its actual email purpose. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const recovery = url.pathname === "/auth/recovery" || type === "recovery";
  const fail = () => NextResponse.redirect(new URL(recovery ? "/reset-password?error=invalid_link" : "/verify-email?error=invalid_link", url.origin), { headers: AUTH_NO_STORE });
  const hash = url.searchParams.get("token_hash");
  if (!hash || hash.length > 2048 || (type !== "signup" && type !== "email" && type !== "recovery") ||
      (url.pathname === "/auth/recovery" && type !== "recovery")) return fail();
  try {
    const rate = await consumeAuthRateLimit(request, recovery ? "recover" : "confirm");
    if (!rate.allowed) return fail();
    const client = await createClient({ authFlow: true });
    const { data, error } = await client.auth.verifyOtp({ token_hash: hash, type: recovery ? "recovery" : type === "signup" ? "signup" : "email" });
    if (error || !data.user || !data.session) return fail();
    if (recovery) {
      const policy = await bindSessionPolicy(client, data.user, false, "recovery");
      if (!policy.allowed) { await clearAuthSessionCookies(); return fail(); }
      await setAuthSessionCookies(policy);
      (await cookies()).set(AUTH_RECOVERY_COOKIE, signAuthTicket({ userId: data.user.id, sessionId: policy.sessionId, expiresAt: Date.now() + 600_000 }, "recovery"), {
        path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600,
      });
      return NextResponse.redirect(new URL("/reset-password", url.origin), { headers: AUTH_NO_STORE });
    }
    await client.auth.signOut({ scope: "local" });
    await clearAuthSessionCookies();
    return NextResponse.redirect(new URL(`/login?confirmed=1&next=${encodeURIComponent(safeAuthReturnPath(url.searchParams.get("next"), url.origin))}`, url.origin), { headers: AUTH_NO_STORE });
  } catch { return fail(); }
}
