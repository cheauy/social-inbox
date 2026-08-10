import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canManageTeamChat,
  getAccessibleRoom,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;

  if (!canManageTeamChat(currentMember.role)) {
    return NextResponse.json(
      {
        success: false,
        error: "Only an owner or admin can manage group members.",
      },
      { status: 403 },
    );
  }

  const { roomId } = await context.params;
  const room = await getAccessibleRoom(
    currentMember,
    roomId,
  );

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  if (room.is_general) {
    return NextResponse.json(
      {
        success: false,
        error:
          "General automatically includes every active team member.",
      },
      { status: 400 },
    );
  }

  let body: { memberIds?: string[] };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const requested = Array.from(
    new Set([
      currentMember.id,
      ...(body.memberIds ?? []),
    ]),
  );

  const { data: validMembers, error: validationError } =
    await supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("business_id", currentMember.business_id)
      .eq("is_active", true)
      .in("id", requested);

  if (validationError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to validate group members.",
        details: validationError.message,
      },
      { status: 500 },
    );
  }

  const validIds = (validMembers ?? []).map(
    (member) => member.id,
  );

  const { error: deleteError } = await supabaseAdmin
    .from("team_chat_room_members")
    .delete()
    .eq("room_id", room.id);

  if (deleteError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to update group members.",
        details: deleteError.message,
      },
      { status: 500 },
    );
  }

  if (validIds.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from("team_chat_room_members")
      .insert(
        validIds.map((memberId) => ({
          room_id: room.id,
          business_id: currentMember.business_id,
          member_id: memberId,
          last_read_at:
            memberId === currentMember.id
              ? new Date().toISOString()
              : null,
        })),
      );

    if (insertError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Group membership was cleared but could not be rebuilt. Please save members again.",
          details: insertError.message,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    memberIds: validIds,
  });
}
