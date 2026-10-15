import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";
import { createClient } from "@/lib/supabase/server";
import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { checkSessionPolicy, revokeSessionPolicies } from "@/lib/auth/session-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Clear the active-workspace pointer as part of signing out.
 *
 * supabase.auth.signOut() clears its own auth cookies and nothing else, and
 * tenh_active_business_id is httpOnly with a year on it, so the browser keeps
 * it and page JS cannot remove it. It therefore outlived the session that set
 * it: the next sign-in was resolved against a workspace the previous session
 * happened to be in -- for anyone who had trialled, the expired trial -- and
 * they met the locked screen again on every login.
 *
 * Clearing it belongs to signing out for a second reason: the pointer is one
 * user's, and on a shared browser the next person to sign in should not inherit
 * it. Nothing is lost by dropping it, since the workspace is re-resolved on the
 * next request.
 */
export async function POST(request: Request) {
  const validation = validateAuthMutationRequest(request);
  if (!validation.success) return NextResponse.json(validation, { status: validation.status });
  const body = await request.json().catch(() => null) as { scope?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    (body.scope !== undefined && body.scope !== "local" && body.scope !== "global")) {
    return NextResponse.json({ success: false, error: "Choose a valid sign-out scope." }, { status: 400 });
  }
  const scope = body.scope === "global" ? "global" : "local";
  const supabase = await createClient({ authFlow: true, allowRecovery: true });
  let remoteRevocationConfirmed = false;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    let ledgerRevoked = !user && !error;
    if (user && !error) {
      const policy = await checkSessionPolicy(supabase, user, { allowRecovery: true });
      ledgerRevoked = scope === "global" ? await revokeSessionPolicies(user, null)
        : policy.allowed ? await revokeSessionPolicies(user, policy.sessionId) : false;
    }
    const { error: providerError } = await supabase.auth.signOut({ scope });
    remoteRevocationConfirmed = ledgerRevoked && !providerError;
  } catch {
    remoteRevocationConfirmed = false;
  }
  const cookieStore = await cookies();
  const names = new Set([TENH_ACTIVE_BUSINESS_COOKIE, "tenh_session_hint", "tenh_auth_intent", "tenh_recovery_grant", ...cookieStore.getAll()
    .filter(cookie => /^sb-[\w-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/.test(cookie.name))
    .map(cookie => cookie.name)]);
  for (const name of names) cookieStore.set(name, "", {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0,
  });
  return NextResponse.json({ success: remoteRevocationConfirmed, signedOutLocally: true, remoteRevocationConfirmed,
    ...(remoteRevocationConfirmed ? {} : { error: "This browser was signed out, but remote session revocation could not be confirmed." }) },
    { status: remoteRevocationConfirmed ? 200 : 502 });
}
