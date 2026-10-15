import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyAuthTicket } from "@/lib/auth/auth-ticket";
import { bindSessionPolicy } from "@/lib/auth/session-policy";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { AUTH_INTENT_COOKIE, AUTH_NO_STORE, clearAuthSessionCookies, completeAuthenticatedLogin, setAuthSessionCookies } from "@/lib/auth/auth-flow";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const redirect = (path: string) => NextResponse.redirect(new URL(path, url.origin), { headers: AUTH_NO_STORE });
  const store = await cookies();
  const intent = verifyAuthTicket(store.get(AUTH_INTENT_COOKIE)?.value, "oauth");
  store.set(AUTH_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048 || !intent || intent.nonce !== url.searchParams.get("intent") ||
      typeof intent.rememberMe !== "boolean" || typeof intent.issuedAt !== "number" ||
      intent.issuedAt > Date.now() || intent.issuedAt < Date.now() - 600_000) return redirect("/login?error=oauth_callback_failed");
  try {
    const limit = await consumeAuthRateLimit(request, "oauth");
    if (!limit.allowed) return redirect("/login?error=oauth_callback_failed");
    const client = await createClient({ authFlow: true });
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user) return redirect("/login?error=oauth_callback_failed");
    const policy = await bindSessionPolicy(client, data.user, intent.rememberMe);
    if (!policy.allowed) { await clearAuthSessionCookies(); return redirect("/login?error=session_unavailable"); }
    await setAuthSessionCookies(policy);
    return redirect(await completeAuthenticatedLogin(data.user, request, intent.next));
  } catch { return redirect("/login?error=oauth_callback_failed"); }
}
