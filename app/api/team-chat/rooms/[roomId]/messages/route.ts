import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createTeamMentions } from "@/lib/team/create-team-mentions";
import { getAccessibleRoom } from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

function serverError(
  message: string,
  error: unknown,
) {
  console.error(`[Tenh Team Chat V2.11.1] ${message}`, error);

  return NextResponse.json(
    {
      success: false,
      error: message,
      details:
        error instanceof Error
          ? error.message
          : "Unknown server error.",
    },
    { status: 500 },
  );
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const { roomId } = await context.params;
    const currentMember = authResult.member;
    const room = await getAccessibleRoom(
      currentMember,
      roomId,
    );

    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Team chat room not found.",
        },
        { status: 404 },
      );
    }

    const before =
      request.nextUrl.searchParams.get("before");
    const requestedLimit = Number(
      request.nextUrl.searchParams.get("limit") ?? "60",
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 60;

    let query = supabaseAdmin
      .from("team_chat_messages")
      .select(`
        id,
        business_id,
        room_id,
        sender_member_id,
        message_text,
        edited_at,
        created_at,
        updated_at,
        sender:team_members!team_chat_messages_sender_member_id_fkey (
          id,
          full_name,
          email,
          role,
          profile_picture_url
        )
      `)
      .eq("business_id", currentMember.business_id)
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to load team messages.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      room,
      messages: [...(data ?? [])].reverse(),
      hasMore: (data?.length ?? 0) === limit,
    });
  } catch (error) {
    return serverError(
      "Unable to load team messages.",
      error,
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const { roomId } = await context.params;
    const currentMember = authResult.member;
    const room = await getAccessibleRoom(
      currentMember,
      roomId,
    );

    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Team chat room not found.",
        },
        { status: 404 },
      );
    }

    let body: {
      messageText?: string;
      mentionedMemberIds?: string[];
      mentionEveryone?: boolean;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request.",
        },
        { status: 400 },
      );
    }

    const messageText = body.messageText?.trim();

    if (!messageText) {
      return NextResponse.json(
        {
          success: false,
          error: "Message cannot be empty.",
        },
        { status: 400 },
      );
    }

    if (messageText.length > 10000) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Message cannot contain more than 10,000 characters.",
        },
        { status: 400 },
      );
    }

    const { data: message, error } =
      await supabaseAdmin
        .from("team_chat_messages")
        .insert({
          business_id: currentMember.business_id,
          room_id: room.id,
          sender_member_id: currentMember.id,
          message_text: messageText,
        })
        .select(`
          id,
          business_id,
          room_id,
          sender_member_id,
          message_text,
          edited_at,
          created_at,
          updated_at,
          sender:team_members!team_chat_messages_sender_member_id_fkey (
            id,
            full_name,
            email,
            role,
            profile_picture_url
          )
        `)
        .single();

    if (error || !message) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to send team message.",
          details: error?.message,
        },
        { status: 500 },
      );
    }

    let notificationsCreated = 0;

    try {
      const mentionResult =
        await createTeamMentions({
          businessId: currentMember.business_id,
          actorMemberId: currentMember.id,
          actorName: currentMember.full_name,
          sourceType: "team_message",
          sourceId: message.id,
          mentionedMemberIds:
            body.mentionedMemberIds ?? [],
          mentionEveryone:
            body.mentionEveryone === true,
          roomId: room.id,
          notificationType: "team_chat_mention",
          title: `${currentMember.full_name} mentioned you in #${room.name}`,
          body: messageText.slice(0, 500),
          link: `/dashboard/group-chat?room=${encodeURIComponent(
            room.id,
          )}`,
        });

      notificationsCreated =
        mentionResult.notificationsCreated;
    } catch (mentionError) {
      console.error(
        "Team message sent, but mentions failed:",
        mentionError,
      );
    }

    await supabaseAdmin
      .from("team_chat_room_members")
      .upsert(
        {
          room_id: room.id,
          business_id: currentMember.business_id,
          member_id: currentMember.id,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: "room_id,member_id" },
      );

    return NextResponse.json({
      success: true,
      message,
      notificationsCreated,
    });
  } catch (error) {
    return serverError(
      "Unable to send team message.",
      error,
    );
  }
}
