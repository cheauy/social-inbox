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
  params: Promise<{ messageId: string }>;
};

async function loadMessage(
  businessId: string,
  messageId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("team_chat_messages")
    .select("*")
    .eq("id", messageId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

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
  const { messageId } = await context.params;
  const message = await loadMessage(
    currentMember.business_id,
    messageId,
  );

  if (!message) {
    return NextResponse.json(
      { success: false, error: "Team message not found." },
      { status: 404 },
    );
  }

  const room = await getAccessibleRoom(
    currentMember,
    message.room_id,
  );

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  if (message.sender_member_id !== currentMember.id) {
    return NextResponse.json(
      {
        success: false,
        error: "You can only edit your own team messages.",
      },
      { status: 403 },
    );
  }

  let body: { messageText?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const messageText = body.messageText?.trim();

  if (!messageText) {
    return NextResponse.json(
      { success: false, error: "Message cannot be empty." },
      { status: 400 },
    );
  }

  if (messageText.length > 10000) {
    return NextResponse.json(
      {
        success: false,
        error: "Message cannot contain more than 10,000 characters.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  const { data: updated, error } = await supabaseAdmin
    .from("team_chat_messages")
    .update({
      message_text: messageText,
      edited_at: now,
      updated_at: now,
    })
    .eq("id", message.id)
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
        role,
        profile_picture_url
      )
    `)
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to edit team message.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: updated,
  });
}

export async function DELETE(
  _request: NextRequest,
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
  const { messageId } = await context.params;
  const message = await loadMessage(
    currentMember.business_id,
    messageId,
  );

  if (!message) {
    return NextResponse.json(
      { success: true },
    );
  }

  const room = await getAccessibleRoom(
    currentMember,
    message.room_id,
  );

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  const allowed =
    message.sender_member_id === currentMember.id ||
    canManageTeamChat(currentMember.role);

  if (!allowed) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Only the sender, an owner, or an admin can delete this message.",
      },
      { status: 403 },
    );
  }

  const { error } = await supabaseAdmin
    .from("team_chat_messages")
    .delete()
    .eq("id", message.id);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete team message.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
