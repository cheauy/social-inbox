import "server-only";

import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const TENH_ACTIVE_BUSINESS_COOKIE = "tenh_active_business_id";

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

export type WorkspaceAccessNotice = {
  type: "workspace_access_removed";
  businessId: string;
};

export type WorkspaceAccessErrorCode =
  | "WORKSPACE_ACCESS_REMOVED"
  | "WORKSPACE_SETUP_REQUIRED";

type GetCurrentMemberResult =
  | {
      success: true;
      user: User;
      member: AuthenticatedMember;
      accessNotice?: WorkspaceAccessNotice;
    }
  | {
      success: false;
      status: 401 | 403 | 500;
      error: string;
      code?: WorkspaceAccessErrorCode;
      businessId?: string;
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
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const candidates = [metadata?.full_name, metadata?.name, metadata?.display_name];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 120);
    }
  }

  return normalizeEmail(user.email).split("@")[0]?.slice(0, 120) || "Meta Reviewer";
}

async function loadActiveMembers(userId: string) {
  return supabaseAdmin
    .from("team_members")
    .select(MEMBER_SELECT)
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
}

async function hasRemovedWorkspaceAccess(
  userId: string,
  businessId: string,
) {
  if (!businessId) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("id,is_active")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    console.error(
      "Unable to verify removed workspace access:",
      error,
    );
    return false;
  }

  return Boolean(data && data.is_active === false);
}

function chooseMember(
  members: AuthenticatedMember[],
) {
  // Only choose a default when there is no saved workspace selection.
  return members.find((member) => member.role === "owner") ?? members[0] ?? null;
}

/** Temporary Meta App Review bridge. It stays isolated to the configured review workspace. */
async function provisionMetaReviewer(user: User): Promise<AuthenticatedMember | null> {
  const configuredEmail = normalizeEmail(process.env.TENH_META_REVIEWER_EMAIL);
  const configuredBusinessId = process.env.TENH_META_REVIEW_BUSINESS_ID?.trim() ?? "";
  const userEmail = normalizeEmail(user.email);

  if (!configuredEmail || !configuredBusinessId || !userEmail || userEmail !== configuredEmail) {
    return null;
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", configuredBusinessId)
    .maybeSingle();

  if (businessError || !business) {
    console.error("Unable to verify Meta review workspace:", businessError);
    return null;
  }

  const { data: exactMember, error: exactMemberError } = await supabaseAdmin
    .from("team_members")
    .select(MEMBER_SELECT)
    .eq("user_id", user.id)
    .eq("business_id", configuredBusinessId)
    .maybeSingle();

  if (exactMemberError) {
    console.error("Unable to inspect Meta reviewer membership:", exactMemberError);
    return null;
  }

  if (exactMember) {
    if (exactMember.is_active) return exactMember as AuthenticatedMember;

    const { data: reactivated, error: reactivateError } = await supabaseAdmin
      .from("team_members")
      .update({ email: userEmail, role: "admin", is_active: true })
      .eq("id", exactMember.id)
      .select(MEMBER_SELECT)
      .single();

    if (reactivateError || !reactivated) {
      console.error("Unable to reactivate Meta reviewer membership:", reactivateError);
      return null;
    }

    return reactivated as AuthenticatedMember;
  }

  const { data: createdMember, error: createMemberError } = await supabaseAdmin
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
    console.error("Unable to create Meta reviewer membership:", createMemberError);
    return null;
  }

  return createdMember as AuthenticatedMember;
}

export async function getCurrentMember(): Promise<GetCurrentMemberResult> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, status: 401, error: "Unauthorized." };
  }

  const cookieStore = await cookies();
  const requestedBusinessId =
    cookieStore
      .get(TENH_ACTIVE_BUSINESS_COOKIE)
      ?.value?.trim() ?? "";

  /*
   * Never silently move a user to another subscription.
   *
   * If a saved workspace exists, TENH must honor that selection. When the
   * membership was removed or deactivated, return an explicit 403 instead
   * of choosing another active membership behind the user's back.
   */
  if (requestedBusinessId) {
    const {
      data: requestedMember,
      error: requestedMemberError,
    } = await supabaseAdmin
      .from("team_members")
      .select(MEMBER_SELECT)
      .eq("user_id", user.id)
      .eq("business_id", requestedBusinessId)
      .maybeSingle();

    if (requestedMemberError) {
      console.error(
        "Unable to verify selected workspace membership:",
        requestedMemberError,
      );

      return {
        success: false,
        status: 500,
        error: "Unable to verify your selected TENH subscription.",
      };
    }

    if (requestedMember) {
      const member = requestedMember as AuthenticatedMember;

      if (member.is_active) {
        return {
          success: true,
          user,
          member,
        };
      }

      return {
        success: false,
        status: 403,
        code: "WORKSPACE_ACCESS_REMOVED",
        businessId: requestedBusinessId,
        error:
          "You no longer have access to this subscription. An Owner may have removed your access. Your TENH account and any other subscriptions are unchanged.",
      };
    }

    // No membership row exists for the saved workspace. Treat this as a
    // stale selection (for example another account previously used this
    // browser), not as proof that an Owner removed access. Continue below
    // and resolve one of this user's own active memberships.
  }

  const { data, error } = await loadActiveMembers(user.id);

  if (error) {
    console.error("Unable to load current team memberships:", error);
    return {
      success: false,
      status: 500,
      error: "Unable to load your team member account.",
    };
  }

  const activeMembers = (data ?? []) as AuthenticatedMember[];

  if (activeMembers.length > 0) {
    const member = chooseMember(activeMembers);

    if (member) {
      return {
        success: true,
        user,
        member,
      };
    }
  }

  const reviewerMember = await provisionMetaReviewer(user);
  if (reviewerMember) {
    return { success: true, user, member: reviewerMember };
  }

  return {
    success: false,
    status: 403,
    code: "WORKSPACE_SETUP_REQUIRED",
    businessId: requestedBusinessId || undefined,
    error:
      "TENH could not find an active workspace for this account yet. If this is a new account, setup will be completed safely before Inbox opens.",
  };
}
