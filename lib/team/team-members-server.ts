import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export function canManageTeamSettings(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function loadActiveBusinessMembers(
  businessId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      full_name,
      email,
      role,
      profile_picture_url
    `)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(
      `Unable to load team members: ${error.message}`,
    );
  }

  return data ?? [];
}

