import { NextRequest, NextResponse } from "next/server";

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

/**
 * Mute or unmute a group for the current member only.
 *
 * Muting hides the unread badge. It deliberately does NOT suppress
 * mentions — @you and @everyone still notify and still play a sound,
 * because muting a busy group should not mean missing a direct ask.
 */
export async function PATCH(
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
  const { roomId } = await context.params;
  const room = await getAccessibleRoom(currentMember, roomId);

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  let body: { muted?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const muted = body.muted === true;

  const { error } = await supabaseAdmin
    .from("team_chat_room_members")
    .upsert(
      {
        room_id: room.id,
        business_id: currentMember.business_id,
        member_id: currentMember.id,
        muted_at: muted ? new Date().toISOString() : null,
      },
      { onConflict: "room_id,member_id" },
    );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to update mute setting.",
        ...safeDetails(error.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, muted });
}
