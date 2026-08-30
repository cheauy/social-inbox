import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getAccessibleRoom,
  safeDetails,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

export async function POST(
  _request: Request,
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

  const readAt = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("team_chat_room_members")
    .upsert(
      {
        room_id: room.id,
        business_id: currentMember.business_id,
        member_id: currentMember.id,
        last_read_at: readAt,
      },
      { onConflict: "room_id,member_id" },
    );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to update read status.",
        ...safeDetails(error.message),
      },
      { status: 500 },
    );
  }

  // Opening the room also consumes unread group-chat mentions in that room.
  // This keeps the top Group Chat badge in sync for muted rooms, where the
  // badge is mention-only instead of ordinary unread-message count.
  const { error: mentionReadError } = await supabaseAdmin
    .from("team_notifications")
    .update({ is_read: true })
    .eq("business_id", currentMember.business_id)
    .eq("recipient_member_id", currentMember.id)
    .eq("room_id", room.id)
    .eq("is_read", false);

  if (mentionReadError) {
    console.warn(
      "[TENH Team Chat] Unable to clear room mention badge.",
      mentionReadError.message,
    );
  }

  return NextResponse.json({ success: true });
}
