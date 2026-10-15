import { getTenhAdminIdentityUser } from "@/lib/admin/tenh-admin-auth";
import { validateAuthMutationRequest } from "@/lib/auth/mutation-request";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { checkSessionPolicy } from "@/lib/auth/session-policy";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function settings(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const row = data as { remember_days?: unknown; updated_at?: unknown };
  if (typeof row.remember_days !== "number" || !Number.isInteger(row.remember_days) ||
      row.remember_days < 1 || row.remember_days > 90 || typeof row.updated_at !== "string" ||
      !Number.isFinite(Date.parse(row.updated_at))) return null;
  return { rememberDays: row.remember_days, updatedAt: row.updated_at };
}

export async function GET() {
  const admin = await getTenhAdminIdentityUser();
  if (!admin.success) return json(admin, admin.status);
  const client = await createClient();
  const policy = await checkSessionPolicy(client, admin.user);
  if (!policy.allowed) return json({ success: false, error: "Your session could not be authorized." }, policy.status);
  const { data, error } = await supabaseAdmin.rpc("tenh_get_session_policy_settings");
  const result = settings(data);
  if (error || !result) return json({ success: false, error: "Session settings are unavailable." }, 503);
  return json({ success: true, ...result, requiresMfa: policy.aal !== "aal2" || !policy.recentMfa });
}

export async function PATCH(request: Request) {
  const mutation = validateAuthMutationRequest(request);
  if (!mutation.success) return json(mutation, mutation.status);
  const admin = await getTenhAdminIdentityUser();
  if (!admin.success) return json(admin, admin.status);
  const limited = await consumeAuthRateLimit(request, "admin-session-policy", admin.user.id);
  if (!limited.allowed) return json({ success: false,
    error: limited.unavailable ? "Session settings are temporarily unavailable." : "Too many requests. Try again later.",
  }, limited.unavailable ? 503 : 429, { "Retry-After": String(limited.retryAfterSeconds) });
  const client = await createClient();
  const policy = await checkSessionPolicy(client, admin.user);
  if (!policy.allowed) return json({ success: false, error: "Your session could not be authorized." }, policy.status);
  if (policy.aal !== "aal2") return json({ success: false, code: "mfa_required",
    error: "Verify multi-factor authentication before changing session settings." }, 403);
  if (!policy.recentMfa) return json({ success: false, code: "recent_mfa_required",
    error: "Verify multi-factor authentication again before changing session settings." }, 403);
  let rememberDays: unknown;
  try {
    if (Number(request.headers.get("content-length")) > 1024) throw new Error("Body too large");
    const raw = await request.text();
    if (raw.length > 1024) throw new Error("Body too large");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected object");
    rememberDays = (body as { rememberDays?: unknown }).rememberDays;
  } catch {
    return json({ success: false, error: "Provide a valid session duration." }, 400);
  }
  if (typeof rememberDays !== "number" || !Number.isInteger(rememberDays) || rememberDays < 1 || rememberDays > 90) {
    return json({ success: false, error: "Session duration must be a whole number from 1 to 90 days." }, 400);
  }
  // Actor comes from server-verified identity, never from the request body.
  const { data, error } = await supabaseAdmin.rpc("tenh_set_session_policy_settings", {
    p_remember_days: rememberDays, p_actor_user_id: admin.user.id,
  });
  const result = settings(data);
  if (error || !result) return json({ success: false, error: "Session settings could not be saved." }, 503);
  return json({ success: true, ...result });
}
