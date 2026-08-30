import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  loadPermissionContext,
  requirePermission,
} from "@/lib/auth/require-permission";
import {
  PERMISSION_GROUPS,
  isOwnerRole,
  resolvePermissions,
  sanitizePermissionInput,
} from "@/lib/auth/permissions";
import { resolveTeamProfilePictures } from "@/lib/team/resolve-team-profile-pictures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemberRow = {
  id: string;
  user_id: string | null;
  role: string;
  is_active: boolean | null;
  full_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  permissions: unknown;
};

/**
 * GET — the permission catalog plus every member's effective permissions.
 * Requires at least "view" on roles_permissions.
 */
export async function GET() {
  const guard = await requirePermission("roles_permissions", "view");

  if (!guard.success) {
    return guard.response;
  }

  const { member, isOwner, permissions } = guard.context;

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("id, user_id, role, is_active, full_name, email, profile_picture_url, permissions")
    .eq("business_id", member.business_id)
    .order("role", { ascending: true });

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to load workspace members." },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as MemberRow[];
  const profilePictures = await resolveTeamProfilePictures(rows);

  return NextResponse.json({
    success: true,
    canManage: permissions.roles_permissions === "manage",
    isOwner,
    currentMemberId: member.id,
    groups: PERMISSION_GROUPS,
    members: rows.map((row) => ({
      id: row.id,
      role: row.role,
      isActive: row.is_active !== false,
      isOwner: isOwnerRole(row.role),
      fullName: row.full_name,
      email: row.email,
      profilePictureUrl: profilePictures.get(row.id) ?? row.profile_picture_url ?? null,
      hasOverrides:
        row.permissions !== null &&
        typeof row.permissions === "object" &&
        Object.keys(row.permissions as object).length > 0,
      permissions: resolvePermissions(row.role, row.permissions),
    })),
  });
}

type UpdateBody = {
  memberId?: unknown;
  permissions?: unknown;
  reset?: unknown;
};

/**
 * PUT — write one member's overrides. Requires "manage" on
 * roles_permissions, which only an Owner has by default.
 */
export async function PUT(request: NextRequest) {
  const guard = await requirePermission("roles_permissions", "manage");

  if (!guard.success) {
    return guard.response;
  }

  const { member } = guard.context;

  let body: UpdateBody;

  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const memberId =
    typeof body.memberId === "string" ? body.memberId.trim() : "";

  if (!memberId) {
    return NextResponse.json(
      { success: false, error: "A memberId is required." },
      { status: 400 },
    );
  }

  // Scoping the lookup to the caller's own workspace is the security
  // boundary — a memberId from another business simply will not match.
  const { data: target, error: targetError } = await supabaseAdmin
    .from("team_members")
    .select("id, role, business_id")
    .eq("id", memberId)
    .eq("business_id", member.business_id)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json(
      { success: false, error: "That member is not in this workspace." },
      { status: 404 },
    );
  }

  if (isOwnerRole(target.role)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The Owner always has full access and cannot be restricted.",
      },
      { status: 400 },
    );
  }

  if (target.id === member.id) {
    return NextResponse.json(
      {
        success: false,
        error: "You cannot change your own permissions.",
      },
      { status: 400 },
    );
  }

  const nextPermissions =
    body.reset === true ? null : sanitizePermissionInput(body.permissions);

  const { error: updateError } = await supabaseAdmin
    .from("team_members")
    .update({ permissions: nextPermissions })
    .eq("id", target.id)
    .eq("business_id", member.business_id);

  if (updateError) {
    return NextResponse.json(
      { success: false, error: "Unable to save those permissions." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    memberId: target.id,
    permissions: resolvePermissions(target.role, nextPermissions),
    hasOverrides: nextPermissions !== null,
  });
}

/** Convenience for the current user's own effective permissions. */
export async function POST() {
  const result = await loadPermissionContext();

  if (!result.success) {
    return result.response;
  }

  return NextResponse.json({
    success: true,
    isOwner: result.context.isOwner,
    permissions: result.context.permissions,
  });
}
