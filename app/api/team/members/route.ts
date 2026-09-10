import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadActiveBusinessMembers } from "@/lib/team/team-chat-server";

const MAX_NAME_LENGTH = 120;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }
  const permissionGuard =
    await requirePermission("team_members", "view");

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  try {
    const members = await loadActiveBusinessMembers(
      authResult.member.business_id,
    );

    return NextResponse.json({
      success: true,
      members,
      currentMember: {
        id: authResult.member.id,
        full_name: authResult.member.full_name,
        role: authResult.member.role,
        profile_picture_url:
          authResult.member.profile_picture_url ?? null,
      },
      businessId: authResult.member.business_id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load team members.",
      },
      { status: 500 },
    );
  }
}

/*
 * The name this workspace's team sees, changed by the person it belongs to.
 *
 * A membership carries its own name -- whatever was typed on the invitation --
 * and it is often wrong: a shop invites "sales2@", the person turns out to be
 * Dara, and every assignment, mention and note in the workspace has been
 * saying sales2@ ever since. The account name is a different thing and is not
 * touched here.
 *
 * Only your own row, deliberately. Renaming a colleague is an admin decision
 * with an audit trail behind it, not something the profile screen should be
 * able to do quietly.
 */
export async function PATCH(request: Request) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  let body: { fullName?: unknown };

  try {
    body = (await request.json()) as { fullName?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  const fullName =
    typeof body.fullName === "string" ? body.fullName.trim() : "";

  if (!fullName) {
    return NextResponse.json(
      { success: false, error: "A display name is required." },
      { status: 400 },
    );
  }

  if (fullName.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      {
        success: false,
        error: `Keep the display name under ${MAX_NAME_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("team_members")
    .update({ full_name: fullName })
    .eq("id", authResult.member.id)
    .eq("business_id", authResult.member.business_id);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to save that name." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, fullName });
}
