import "server-only";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Billing follows active ownership, independently of the selected workspace. */
export async function getBillingOwnerAccess() {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return { success: false as const, status: 401, error: "Sign in to view billing." };
  const memberships = await supabaseAdmin.from("team_members").select("business_id")
    .eq("user_id", user.id).eq("role", "owner").eq("is_active", true);
  if (memberships.error) return { success: false as const, status: 500, error: "Billing is temporarily unavailable." };
  const businessIds = [...new Set((memberships.data ?? []).map(row => String(row.business_id)).filter(Boolean))];
  return { success: true as const, businessIds };
}
