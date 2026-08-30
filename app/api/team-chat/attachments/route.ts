import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  TEAM_CHAT_BUCKET,
  MAX_ATTACHMENT_BYTES,
  classifyAttachment,
  getAccessibleRoom,
  safeDetails,
  safeFileName,
  withSignedUrls,
  type AttachmentRow,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a file for a team chat room.
 *
 * The file lands in a PRIVATE bucket and the row is created with
 * message_id = null. It is bound to a message when the message is sent,
 * so an abandoned upload never appears in the conversation.
 */
export async function POST(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Expected a file upload." },
      { status: 400 },
    );
  }

  const roomId = String(form.get("roomId") ?? "").trim();
  const file = form.get("file");

  if (!roomId) {
    return NextResponse.json(
      { success: false, error: "A roomId is required." },
      { status: 400 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { success: false, error: "No file was received." },
      { status: 400 },
    );
  }

  // Membership is checked BEFORE anything touches storage.
  const room = await getAccessibleRoom(currentMember, roomId);

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  if (file.size <= 0) {
    return NextResponse.json(
      { success: false, error: "That file is empty." },
      { status: 400 },
    );
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      {
        success: false,
        error: `Files must be ${Math.floor(
          MAX_ATTACHMENT_BYTES / (1024 * 1024),
        )} MB or smaller.`,
      },
      { status: 413 },
    );
  }

  const mimeType = (file.type || "application/octet-stream").toLowerCase();
  const kind = classifyAttachment(mimeType);

  if (!kind) {
    return NextResponse.json(
      {
        success: false,
        error: "That file type is not allowed in team chat.",
      },
      { status: 415 },
    );
  }

  const fileName = safeFileName(file.name);

  // business/room prefix keeps one workspace's files from ever colliding
  // with another's, and makes bulk cleanup by room trivial.
  const storagePath = `${currentMember.business_id}/${room.id}/${crypto.randomUUID()}-${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(TEAM_CHAT_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to upload that file.",
        ...safeDetails(uploadError.message),
      },
      { status: 500 },
    );
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from("team_chat_attachments")
    .insert({
      business_id: currentMember.business_id,
      room_id: room.id,
      message_id: null,
      uploaded_by_member_id: currentMember.id,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      byte_size: file.size,
      kind,
    })
    .select("*")
    .single();

  if (insertError || !row) {
    // Do not leave a file in storage with no row pointing at it.
    await supabaseAdmin.storage
      .from(TEAM_CHAT_BUCKET)
      .remove([storagePath]);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to save that attachment.",
        ...safeDetails(insertError?.message),
      },
      { status: 500 },
    );
  }

  const [signed] = await withSignedUrls([row as AttachmentRow]);

  return NextResponse.json({ success: true, attachment: signed });
}

/** Discard an upload that was never sent. */
export async function DELETE(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;
  const attachmentId =
    request.nextUrl.searchParams.get("attachmentId")?.trim() ?? "";

  if (!attachmentId) {
    return NextResponse.json(
      { success: false, error: "An attachmentId is required." },
      { status: 400 },
    );
  }

  const { data: row } = await supabaseAdmin
    .from("team_chat_attachments")
    .select("id, storage_path, uploaded_by_member_id, message_id")
    .eq("id", attachmentId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ success: true });
  }

  // Only the uploader can discard, and only before it is sent.
  if (
    row.uploaded_by_member_id !== currentMember.id ||
    row.message_id !== null
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "That attachment can no longer be removed.",
      },
      { status: 403 },
    );
  }

  await supabaseAdmin.storage
    .from(TEAM_CHAT_BUCKET)
    .remove([row.storage_path as string]);

  await supabaseAdmin
    .from("team_chat_attachments")
    .delete()
    .eq("id", row.id);

  return NextResponse.json({ success: true });
}
