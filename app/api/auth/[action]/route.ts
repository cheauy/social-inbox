import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { consumeAuthRateLimit, type AuthRateLimitAction } from "@/lib/auth/rate-limit";
import { bindSessionPolicy, checkSessionPolicy, revokeSessionPolicies } from "@/lib/auth/session-policy";
import { signAuthTicket, verifyAuthTicket } from "@/lib/auth/auth-ticket";
import { safeAuthReturnPath } from "@/lib/auth/return-path";
import { isTerminalAuthSessionError } from "@/lib/auth/session-errors";
import { AUTH_INTENT_COOKIE, AUTH_RECOVERY_COOKIE, authJson, clearAuthSessionCookies, completeAuthenticatedLogin, passwordInputError, setAuthSessionCookies } from "@/lib/auth/auth-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
const emailValid = (value: unknown): value is string => typeof value === "string" && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const emailValue = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
function authServiceUnavailable(error: { status?: number; name?: string } | null) {
  return Boolean(error && (error.status === 429 || (error.status ?? 0) >= 500 ||
    error.name?.includes("Retryable") || error.name === "AuthUnknownError"));
}

async function recoveryAuthorization() {
  const client = await createClient({ allowRecovery: true });
  const { data: { user }, error } = await client.auth.getUser();
  if (error && !isTerminalAuthSessionError(error)) throw new Error("Recovery validation unavailable");
  if (error || !user) return null;
  const policy = await checkSessionPolicy(client, user, { allowRecovery: true });
  if (!policy.allowed && policy.status === 503) throw new Error("Recovery validation unavailable");
  const grant = verifyAuthTicket((await cookies()).get(AUTH_RECOVERY_COOKIE)?.value, "recovery");
  if (!policy.allowed || policy.kind !== "recovery" || grant?.userId !== user.id || grant.sessionId !== policy.sessionId ||
      typeof grant.expiresAt !== "number" || grant.expiresAt <= Date.now()) return null;
  return { client, user, policy };
}

export async function GET(_request: Request, { params }: Context) {
  const { action } = await params;
  try {
    if (action === "policy") {
      const { data, error } = await supabaseAdmin.rpc("tenh_get_session_policy_settings");
      if (error || !Number.isInteger(data?.remember_days) || data.remember_days < 1 || data.remember_days > 90) return authJson({ success: false, error: "Login settings are temporarily unavailable." }, 503);
      return authJson({ success: true, rememberDays: data.remember_days });
    }
    if (action === "recovery-status") return await recoveryAuthorization()
      ? authJson({ success: true, valid: true }) : authJson({ success: false, valid: false, error: "This reset link is invalid, expired or already used." }, 410);
    if (action === "session") {
      const client = await createClient({ authFlow: true });
      const { data: { user }, error } = await client.auth.getUser();
      if (error && !isTerminalAuthSessionError(error)) return authJson({ success: false, error: "Unable to validate your session. Try again." }, 503);
      if (error || !user) return authJson({ success: false, error: "Your session expired. Please sign in again." }, 401);
      const policy = await checkSessionPolicy(client, user);
      if (!policy.allowed) return authJson({ success: false, code: policy.reason, error: policy.status === 503 ? "Unable to validate your session. Try again." : "Your session expired. Please sign in again." }, policy.status);
      return authJson({ success: true, userId: user.id, sessionId: policy.sessionId, kind: policy.kind, expiresAt: policy.expiresAt, remembered: policy.remembered, serverTime: new Date().toISOString() });
    }
    return authJson({ success: false, error: "Not found." }, 404);
  } catch { return authJson({ success: false, error: "Authentication is temporarily unavailable." }, 503); }
}

