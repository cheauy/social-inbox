import "server-only";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TeamMember } from "@/types/inbox";

export async function getTeamMembers(): Promise<
  TeamMember[]
> {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    throw new Error(authResult.error);
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      full_name,
      email,
      role,
      profile_picture_url
    `)
    .eq(
      "business_id",
      authResult.member.business_id,
    )
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
