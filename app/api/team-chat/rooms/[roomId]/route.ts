import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canManageTeamChat } from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const currentMember = authResult.member;

  if (!canManageTeamChat(currentMember.role)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Only an owner or admin can delete team groups.",
      },
      {
        status: 403,
      },
    );
  }

  const { roomId } = await context.params;

  if (!roomId?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "Group ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: room,
    error: roomError,
  } = await supabaseAdmin
    .from("team_chat_rooms")
    .select("id,business_id,name,is_general")
    .eq("id", roomId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (roomError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load team group.",
        details: roomError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!room) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Team group was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  if (room.is_general) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The General group cannot be deleted.",
      },
      {
        status: 400,
      },
    );
  }

  const { error: deleteError } =
    await supabaseAdmin
      .from("team_chat_rooms")
      .delete()
      .eq("id", room.id)
      .eq(
        "business_id",
        currentMember.business_id,
      );

  if (deleteError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete team group.",
        details: deleteError.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    deletedRoomId: room.id,
    deletedRoomName: room.name,
  });
}
