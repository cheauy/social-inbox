import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type AuthenticatedMember = {
  id: string;
  user_id: string;
  business_id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
  is_active: boolean;
};

type GetCurrentMemberResult =
  | {
      success: true;
      user: User;
      member: AuthenticatedMember;
    }
  | {
      success: false;
      status: 401 | 403 | 500;
      error: string;
    };

export async function getCurrentMember(): Promise<
  GetCurrentMemberResult
> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      success: false,
      status: 401,
      error: "Unauthorized.",
    };
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      user_id,
      business_id,
      full_name,
      email,
      role,
      profile_picture_url,
      is_active
    `)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(
      "Unable to load current team member:",
      error,
    );

    return {
      success: false,
      status: 500,
      error: "Unable to load your team member account.",
    };
  }

  if (!data) {
    return {
      success: false,
      status: 403,
      error:
        "Your login is not connected to an active team member.",
    };
  }

  return {
    success: true,
    user,
    member: data as AuthenticatedMember,
  };
}