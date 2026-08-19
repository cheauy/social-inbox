import "server-only";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TeamMember } from "@/types/inbox";

export async function getTeamMembers(
  businessIds?: string[],
): Promise<TeamMember[]> {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    throw new Error(authResult.error);
  }

  const scopedBusinessIds = Array.from(
    new Set(
      (businessIds?.length
        ? businessIds
        : [authResult.member.business_id]
      )
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );

  if (scopedBusinessIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      business_id,
      full_name,
      email,
      role,
      profile_picture_url
    `)
    .in("business_id", scopedBusinessIds)
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
