import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TeamMember } from "@/types/inbox";

export async function getTeamMembers(): Promise<
  TeamMember[]
> {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      full_name,
      email,
      role
    `)
    .eq("is_active", true)
    .order("full_name", {
      ascending: true,
    });

  if (error) {
    console.error(
      "Unable to load team members:",
      error,
    );

    throw new Error(
      "Unable to load team members.",
    );
  }

  return (data ?? []) as TeamMember[];
}