export async function POST(request: Request, { params }: Context) {
  const { action } = await params;
  const actions: Record<string, AuthRateLimitAction> = { login: "login", oauth: "oauth", recover: "recover", resend: "resend", confirm: "confirm", "reset-password": "reset-password" };
  if (!actions[action]) return authJson({ success: false, error: "Not found." }, 404);
  const validation = validateAuthMutationRequest(request);
  if (!validation.success) return authJson({ success: false, code: validation.code, error: validation.error }, validation.status);
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return authJson({ success: false, error: "Invalid request." }, 400);
    const email = emailValue(body.email);
    const limit = await consumeAuthRateLimit(request, actions[action], email || undefined);
    if (!limit.allowed) return authJson({ success: false, error: limit.unavailable ? "Authentication is temporarily unavailable." : "Too many attempts. Try again later." }, limit.unavailable ? 503 : 429, { "Retry-After": String(limit.retryAfterSeconds) });
    const origin = new URL(request.url).origin;
    const next = safeAuthReturnPath(body.next, origin);

    if (action === "login") {
      if (!emailValid(email) || typeof body.password !== "string" || !body.password || body.password.length > 128 || typeof body.rememberMe !== "boolean") return authJson({ success: false, error: "Check your email and password." }, 400);
      const client = await createClient({ authFlow: true });
      const { data, error } = await client.auth.signInWithPassword({ email, password: body.password });
      if (error?.status === 429 || error?.code === "over_request_rate_limit") return authJson({ success: false, code: "AUTH_RATE_LIMITED", error: "Too many sign-in attempts. Wait and try again." }, 429);
      if (error && (authServiceUnavailable(error) || ["request_timeout", "unexpected_failure", "hook_timeout", "hook_timeout_after_retry"].includes(error.code ?? ""))) return authJson({ success: false, code: "AUTH_UNAVAILABLE", error: "Sign-in is temporarily unavailable. Please try again." }, 503);
      if (error) {
        // Keep unknown-email and account-confirmation states indistinguishable from invalid credentials.
        const credentials = ["invalid_credentials", "user_not_found", "email_not_confirmed", "user_banned"].includes(error.code ?? "");
        return authJson({ success: false, code: credentials ? "AUTH_INVALID_CREDENTIALS" : "AUTH_LOGIN_FAILED", error: credentials ? "Incorrect email or password. Please try again." : "Unable to sign in. Please try again or use another sign-in method." }, 400);
      }
      if (!data.user || !data.session) return authJson({ success: false, code: "AUTH_UNAVAILABLE", error: "Sign-in is temporarily unavailable. Please try again." }, 503);
      if (!data.user.email_confirmed_at) return authJson({ success: false, code: "AUTH_INVALID_CREDENTIALS", error: "Incorrect email or password. Please try again." }, 400);
      const policy = await bindSessionPolicy(client, data.user, body.rememberMe);
      if (!policy.allowed) { await clearAuthSessionCookies(); return authJson({ success: false, error: "Unable to start a secure session. Try again." }, 503); }
      await setAuthSessionCookies(policy);
      const redirect = await completeAuthenticatedLogin(data.user, request, next);
      return authJson({ success: true, redirect });
    }
    if (action === "oauth") {
      if (!["google", "facebook"].includes(String(body.provider)) || typeof body.rememberMe !== "boolean") return authJson({ success: false, error: "Choose a supported sign-in method." }, 400);
      const nonce = randomUUID();
      const store = await cookies();
      store.set(AUTH_INTENT_COOKIE, signAuthTicket({ nonce, next, rememberMe: body.rememberMe, issuedAt: Date.now(), provider: body.provider }, "oauth"), {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600,
      });
      const client = await createClient({ authFlow: true });
      const { data, error } = await client.auth.signInWithOAuth({ provider: body.provider as "google" | "facebook", options: {
        redirectTo: `${origin}/auth/callback?intent=${encodeURIComponent(nonce)}`, skipBrowserRedirect: true,
        ...(body.provider === "facebook" ? { scopes: "email,public_profile" } : {}),
      } });
      if (error || !data.url || new URL(data.url).protocol !== "https:") return authJson({ success: false, error: "Unable to start sign-in. Try again." }, 503);
      return authJson({ success: true, url: data.url });
    }
    if (action === "recover" || action === "resend") {
      if (!emailValid(email)) return authJson({ success: false, error: "Enter a valid email address." }, 400);
      const client = await createClient({ authFlow: true });
      const response = action === "recover" ? await client.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/recovery` })
        : await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` } });
      // Account-dependent provider errors share the same response as a missing/existing account.
      if (response.error && (response.error.status ?? 0) >= 500) return authJson({ success: false, error: "Email service is temporarily unavailable. Try again later." }, 503);
      return authJson({ success: true, message: action === "recover" ? "If recovery is available, check your email." : "If confirmation is needed, check your email." });
    }
    if (action === "confirm") {
      if (!emailValid(email) || typeof body.token !== "string" || !body.token.trim() || body.token.length > 256) return authJson({ success: false, error: "Enter the code from your confirmation email." }, 400);
      const client = await createClient({ authFlow: true });
      const { data, error } = await client.auth.verifyOtp({ email, token: body.token.trim(), type: "email" });
      if (error || !data.user?.email_confirmed_at) return authJson({ success: false, error: "This confirmation code is invalid, expired or already used." }, 400);
      // Confirmation verifies the address; password/OAuth sign-in establishes the application session.
      await client.auth.signOut({ scope: "local" });
      await clearAuthSessionCookies();
      return authJson({ success: true, redirect: `/login?confirmed=1&next=${encodeURIComponent(next)}` });
    }
    const authorized = await recoveryAuthorization();
    if (!authorized) return authJson({ success: false, error: "This reset link is invalid, expired or already used." }, 410);
    const passwordError = passwordInputError(body.password, body.confirmPassword);
    if (passwordError) return authJson({ success: false, error: passwordError }, 400);
    const claimed = await supabaseAdmin.rpc("tenh_claim_recovery_session", { p_user_id: authorized.user.id, p_session_id: authorized.policy.sessionId });
    if (claimed.error || claimed.data !== true) return authJson({ success: false, error: "This reset link is unavailable or already used. Request a new link." }, claimed.error ? 503 : 410);
    let updateFailed = false;
    try {
      const updated = await authorized.client.auth.updateUser({ password: body.password as string });
      if (authServiceUnavailable(updated.error)) throw new Error("Password outcome unavailable");
      updateFailed = Boolean(updated.error);
    } catch {
      // A lost response cannot prove the password stayed unchanged.
      await revokeSessionPolicies(authorized.user, null);
      await authorized.client.auth.signOut({ scope: "global" }).catch(() => null);
      await clearAuthSessionCookies();
      return authJson({ success: false, code: "RESET_OUTCOME_UNCERTAIN", error: "Password reset could not be confirmed. Sign in or request a new link." }, 503);
    }
    if (updateFailed) {
      await clearAuthSessionCookies();
      return authJson({ success: false, error: "Password was not confirmed. Request a new reset link." }, 400);
    }
    const ledgerRevoked = await revokeSessionPolicies(authorized.user, null);
    const remote = await authorized.client.auth.signOut({ scope: "global" }).catch(() => ({ error: true }));
    await clearAuthSessionCookies();
    return authJson({ success: true, redirect: "/login?reset=complete", revocationPending: !ledgerRevoked || Boolean(remote.error) });
  } catch { return authJson({ success: false, error: "Authentication is temporarily unavailable. Try again." }, 503); }
}
