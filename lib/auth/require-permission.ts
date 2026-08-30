import "server-only";

import { NextResponse } from "next/server";

import {
  getCurrentMember,
  type AuthenticatedMember,
} from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  hasPermission,
  isOwnerRole,
  resolvePermissions,
  type EffectivePermissions,
  type PermissionLevel,
} from "@/lib/auth/permissions";

export type PermissionContext = {
  member: AuthenticatedMember;
  permissions: EffectivePermissions;
  isOwner: boolean;
};

export type PermissionGuardResult =
  | { success: true; context: PermissionContext }
  | { success: false; response: NextResponse };

function deny(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

/**
 * Load the caller's effective permissions. Owners short-circuit to full
 * access without a database read for the overrides column.
 */
export async function loadPermissionContext(): Promise<
  PermissionGuardResult
> {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return {
      success: false,
      response: deny(authResult.error, authResult.status),
    };
  }

  const member = authResult.member;

  if (isOwnerRole(member.role)) {
    return {
      success: true,
      context: {
        member,
        permissions: resolvePermissions("owner", {}),
        isOwner: true,
      },
    };
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("permissions")
    .eq("id", member.id)
    .maybeSingle();

  // If the overrides cannot be read we fall back to role DEFAULTS rather
  // than to full access. A failed lookup must never widen access.
  const stored = error ? {} : (data?.permissions ?? {});

  return {
    success: true,
    context: {
      member,
      permissions: resolvePermissions(member.role, stored),
      isOwner: false,
    },
  };
}

/**
 * Route guard. Returns the caller's context, or a ready-to-return 401/403.
 *
 *   const guard = await requirePermission("tags_quick_replies", "manage");
 *   if (!guard.success) return guard.response;
 *   const { member } = guard.context;
 */
export async function requirePermission(
  key: string,
  level: PermissionLevel = "manage",
): Promise<PermissionGuardResult> {
  const result = await loadPermissionContext();

  if (!result.success) {
    return result;
  }

  if (!hasPermission(result.context.permissions, key, level)) {
    return {
      success: false,
      response: deny(
        "You do not have permission to do that in this workspace.",
        403,
      ),
    };
  }

  return result;
}

/** Owner-only actions that no permission toggle can grant. */
export async function requireOwner(): Promise<PermissionGuardResult> {
  const result = await loadPermissionContext();

  if (!result.success) {
    return result;
  }

  if (!result.context.isOwner) {
    return {
      success: false,
      response: deny(
        "Only the workspace Owner can do that.",
        403,
      ),
    };
  }

  return result;
}

/**
 * Permission check for a route that has ALREADY resolved its member.
 *
 * requirePermission() calls getCurrentMember() itself, so using it after
 * an existing auth block would authenticate twice on every request. This
 * takes the member you already have and only reads the overrides column.
 *
 * Owners short-circuit to allowed, and a failed overrides lookup falls
 * back to role DEFAULTS — never to full access.
 */
export async function memberHasPermission(
  member: Pick<AuthenticatedMember, "id" | "role">,
  key: string,
  level: PermissionLevel = "manage",
): Promise<boolean> {
  if (isOwnerRole(member.role)) {
    return true;
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("permissions")
    .eq("id", member.id)
    .maybeSingle();

  const stored = error ? {} : (data?.permissions ?? {});

  return hasPermission(
    resolvePermissions(member.role, stored),
    key,
    level,
  );
}

/**
 * Ready-made 403 for the member-scoped check above.
 *
 *   if (!(await memberHasPermission(member, "billing_manage"))) {
 *     return permissionDenied("Only ... can change billing.");
 *   }
 */
export function permissionDenied(
  error = "You do not have permission to do that in this workspace.",
) {
  return deny(error, 403);
}
