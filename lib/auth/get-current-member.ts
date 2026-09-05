import "server-only";

import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Membership lookups resolve at most one row on purpose.
 *
 * A user can end up with more than one team_members row for the same
 * business — being removed and re-invited is the usual way. maybeSingle()
 * rejects multiple rows, so without limit(1) a duplicate membership stops
 * the whole dashboard from loading rather than degrading. Ordering puts any
 * active row first, then the newest, so the row chosen is the one that
 * reflects the member's current access.
 */
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
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
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

/*
 * Subscription states that make a workspace unusable. Opening one shows the
 * locked screen and nothing else, so it is the last thing to land on by
 * default. Mirrors LOCKED_STATUSES in get-business-entitlements.
 */
const LOCKED_SUBSCRIPTION_STATUSES = new Set([
  "past_due",
  "expired",
  "suspended",
  "cancelled",
]);

/**
 * Which of these workspaces can actually be opened.
 *
 * A workspace with no subscription row is treated as usable: legacy unmanaged
 * workspaces have never had one, and they are not locked.
 */
async function loadUsableBusinessIds(
  businessIds: string[],
): Promise<Set<string>> {
  const unique = Array.from(
    new Set(businessIds.filter(Boolean)),
  );

  if (unique.length === 0) {
    return new Set();
  }

  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select("business_id,status")
    .in("business_id", unique);

  if (error) {
    /*
     * Never block sign-in over this. Without the statuses the choice below
     * falls back to the old owner-first ordering, which is where it started.
     */
    console.error(
      "Unable to load subscription states for workspace selection:",
      error,
    );

    return new Set(unique);
  }

  const locked = new Set(
    ((data ?? []) as {
      business_id: string;
      status: string | null;
    }[])
      .filter((row) =>
        LOCKED_SUBSCRIPTION_STATUSES.has(
          row.status ?? "",
        ),
      )
      .map((row) => row.business_id),
  );

  return new Set(
    unique.filter((id) => !locked.has(id)),
  );
}

/*
 * Pick the workspace to open when nothing was saved.
 *
 * Memberships arrive oldest first, so owner-first alone handed the user their
 * very first workspace -- for anyone who trialled before buying or joining, an
 * expired trial. They then met the locked screen on every fresh sign-in, with
 * their working workspace one switch away and no sign of it.
 *
 * A workspace that can be opened now beats one that cannot; within each group
 * the old owner-first, oldest-first order stands. Everything locked still
 * resolves to the same workspace as before, so a customer with nothing but an
 * expired subscription still lands there and can renew.
 */
async function chooseMember(
  members: AuthenticatedMember[],
) {
  if (members.length === 0) {
    return null;
  }

  const usable = await loadUsableBusinessIds(
    members.map((member) => member.business_id),
  );

  const preferred = members.filter((member) =>
    usable.has(member.business_id),
  );

  const pool =
    preferred.length > 0 ? preferred : members;

  return (
    pool.find(
      (member) => member.role === "owner",
    ) ??
    pool[0] ??
    null
  );
}

/**
 * Which workspace should be active for this user at sign-in.
 *
 * A saved selection is kept only when that workspace can still be opened.
 * Honouring it unconditionally sounds respectful and is not: the value sitting
 * in the cookie is often one nobody chose -- sign-in used to overwrite it with
 * the user's oldest workspace -- so a stale pointer at an expired trial would
 * survive every attempt to move past it, and the user would meet the locked
 * screen on every login with no way to break the cycle.
 *
 * A switch made during a session still wins, because that workspace is
 * reachable and stays reachable. Only a locked one is passed over, and only
 * when something better exists: a user whose workspaces are all expired still
 * lands on one and can renew it.
 *
 * Returns null only when the user has no active membership at all.
 */
export async function resolveActiveWorkspaceSelection(
  userId: string,
  savedBusinessId: string,
): Promise<string | null> {
  const { data, error } = await loadActiveMembers(userId);

  if (error) {
    console.error(
      "Unable to load memberships while resolving workspace selection:",
      error,
    );

    return null;
  }

  const members = (data ?? []) as AuthenticatedMember[];

  if (members.length === 0) {
    return null;
  }

  if (
    savedBusinessId &&
    members.some(
      (member) =>
        member.business_id === savedBusinessId,
    )
  ) {
    const usable = await loadUsableBusinessIds(
      members.map(
        (member) => member.business_id,
      ),
    );

    if (
      usable.has(savedBusinessId) ||
      usable.size === 0
    ) {
      return savedBusinessId;
    }
  }

  const member = await chooseMember(members);

  return member?.business_id ?? null;
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
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
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
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
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
    const member = await chooseMember(activeMembers);

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
