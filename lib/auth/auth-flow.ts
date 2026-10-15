import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { TENH_ACTIVE_BUSINESS_COOKIE, resolveActiveWorkspaceSelection } from "@/lib/auth/get-current-member";
import { provisionUserWorkspace } from "@/lib/onboarding/ensure-user-workspace";
import { signAuthTicket } from "./auth-ticket";
import { safeAuthReturnPath } from "./return-path";
import { SESSION_HINT_COOKIE, isSupabaseAuthCookie, sessionCookiePersistence } from "./session-cookie-options";
import type { SessionPolicyResult } from "./session-policy";

export const AUTH_NO_STORE = { "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache", Expires: "0", Vary: "Cookie, Origin" };
export const AUTH_INTENT_COOKIE = "tenh_auth_intent";
export const AUTH_RECOVERY_COOKIE = "tenh_recovery_grant";
export function authJson(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...AUTH_NO_STORE, ...headers } });
}
export function passwordInputError(password: unknown, confirmation: unknown) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use 8–128 characters with letters and numbers.";
  return password !== confirmation ? "Passwords do not match." : null;
}
export async function setAuthSessionCookies(policy: SessionPolicyResult) {
  if (!policy.allowed || !policy.expiresAt || policy.remembered === null) throw new Error("Session policy is unavailable.");
  const store = await cookies();
  const hint = { remembered: policy.remembered, expiresAt: policy.expiresAt, sessionId: policy.sessionId };
  const options = { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", ...sessionCookiePersistence(hint) };
  store.set(SESSION_HINT_COOKIE, signAuthTicket(hint, "persistence"), options);
  for (const cookie of store.getAll()) if (isSupabaseAuthCookie(cookie.name)) store.set(cookie.name, cookie.value, options);
}
export async function clearAuthSessionCookies() {
  const store = await cookies();
  for (const cookie of store.getAll()) if (isSupabaseAuthCookie(cookie.name) || [SESSION_HINT_COOKIE, AUTH_INTENT_COOKIE, AUTH_RECOVERY_COOKIE, TENH_ACTIVE_BUSINESS_COOKIE].includes(cookie.name)) {
    store.set(cookie.name, "", { path: "/", maxAge: 0, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
}
export async function completeAuthenticatedLogin(user: User, request: Request, next: unknown) {
  if (!user.email_confirmed_at) throw new Error("Verify your email before signing in.");
  const safe = safeAuthReturnPath(next, new URL(request.url).origin);
  if (safe.startsWith("/invite/accept")) return safe;
  const provision = await provisionUserWorkspace(user, request);
  if (!provision.success) throw new Error("Unable to prepare your workspace. Try signing in again.");
  const store = await cookies();
  const saved = store.get(TENH_ACTIVE_BUSINESS_COOKIE)?.value ?? "";
  const businessId = provision.trialGranted ? provision.member.business_id
    : await resolveActiveWorkspaceSelection(user.id, saved) ?? provision.member.business_id;
  store.set(TENH_ACTIVE_BUSINESS_COOKIE, businessId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  return provision.trialGranted === false && safe === "/dashboard/inbox" ? "/dashboard/subscription/buy?trial=not-eligible" : safe;
}
