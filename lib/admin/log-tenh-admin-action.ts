import "server-only";

import type { User } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";

type LogTenhAdminActionInput = {
  user: User;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Best-effort security audit trail.
 * Never include API keys, access tokens, passwords, or raw payment credentials.
 */
export async function logTenhAdminAction({
  user,
  action,
  resourceType,
  resourceId = null,
  metadata = {},
}: LogTenhAdminActionInput) {
  const { error } = await supabaseAdmin
    .from("tenh_admin_audit_logs")
    .insert({
      admin_user_id: user.id,
      admin_email: user.email?.trim().toLowerCase() ?? "unknown",
      action: action.slice(0, 120),
      resource_type: resourceType.slice(0, 120),
      resource_id: resourceId?.slice(0, 200) ?? null,
      metadata,
    });

  if (error) {
    // Do not break the customer's completed billing/support action if audit
    // storage is temporarily unavailable, but surface it in server logs.
    console.error(
      "[TENH Admin Security] Unable to write admin audit log:",
      error.message,
    );
  }
}
