import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { cachedSignedUrls } from "@/lib/media/signed-urls";
import {
  isWorkspaceFilePathOwned,
  WORKSPACE_FILE_BUCKET,
  WORKSPACE_FILE_MAX_BYTES,
  workspaceFileKind,
  workspaceFilePath,
} from "@/lib/storage/workspace-files";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionBody = {
  action?: "prepare-upload" | "finalize-upload" | "get-file-url";
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath?: string;
};

function fail(error: string, status: number, hint?: string) {
  return NextResponse.json(
    { success: false, error, ...(hint ? { hint } : {}) },
    { status },
  );
}

function validFile(body: ActionBody) {
  const fileName = body.fileName?.trim() ?? "";
  const mimeType = body.mimeType?.trim().toLowerCase() ?? "";
  const sizeBytes = Number(body.sizeBytes);
  const kind = workspaceFileKind(fileName, mimeType);

  if (!fileName || !mimeType || !kind) {
    return { error: "This file type is not supported." } as const;
  }

  if (
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > WORKSPACE_FILE_MAX_BYTES
  ) {
    return { error: "Files must be larger than 0 bytes and no more than 20 MB." } as const;
  }

  return { fileName, mimeType, sizeBytes: Math.trunc(sizeBytes), kind } as const;
}

export async function GET() {
  const auth = await getCurrentMember();
  if (!auth.success) return fail(auth.error, auth.status);

  const { data, error } = await supabaseAdmin
    .from("workspace_files")
    .select("id,display_name,mime_type,size_bytes,file_kind,storage_path,created_at")
    .eq("business_id", auth.member.business_id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return fail(
      "Workspace Storage is not available yet.",
      503,
      "Review and apply db/migrations/20261008_workspace_storage.sql.",
    );
  }

  const rows = data ?? [];
  const signed = rows.length
    ? await cachedSignedUrls(
        WORKSPACE_FILE_BUCKET,
        rows.map((row) => row.storage_path),
        10 * 60,
      ).catch(() => [])
    : [];
  const urls = new Map(
    signed.map((entry) => [entry.path, entry.signedUrl]),
  );

  return NextResponse.json({
    success: true,
    files: rows.map((row) => ({
      id: row.id,
      name: row.display_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      kind: row.file_kind,
      createdAt: row.created_at,
      previewUrl: urls.get(row.storage_path) ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getCurrentMember();
  if (!auth.success) return fail(auth.error, auth.status);

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return fail("Invalid JSON request.", 400);
  }

  if (body.action === "prepare-upload") {
    const file = validFile(body);
    if ("error" in file) return fail(file.error ?? "Invalid file.", 400);

    const path = workspaceFilePath({
      businessId: auth.member.business_id,
      fileId: randomUUID(),
      fileName: file.fileName,
    });
    const { data, error } = await supabaseAdmin.storage
      .from(WORKSPACE_FILE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });

    if (error || !data) {
      return fail(
        "Unable to prepare the workspace file upload.",
        503,
        "Review and apply db/migrations/20261008_workspace_storage.sql.",
      );
    }

    return NextResponse.json({
      success: true,
      upload: { bucket: WORKSPACE_FILE_BUCKET, path, token: data.token },
    });
  }

  if (body.action === "finalize-upload") {
    const file = validFile(body);
    if ("error" in file) return fail(file.error ?? "Invalid file.", 400);

    const path = body.storagePath?.trim() ?? "";
    if (!isWorkspaceFilePathOwned(path, auth.member.business_id)) {
      return fail("Invalid workspace file path.", 400);
    }

    const stored = await supabaseAdmin.storage
      .from(WORKSPACE_FILE_BUCKET)
      .info(path);
    const storedType = stored.data?.contentType
      ?.split(";")[0]
      .trim()
      .toLowerCase();

    if (
      stored.error ||
      !stored.data ||
      stored.data.size !== file.sizeBytes ||
      storedType !== file.mimeType
    ) {
      await supabaseAdmin.storage.from(WORKSPACE_FILE_BUCKET).remove([path]);
      return fail("The uploaded file did not match the approved file metadata.", 400);
    }

    const { data, error } = await supabaseAdmin
      .from("workspace_files")
      .insert({
        business_id: auth.member.business_id,
        display_name: file.fileName.slice(0, 255),
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        file_kind: file.kind,
        storage_bucket: WORKSPACE_FILE_BUCKET,
        storage_path: path,
        uploaded_by_member_id: auth.member.id,
      })
      .select("id,display_name,mime_type,size_bytes,file_kind,created_at")
      .single();

    if (error || !data) {
      await supabaseAdmin.storage.from(WORKSPACE_FILE_BUCKET).remove([path]);
      return fail("The file uploaded, but TENH could not save its Storage record.", 500);
    }

    return NextResponse.json({ success: true, file: data });
  }

  if (body.action === "get-file-url") {
    const fileId = body.fileId?.trim() ?? "";
    if (!fileId) return fail("fileId is required.", 400);

    const { data: file, error } = await supabaseAdmin
      .from("workspace_files")
      .select("display_name,storage_path")
      .eq("id", fileId)
      .eq("business_id", auth.member.business_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !file) return fail("Workspace file was not found.", 404);

    const signed = await supabaseAdmin.storage
      .from(WORKSPACE_FILE_BUCKET)
      .createSignedUrl(file.storage_path, 5 * 60, { download: file.display_name });

    if (signed.error || !signed.data?.signedUrl) {
      return fail("Unable to create a secure file link.", 500);
    }

    return NextResponse.json({ success: true, signedUrl: signed.data.signedUrl });
  }

  return fail("Unsupported workspace Storage action.", 400);
}
