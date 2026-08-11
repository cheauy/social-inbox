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

const MEMBER_SELECT = `
  id,
  user_id,
  business_id,
  full_name,
  email,
  role,
  profile_picture_url,
  is_active
`;

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function reviewerDisplayName(user: User) {
  const metadata = user.user_metadata as
    | Record<string, unknown>
    | undefined;

  const candidates = [
    metadata?.full_name,
    metadata?.name,
    metadata?.display_name,
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.trim().length > 0
    ) {
      return candidate.trim().slice(0, 120);
    }
  }

  const email = normalizeEmail(user.email);
  const emailName = email.split("@")[0]?.trim();

  if (emailName) {
    return emailName.slice(0, 120);
  }

  return "Meta Reviewer";
}

async function loadActiveMember(userId: string) {
  return supabaseAdmin
    .from("team_members")
    .select(MEMBER_SELECT)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
}

/**
 * TEMPORARY META APP REVIEW BRIDGE
 * --------------------------------
 * This does NOT turn normal signups into workspaces.
 * It only provisions the ONE authenticated reviewer account configured with:
 *
 *   TENH_META_REVIEWER_EMAIL
 *   TENH_META_REVIEW_BUSINESS_ID
 *
 * Remove those environment variables after Meta App Review, or keep this helper
 * dormant. Production signup/trial/subscription onboarding should be implemented
 * separately so normal customers receive their own isolated business workspace.
 */
async function provisionMetaReviewer(
  user: User,
): Promise<AuthenticatedMember | null> {
  const configuredEmail = normalizeEmail(
    process.env.TENH_META_REVIEWER_EMAIL,
  );
  const configuredBusinessId =
    process.env.TENH_META_REVIEW_BUSINESS_ID?.trim() ?? "";
  const userEmail = normalizeEmail(user.email);

  if (
    !configuredEmail ||
    !configuredBusinessId ||
    !userEmail ||
    userEmail !== configuredEmail
  ) {
    return null;
  }

  // Never create a reviewer membership for an invalid/nonexistent workspace.
  const {
    data: business,
    error: businessError,
  } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", configuredBusinessId)
    .maybeSingle();

  if (businessError) {
    console.error(
      "Unable to verify Meta review workspace:",
      businessError,
    );
    return null;
  }

  if (!business) {
    console.error(
      "TENH_META_REVIEW_BUSINESS_ID does not match an existing business.",
    );
    return null;
  }

  // If this reviewer user already has a team_members row but it is inactive,
  // reactivate only this explicitly configured reviewer account.
  const {
    data: existingMember,
    error: existingMemberError,
  } = await supabaseAdmin
    .from("team_members")
    .select(MEMBER_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMemberError) {
    console.error(
      "Unable to inspect Meta reviewer membership:",
      existingMemberError,
    );
    return null;
  }

  if (existingMember) {
    const {
      data: reactivated,
      error: reactivateError,
    } = await supabaseAdmin
      .from("team_members")
      .update({
        business_id: configuredBusinessId,
        email: userEmail,
        role: "admin",
        is_active: true,
      })
      .eq("id", existingMember.id)
      .select(MEMBER_SELECT)
      .single();

    if (reactivateError || !reactivated) {
      console.error(
        "Unable to reactivate Meta reviewer membership:",
        reactivateError,
      );
      return null;
    }

    return reactivated as AuthenticatedMember;
  }

  const {
    data: createdMember,
    error: createMemberError,
  } = await supabaseAdmin
    .from("team_members")
    .insert({
      user_id: user.id,
      business_id: configuredBusinessId,
      full_name: reviewerDisplayName(user),
      email: userEmail,
      role: "admin",
      profile_picture_url: null,
      is_active: true,
    })
    .select(MEMBER_SELECT)
    .single();

  if (createMemberError || !createdMember) {
    console.error(
      "Unable to create Meta reviewer membership:",
      createMemberError,
    );
    return null;
  }

  return createdMember as AuthenticatedMember;
}

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

  const {
    data,
    error,
  } = await loadActiveMember(user.id);

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

  if (data) {
    return {
      success: true,
      user,
      member: data as AuthenticatedMember,
    };
  }

  // App-review-only fallback. Normal users are NOT auto-provisioned here.
  const reviewerMember = await provisionMetaReviewer(user);

  if (reviewerMember) {
    return {
      success: true,
      user,
      member: reviewerMember,
    };
  }

  return {
    success: false,
    status: 403,
    error:
      "Your login is not connected to an active team member.",
  };
}