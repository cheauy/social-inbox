import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canManageTeamChat,
  getAccessibleRoom,
  safeDetails,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search team chat messages.
 *
 * With ?roomId= it searches that one room. Without it, it searches every
 * room the caller can actually open — the accessible-room list is built
 * server-side from membership, never from the request, so search can
 * never become a way to read a private room.
 */
export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;
  const params = request.nextUrl.searchParams;

  const query = params.get("q")?.trim() ?? "";
  const roomId = params.get("roomId")?.trim() ?? "";

  if (query.length < 2) {
    return NextResponse.json({
      success: true,
      results: [],
      query,
    });
  }

  const requestedLimit = Number(params.get("limit") ?? "40");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 40;

  let roomIds: string[];

  if (roomId) {
    const room = await getAccessibleRoom(currentMember, roomId);

    if (!room) {
      return NextResponse.json(
        { success: false, error: "Team chat room not found." },
        { status: 404 },
      );
    }

    roomIds = [room.id];
  } else {
    const [{ data: rooms }, { data: memberships }] = await Promise.all([
      supabaseAdmin
        .from("team_chat_rooms")
        .select("id, is_general")
        .eq("business_id", currentMember.business_id)
        .eq("is_active", true),
      supabaseAdmin
        .from("team_chat_room_members")
        .select("room_id")
        .eq("business_id", currentMember.business_id)
        .eq("member_id", currentMember.id),
    ]);

    const mine = new Set(
      (memberships ?? []).map((row) => row.room_id as string),
    );

    const admin = canManageTeamChat(currentMember.role);

    roomIds = (rooms ?? [])
      .filter(
        (room) => room.is_general || admin || mine.has(room.id as string),
      )
      .map((room) => room.id as string);
  }

  if (roomIds.length === 0) {
    return NextResponse.json({ success: true, results: [], query });
  }

  // Escape PostgREST pattern metacharacters so a search for "50%" does
  // not turn into a wildcard.
  const pattern = `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;

  const { data, error } = await supabaseAdmin
    .from("team_chat_messages")
    .select(`
      id,
      room_id,
      sender_member_id,
      message_text,
      created_at,
      sender:team_members!team_chat_messages_sender_member_id_fkey (
        id,
        full_name,
        profile_picture_url
      )
    `)
    .eq("business_id", currentMember.business_id)
    .in("room_id", roomIds)
    .ilike("message_text", pattern)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to search team messages.",
        ...safeDetails(error.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    query,
    results: data ?? [],
  });
}
