import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";

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
export async function POST() {
  const cookieStore = await cookies();

  cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return NextResponse.json({ success: true });
}
