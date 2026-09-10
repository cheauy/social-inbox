import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canManageTeamChat,
  getAccessibleRoom,
  loadAttachmentsForMessages,
  safeDetails,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DELETED_MESSAGE_PREFIX = "__TENH_DELETED_BY__:";

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

  if (String(message.message_text ?? "").startsWith(DELETED_MESSAGE_PREFIX)) {
    return NextResponse.json(
      { success: false, error: "A deleted message cannot be edited." },
      { status: 409 },
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
        email,
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
        ...safeDetails(error.message),
      },
      { status: 500 },
    );
  }

  const attachmentsByMessage = await loadAttachmentsForMessages([
    updated.id as string,
  ]);

  return NextResponse.json({
    success: true,
    message: {
      ...updated,
      attachments: attachmentsByMessage.get(updated.id as string) ?? [],
    },
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

  if (String(message.message_text ?? "").startsWith(DELETED_MESSAGE_PREFIX)) {
    return NextResponse.json({ success: true, message });
  }

  // Keep a lightweight tombstone instead of physically removing the row.
  // Everyone then sees who deleted it after realtime/reload, while the
  // original attachment bytes are removed from private storage.
  const { data: attachments } = await supabaseAdmin
    .from("team_chat_attachments")
    .select("id, storage_path")
    .eq("message_id", message.id)
    .eq("business_id", currentMember.business_id);

  const storagePaths = (attachments ?? [])
    .map((item) => item.storage_path as string | null)
    .filter((value): value is string => Boolean(value));

  if (storagePaths.length > 0) {
    await supabaseAdmin.storage
      .from("team-chat")
      .remove(storagePaths);
  }

  if ((attachments?.length ?? 0) > 0) {
    await supabaseAdmin
      .from("team_chat_attachments")
      .delete()
      .eq("message_id", message.id)
      .eq("business_id", currentMember.business_id);
  }

  const now = new Date().toISOString();
  const deletedBy = currentMember.full_name?.trim() || "Team member";

  const { data: updated, error } = await supabaseAdmin
    .from("team_chat_messages")
    .update({
      message_text: `${DELETED_MESSAGE_PREFIX}${deletedBy}`,
      edited_at: null,
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
        email,
        role,
        profile_picture_url
      )
    `)
    .single();

  if (error || !updated) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete team message.",
        ...safeDetails(error?.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, message: { ...updated, attachments: [] } });
}
