import { withRequestScope } from "@/lib/server/request-scope";
import { recordUploadBytes } from "@/lib/server/usage-context";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  TEAM_CHAT_BUCKET,
  classifyAttachment,
  getAccessibleRoom,
  maxAttachmentBytes,
  normalizeAttachmentMimeType,
  safeDetails,
  safeFileName,
  withSignedUrls,
  type AttachmentRow,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrepareBody = {
  action?: "prepare";
  roomId?: string;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
};

function attachmentLimitLabel(bytes: number) {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

async function prepareDirectUpload(
  currentMember: {
    id: string;
    business_id: string;
    full_name: string;
    role: string;
    profile_picture_url?: string | null;
  },
  body: PrepareBody,
) {
  const roomId = String(body.roomId ?? "").trim();
  const fileName = safeFileName(String(body.fileName ?? "attachment"));
  const byteSize = Number(body.byteSize ?? 0);
  const mimeType = normalizeAttachmentMimeType(body.mimeType, fileName);
  const kind = classifyAttachment(mimeType, fileName);

  if (!roomId) {
    return NextResponse.json(
      { success: false, error: "A roomId is required." },
      { status: 400 },
    );
  }

  const room = await getAccessibleRoom(currentMember, roomId);

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
    );
  }

  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return NextResponse.json(
      { success: false, error: "That file is empty or its size is unavailable." },
      { status: 400 },
    );
  }

  if (!kind) {
    return NextResponse.json(
      { success: false, error: "That file type is not allowed in team chat." },
      { status: 415 },
    );
  }

  const maxBytes = maxAttachmentBytes(kind);

  if (byteSize > maxBytes) {
    return NextResponse.json(
      {
        success: false,
        error: `${kind === "video" ? "Videos" : "Files"} must be ${attachmentLimitLabel(maxBytes)} or smaller.`,
      },
      { status: 413 },
    );
  }

  const storagePath = `${currentMember.business_id}/${room.id}/${crypto.randomUUID()}-${fileName}`;
  const { data: signedUpload, error: signedUploadError } =
    await supabaseAdmin.storage
      .from(TEAM_CHAT_BUCKET)
      .createSignedUploadUrl(storagePath);

  if (signedUploadError || !signedUpload) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to prepare that upload.",
        ...safeDetails(signedUploadError?.message),
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
      byte_size: byteSize,
      kind,
    })
    .select("*")
    .single();

  if (insertError || !row) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to prepare that attachment.",
        ...safeDetails(insertError?.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    attachment: { ...(row as AttachmentRow), url: null },
    upload: {
      path: signedUpload.path,
      token: signedUpload.token,
      signedUrl: signedUpload.signedUrl,
    },
  });
}

/**
 * Upload a file for a team chat room.
 *
 * New web/mobile clients use the JSON "prepare" flow and then upload directly
 * to Supabase with a short-lived signed upload URL. This keeps video bytes out
 * of the Vercel function request body and avoids the platform body-size limit.
 *
 * The multipart branch remains for older clients and small files so a staged
 * rollout does not break an already-installed TENH build.
 */
async function handlePOST(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    let body: PrepareBody;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request." },
        { status: 400 },
      );
    }

    if (body.action !== "prepare") {
      return NextResponse.json(
        { success: false, error: "Unknown attachment action." },
        { status: 400 },
      );
    }

    return prepareDirectUpload(currentMember, body);
  }

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

  const fileName = safeFileName(file.name);
  const mimeType = normalizeAttachmentMimeType(file.type, fileName);
  const kind = classifyAttachment(mimeType, fileName);

  if (!kind) {
    return NextResponse.json(
      { success: false, error: "That file type is not allowed in team chat." },
      { status: 415 },
    );
  }

  const maxBytes = maxAttachmentBytes(kind);

  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        success: false,
        error: `${kind === "video" ? "Videos" : "Files"} must be ${attachmentLimitLabel(maxBytes)} or smaller.`,
      },
      { status: 413 },
    );
  }

  const storagePath = `${currentMember.business_id}/${room.id}/${crypto.randomUUID()}-${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(TEAM_CHAT_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
      cacheControl: "86400",
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

  recordUploadBytes(file.size);

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
    await supabaseAdmin.storage.from(TEAM_CHAT_BUCKET).remove([storagePath]);

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

/** Return a fresh signed read URL after a direct upload completes. */
export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;
  const attachmentId = request.nextUrl.searchParams.get("attachmentId")?.trim() ?? "";

  if (!attachmentId) {
    return NextResponse.json(
      { success: false, error: "An attachmentId is required." },
      { status: 400 },
    );
  }

  const { data: row, error } = await supabaseAdmin
    .from("team_chat_attachments")
    .select("*")
    .eq("id", attachmentId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to load that attachment.", ...safeDetails(error.message) },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json(
      { success: false, error: "Attachment not found." },
      { status: 404 },
    );
  }

  const room = await getAccessibleRoom(currentMember, row.room_id as string);

  if (!room) {
    return NextResponse.json(
      { success: false, error: "Team chat room not found." },
      { status: 404 },
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
  const attachmentId = request.nextUrl.searchParams.get("attachmentId")?.trim() ?? "";

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

  if (
    row.uploaded_by_member_id !== currentMember.id ||
    row.message_id !== null
  ) {
    return NextResponse.json(
      { success: false, error: "That attachment can no longer be removed." },
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

export const POST = withRequestScope(handlePOST);
