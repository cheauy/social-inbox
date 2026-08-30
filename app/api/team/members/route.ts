import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { requirePermission } from "@/lib/auth/require-permission";
import { loadActiveBusinessMembers } from "@/lib/team/team-chat-server";

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
