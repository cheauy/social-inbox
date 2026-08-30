import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canManageTeamChat,
  getAccessibleRoom,
  safeDetails,
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

  let body: { memberIds?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const submitted = Array.isArray(body.memberIds)
    ? body.memberIds.filter(
        (memberId): memberId is string =>
          typeof memberId === "string",
      )
    : [];

  const requested = Array.from(
    new Set([currentMember.id, ...submitted]),
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
        ...safeDetails(validationError.message),
      },
      { status: 500 },
    );
  }

  const validIds = (validMembers ?? []).map(
    (member) => member.id as string,
  );

  const { data: existingRows, error: existingError } =
    await supabaseAdmin
      .from("team_chat_room_members")
      .select("member_id")
      .eq("room_id", room.id)
      .eq("business_id", currentMember.business_id);

  if (existingError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load current group members.",
        ...safeDetails(existingError.message),
      },
      { status: 500 },
    );
  }

  const existingIds = new Set(
    (existingRows ?? []).map((row) => row.member_id as string),
  );

  const nextIds = new Set(validIds);

  // Diff instead of delete-everything-then-reinsert. The old approach
  // was not atomic (a failed insert wiped the group) and it destroyed
  // every member's last_read_at, resetting unread counts on every save.
  const toRemove = [...existingIds].filter(
    (memberId) => !nextIds.has(memberId),
  );

  const toAdd = [...nextIds].filter(
    (memberId) => !existingIds.has(memberId),
  );

  if (toRemove.length > 0) {
    const { error: removeError } = await supabaseAdmin
      .from("team_chat_room_members")
      .delete()
      .eq("room_id", room.id)
      .eq("business_id", currentMember.business_id)
      .in("member_id", toRemove);

    if (removeError) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to remove group members.",
          ...safeDetails(removeError.message),
        },
        { status: 500 },
      );
    }
  }

  if (toAdd.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from("team_chat_room_members")
      .insert(
        toAdd.map((memberId) => ({
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
          error: "Unable to add group members.",
          ...safeDetails(insertError.message),
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    memberIds: validIds,
    added: toAdd.length,
    removed: toRemove.length,
  });
}
