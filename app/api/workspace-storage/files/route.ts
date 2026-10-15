import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getWorkspaceStorageAccess } from "@/lib/storage/workspace-storage-access";
import { parseWorkspaceStorageQuery, storageSearchPattern, workspaceStorageCursor, workspaceStorageQueryKey } from "@/lib/storage/workspace-storage-query";
import { memberHasPermission } from "@/lib/auth/require-permission";
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
  action?:
    | "prepare-upload"
    | "finalize-upload"
    | "get-file-url"
    | "refresh-previews"
    | "toggle-favorite"
    | "set-category"
    | "delete-files";
  fileId?: string;
  fileIds?: string[];
  favorite?: boolean;
  categoryId?: string | null;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath?: string;
  uploadId?: string;
};

const WORKSPACE_FILE_SELECT =
  "id,display_name,mime_type,size_bytes,file_kind,storage_path,created_at,deleted_at";

type WorkspaceFileRow = {
  id: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  file_kind: string;
  storage_path: string;
  created_at: string;
  deleted_at: string | null;
  category_id?: string | null;
};

type StorageQueryResult = {
  data: WorkspaceFileRow[] | null;
  error: { code?: string | null; message?: string | null } | null;
};

function organizationSchemaMissing(error: { code?: string | null } | null | undefined) {
  return ["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"].includes(error?.code ?? "");
}

function storageObjectMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: number | string; statusCode?: number | string; message?: string };
  const status = Number(value.statusCode ?? value.status);
  return status === 404 || /not found|does not exist/i.test(value.message ?? "");
}

function fail(error: string, status: number, hint?: string, code?: string) {
  return NextResponse.json(
    { success: false, error, ...(hint ? { hint } : {}), ...(code ? { code } : {}) },
    { status },
  );
}

function validFile(body: ActionBody) {
  const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 255) : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const sizeBytes = Number(body.sizeBytes);
  const kind = workspaceFileKind(fileName, mimeType);

  if (!fileName || !mimeType || !kind) {
    return { error: "This file type is not supported." } as const;
  }

  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > WORKSPACE_FILE_MAX_BYTES
  ) {
    return { error: "Files must be larger than 0 bytes and no more than 20 MB." } as const;
  }

  return { fileName, mimeType, sizeBytes: Math.trunc(sizeBytes), kind } as const;
}

export async function GET(request: NextRequest) {
  const auth = await getWorkspaceStorageAccess(request);
  if (!auth.success) return fail(auth.error, auth.status);
  let options;
  try { options = parseWorkspaceStorageQuery(new URL(request?.url ?? "https://app.tenhchat.com/api/workspace-storage/files").searchParams); }
  catch (cause) { return fail(cause instanceof Error ? cause.message : "Invalid Storage filters.", 400); }
  const queryKey = workspaceStorageQueryKey(auth.member.business_id, auth.member.id, options);
  if (options.cursor && options.cursor.key !== queryKey) return fail("This Storage cursor belongs to another workspace, membership or filter. Reload Storage.", 400);
  const canManage = await memberHasPermission(auth.member, "tags_quick_replies", "manage");

  const loadFiles = async (includeCategory: boolean) => {
    const query = supabaseAdmin
      .from("workspace_files")
      .select(`${WORKSPACE_FILE_SELECT}${includeCategory ? ",category_id" : ""}${options.view === "favorites" ? ",workspace_file_favorites!inner(member_id)" : ""}`)
      .eq("business_id", auth.member.business_id)
      .eq("storage_bucket", WORKSPACE_FILE_BUCKET)
      .is("deleted_at", null);
    if (options.view.startsWith("category:")) query.eq("category_id", options.view.slice(9));
    if (options.view === "favorites") query.eq("workspace_file_favorites.member_id", auth.member.id);
    if (options.kind !== "all") query.in("file_kind", options.kind === "media" ? ["image", "video"] : ["audio", "file"]);
    if (options.search) query.ilike("display_name", storageSearchPattern(options.search));
    if (options.cursor) query.or(`created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`);
    return await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(options.limit + (options.paged ? 1 : 0)) as unknown as StorageQueryResult;
  };

  let organizationAvailable = true;
  let activeResult = await loadFiles(true);
  if (organizationSchemaMissing(activeResult.error)) {
    if (options.view !== "recent") return fail("Storage categories and favorites are not available yet. Reload Recent files.", 503);
    organizationAvailable = false;
    activeResult = await loadFiles(false);
  }
  const { data, error } = activeResult;

  if (error) {
    return fail(
      "Workspace Storage is not available yet.",
      503,
      "Review and apply db/migrations/20261008_workspace_storage.sql.",
    );
  }

  const fetched = data ?? [];
  const hasMore = options.paged && fetched.length > options.limit;
  const rows = fetched.slice(0, options.limit);
  if (rows.some(row => !isWorkspaceFilePathOwned(row.storage_path, auth.member.business_id))) return fail("Workspace Storage contains invalid file metadata. Contact the workspace Owner.", 500);
  let categoryRows: Array<{ id: string; name: string; created_at: string; updated_at: string }> = [];
  let favoriteRows: Array<{ file_id: string }> = [];
  if (organizationAvailable) {
    const [categoryResult, favoriteResult] = await Promise.all([
      supabaseAdmin
        .from("workspace_file_categories")
        .select("id,name,created_at,updated_at")
        .eq("business_id", auth.member.business_id)
        .order("name", { ascending: true }),
      rows.length ? supabaseAdmin
        .from("workspace_file_favorites")
        .select("file_id")
        .eq("member_id", auth.member.id)
        .in("file_id", rows.map(row => row.id)) : Promise.resolve({ data: [], error: null }),
    ]);
    if (organizationSchemaMissing(categoryResult.error) || organizationSchemaMissing(favoriteResult.error)) {
      if (options.view !== "recent") return fail("Storage categories and favorites are not available yet. Reload Recent files.", 503);
      organizationAvailable = false;
    } else if (categoryResult.error || favoriteResult.error) {
      return fail("Unable to load workspace Storage organization.", 500);
    } else {
      categoryRows = categoryResult.data ?? [];
      favoriteRows = favoriteResult.data ?? [];
    }
  }

  const previewExpiresAt = Date.now() + 4 * 60 * 1000;
  const signed = rows.length
    ? await cachedSignedUrls(
        WORKSPACE_FILE_BUCKET,
        rows.map((row) => row.storage_path),
        10 * 60,
      `${auth.member.business_id}:${auth.member.id}`,
      ).catch(() => [])
    : [];
  const urls = new Map(
    signed.map((entry) => [entry.path, entry.signedUrl]),
  );
  const favorites = new Set((favoriteRows ?? []).map((row) => row.file_id));
  const pending = canManage ? await supabaseAdmin.from("workspace_files")
    .select("id,display_name").eq("business_id", auth.member.business_id)
    .eq("storage_bucket", WORKSPACE_FILE_BUCKET).not("deleted_at", "is", null)
    .order("deleted_at", { ascending: true }).order("id", { ascending: true }).limit(30) : null;
  if (pending?.error) return fail("Unable to load pending Storage cleanup.", 500);
  const pendingUploads = canManage ? await supabaseAdmin.from("workspace_storage_uploads")
    .select("id,display_name,mime_type,size_bytes,category_id,storage_path,expires_at")
    .eq("business_id", auth.member.business_id).eq("member_id", auth.member.id).eq("state", "prepared")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(10) : null;
  if (pendingUploads?.error) return fail("Unable to load pending Storage uploads.", 503);
  return NextResponse.json({
    success: true,
    businessId: auth.member.business_id,
    memberId: auth.member.id,
    ...(options.paged ? { hasMore, nextCursor: hasMore && rows.length ? workspaceStorageCursor(rows[rows.length - 1], queryKey) : null } : {}),
    canManage,
    organizationAvailable,
    categories: categoryRows,
    pendingDeletions: (pending?.data ?? []).map(row => ({ id: row.id, name: row.display_name })),
    pendingUploads: (pendingUploads?.data ?? []).map(row => ({ uploadId: row.id, fileName: row.display_name,
      mimeType: row.mime_type, sizeBytes: row.size_bytes, categoryId: row.category_id,
      storagePath: row.storage_path, expiresAt: row.expires_at })),
    files: rows.map((row) => ({
      id: row.id,
      name: row.display_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      kind: row.file_kind,
      createdAt: row.created_at,
      categoryId: organizationAvailable ? row.category_id ?? null : null,
      favorite: favorites.has(row.id),
      deletedAt: row.deleted_at,
      previewUrl: urls.get(row.storage_path) ?? null,
      // Cached links are at most five minutes old; renew before their ten-minute expiry.
      previewExpiresAt: urls.has(row.storage_path) ? previewExpiresAt : null,
      contentVersion: row.storage_path,
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getWorkspaceStorageAccess(request);
  if (!auth.success) return fail(auth.error, auth.status);
  const identity = { businessId: auth.member.business_id, memberId: auth.member.id };

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return fail("Invalid JSON request.", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid Storage action.", 400);
  for (const key of ["action", "fileId", "fileName", "mimeType", "storagePath", "uploadId", "categoryId"] as const) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") return fail(`Invalid ${key}.`, 400);
  }
  if (body.categoryId != null && typeof body.categoryId !== "string") return fail("Invalid Storage category.", 400);

  if (body.action === "prepare-upload" || body.action === "finalize-upload") {
    if (!(await memberHasPermission(auth.member, "tags_quick_replies", "manage"))) {
      return fail("You do not have permission to upload shared Storage files.", 403);
    }
    const file = validFile(body);
    if ("error" in file) return fail(file.error ?? "Invalid file.", 400);
    const categoryId = typeof body.categoryId === "string" ? body.categoryId.trim() || null : null;
    const uploadId = typeof body.uploadId === "string" ? body.uploadId.trim() : "";
    const suppliedPath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    if (suppliedPath && !isWorkspaceFilePathOwned(suppliedPath, auth.member.business_id)) {
      return fail("Invalid workspace file path.", 400);
    }
    type PreparedUpload = {
      id: string; storage_path: string; display_name: string; mime_type: string;
      size_bytes: number; file_kind: string; category_id: string | null;
      state: string; expires_at: string;
    };
    let prepared: PreparedUpload;
    if (uploadId || body.action === "finalize-upload") {
      if (!uploadId && !suppliedPath) return fail("A prepared upload is required.", 400);
      const query = supabaseAdmin.from("workspace_storage_uploads")
        .select("id,storage_path,display_name,mime_type,size_bytes,file_kind,category_id,state,expires_at")
        .eq("business_id", auth.member.business_id).eq("member_id", auth.member.id);
      if (uploadId) query.eq("id", uploadId); else query.eq("storage_path", suppliedPath);
      const result = await query.maybeSingle();
      if (result.error) return fail("Unable to reconcile this prepared upload. Retry shortly.", 503, undefined, "UPLOAD_UNCERTAIN");
      if (!result.data) return fail("The prepared upload was not found for this membership.", 404);
      prepared = result.data;
      if (!isWorkspaceFilePathOwned(prepared.storage_path, auth.member.business_id) ||
          (suppliedPath && suppliedPath !== prepared.storage_path) ||
          prepared.display_name !== file.fileName || prepared.mime_type !== file.mimeType ||
          Number(prepared.size_bytes) !== file.sizeBytes || prepared.file_kind !== file.kind ||
          prepared.category_id !== categoryId) return fail("Upload metadata does not match the prepared upload.", 400);
    } else {
      if (categoryId) {
        const category = await supabaseAdmin.from("workspace_file_categories").select("id")
          .eq("id", categoryId).eq("business_id", auth.member.business_id).maybeSingle();
        if (category.error || !category.data) return fail("That Storage category was not found.", 400);
      }
      const id = randomUUID();
      prepared = {
        id, storage_path: workspaceFilePath({ businessId: auth.member.business_id, fileId: id, fileName: file.fileName }),
        display_name: file.fileName, mime_type: file.mimeType, size_bytes: file.sizeBytes,
        file_kind: file.kind, category_id: categoryId, state: "prepared",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      const created = await supabaseAdmin.from("workspace_storage_uploads").insert({
        ...prepared, business_id: auth.member.business_id, member_id: auth.member.id,
      });
      if (created.error) return fail("Unable to record the prepared upload.", 503,
        "Apply the workspace Storage upload lifecycle migration before this server release.");
    }
    const uploadResult = async (data: WorkspaceFileRow) => {
      const favorite = await supabaseAdmin.from("workspace_file_favorites").select("file_id")
        .eq("member_id", auth.member.id).eq("file_id", data.id).maybeSingle();
      if (favorite.error) return fail("Unable to reconcile the finalized file favorite. Retry shortly.", 503, undefined, "UPLOAD_UNCERTAIN");
      return NextResponse.json({
      success: true, ...identity, file: data,
      clientFile: { id: data.id, name: data.display_name, mimeType: data.mime_type,
        sizeBytes: data.size_bytes, kind: data.file_kind, createdAt: data.created_at,
        categoryId: data.category_id ?? null, favorite: Boolean(favorite.data), deletedAt: null,
        previewUrl: null, previewExpiresAt: null, contentVersion: data.storage_path },
    });
    };
    if (prepared.state === "finalized") {
      const existing = await supabaseAdmin.from("workspace_files").select(`${WORKSPACE_FILE_SELECT},category_id`)
        .eq("id", prepared.id).eq("business_id", auth.member.business_id)
        .eq("uploaded_by_member_id", auth.member.id).eq("storage_path", prepared.storage_path)
        .is("deleted_at", null).maybeSingle();
      if (existing.error) return fail("Unable to reconcile the finalized upload. Retry shortly.", 503, undefined, "UPLOAD_UNCERTAIN");
      if (!existing.data) return fail("The finalized file is no longer available.", 410);
      return uploadResult(existing.data);
    }
    if (prepared.state !== "prepared" || !(Date.parse(prepared.expires_at) > Date.now())) {
      return fail("This prepared upload has expired. Select the file again.", 410);
    }
    if (body.action === "prepare-upload") {
      const signed = await supabaseAdmin.storage.from(WORKSPACE_FILE_BUCKET)
        .createSignedUploadUrl(prepared.storage_path, { upsert: false });
      if (signed.error || !signed.data) return fail("Unable to prepare the workspace file upload.", 503, undefined, "UPLOAD_UNCERTAIN");
      return NextResponse.json({ success: true, ...identity,
        upload: { uploadId: prepared.id, bucket: WORKSPACE_FILE_BUCKET, path: prepared.storage_path, token: signed.data.token } });
    }
    const stored = await supabaseAdmin.storage.from(WORKSPACE_FILE_BUCKET).info(prepared.storage_path);
    if (stored.error || !stored.data) return storageObjectMissing(stored.error)
      ? fail("The prepared file has not finished uploading.", 409, undefined, "UPLOAD_INCOMPLETE")
      : fail("Unable to verify this upload. Retry finalization before uploading again.", 503, undefined, "UPLOAD_UNCERTAIN");
    const storedType = stored.data.contentType?.split(";")[0].trim().toLowerCase();
    if (Number(stored.data.size) !== file.sizeBytes || storedType !== file.mimeType) {
      return fail("The uploaded file did not match the approved file metadata.", 400);
    }
    // The database locks this attempt; finalize errors never remove Storage objects.
    const finalized = await supabaseAdmin.rpc("finalize_workspace_storage_upload", {
      p_upload_id: prepared.id, p_business_id: auth.member.business_id, p_member_id: auth.member.id,
    });
    if (finalized.error?.code === "42501") return fail("Storage upload permission was revoked.", 403);
    if (finalized.error?.code === "22023") return fail("The prepared upload expired or its category was removed. Select the file again.", 409, undefined, "UPLOAD_REJECTED");
    if (finalized.error || !finalized.data) return fail("The file is uploaded. Retry finalization to reconcile its Storage record.", 503, undefined, "UPLOAD_UNCERTAIN");
    return uploadResult(finalized.data as WorkspaceFileRow);
  }

  if (body.action === "refresh-previews") {
    const fileIds = [...new Set((Array.isArray(body.fileIds) ? body.fileIds : [])
      .filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map(id => id.trim()))];
    if (!fileIds.length || fileIds.length > 30) return fail("Choose between 1 and 30 Storage previews.", 400);
    const files = await supabaseAdmin.from("workspace_files")
      .select("id,storage_path").eq("business_id", auth.member.business_id)
      .eq("storage_bucket", WORKSPACE_FILE_BUCKET).is("deleted_at", null).in("id", fileIds);
    if (files.error) return fail("Unable to load Storage previews.", 503);
    const rows = files.data ?? [];
    if (rows.some(row => !isWorkspaceFilePathOwned(row.storage_path, auth.member.business_id))) return fail("Invalid workspace file metadata.", 500);
    const previewExpiresAt = Date.now() + 9 * 60 * 1000;
    const signed = rows.length ? await supabaseAdmin.storage.from(WORKSPACE_FILE_BUCKET)
      .createSignedUrls(rows.map(row => row.storage_path), 600) : { data: [], error: null };
    if (signed.error) return fail("Unable to renew Storage previews.", 503);
    const urls = new Map((signed.data ?? []).filter(entry => !entry.error && entry.signedUrl)
      .map(entry => [entry.path, entry.signedUrl]));
    return NextResponse.json({ success: true, ...identity,
      previews: rows.map(row => ({ id: row.id, previewUrl: urls.get(row.storage_path) ?? null,
      previewExpiresAt: urls.has(row.storage_path) ? previewExpiresAt : null, contentVersion: row.storage_path })),
      unavailableIds: fileIds.filter(id => !rows.some(row => row.id === id)),
    });
  }

  if (body.action === "get-file-url") {
    const fileId = body.fileId?.trim() ?? "";
    if (!fileId) return fail("fileId is required.", 400);

    const { data: file, error } = await supabaseAdmin
      .from("workspace_files")
      .select("display_name,storage_path,storage_bucket")
      .eq("id", fileId)
      .eq("business_id", auth.member.business_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !file || file.storage_bucket !== WORKSPACE_FILE_BUCKET || !isWorkspaceFilePathOwned(file.storage_path, auth.member.business_id)) return fail("Workspace file was not found.", 404);

    const signed = await supabaseAdmin.storage
      .from(WORKSPACE_FILE_BUCKET)
      .createSignedUrl(file.storage_path, 5 * 60, { download: file.display_name });

    if (signed.error || !signed.data?.signedUrl) {
      return fail("Unable to create a secure file link.", 500);
    }

    return NextResponse.json({ success: true, ...identity, signedUrl: signed.data.signedUrl });
  }

  if (body.action === "toggle-favorite") {
    const fileId = body.fileId?.trim() ?? "";
    if (!fileId) return fail("fileId is required.", 400);

    const { data: file, error } = await supabaseAdmin
      .from("workspace_files")
      .select("id")
      .eq("id", fileId)
      .eq("business_id", auth.member.business_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !file) return fail("Workspace file was not found.", 404);

    const favorite = body.favorite === true;
    const result = favorite
      ? await supabaseAdmin.from("workspace_file_favorites").upsert(
          { member_id: auth.member.id, file_id: fileId },
          { onConflict: "member_id,file_id" },
        )
      : await supabaseAdmin
          .from("workspace_file_favorites")
          .delete()
          .eq("member_id", auth.member.id)
          .eq("file_id", fileId);
    if (result.error) return fail("Unable to update that favorite.", 500);
    return NextResponse.json({ success: true, ...identity, favorite });
  }

  if (body.action === "set-category" || body.action === "delete-files") {
    if (!(await memberHasPermission(auth.member, "tags_quick_replies", "manage"))) {
      return fail("You do not have permission to change shared Storage files.", 403);
    }
    const fileIds = Array.from(new Set(
      (Array.isArray(body.fileIds) ? body.fileIds : [])
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ));
    if (fileIds.length > 200) return fail("Select up to 200 files per action.", 400);
    if (!fileIds.length) return fail("Choose at least one workspace file.", 400);

    if (body.action === "set-category") {
      const categoryId = body.categoryId?.trim() || null;
      if (categoryId) {
        const { data: category, error: categoryError } = await supabaseAdmin
          .from("workspace_file_categories")
          .select("id")
          .eq("id", categoryId)
          .eq("business_id", auth.member.business_id)
          .maybeSingle();
        if (categoryError || !category) return fail("That Storage category was not found.", 400);
      }
      const { error } = await supabaseAdmin
        .from("workspace_files")
        .update({ category_id: categoryId })
        .eq("business_id", auth.member.business_id)
        .in("id", fileIds)
        .is("deleted_at", null);
      if (error) return fail("Unable to move the selected files.", 500);
      return NextResponse.json({ success: true, ...identity });
    }

    const { data: rows, error: loadError } = await supabaseAdmin
      .from("workspace_files")
      .select("id,storage_bucket,storage_path,deleted_at")
      .eq("business_id", auth.member.business_id)
      .in("id", fileIds);
    if (loadError) return fail("Unable to load the selected files for deletion.", 500);

    const owned = new Map((rows ?? []).map((row) => [row.id, row]));
    const deletedIds = fileIds.filter((id) => !owned.has(id));
    const failedIds: string[] = [];
    const pendingIds: string[] = [];

    for (const row of owned.values()) {
      if (
        row.storage_bucket !== WORKSPACE_FILE_BUCKET ||
        !isWorkspaceFilePathOwned(row.storage_path, auth.member.business_id)
      ) {
        failedIds.push(row.id);
        continue;
      }

      if (!row.deleted_at) {
        const staged = await supabaseAdmin
          .from("workspace_files")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("business_id", auth.member.business_id)
          .is("deleted_at", null);
        if (staged.error) {
          failedIds.push(row.id);
          continue;
        }
      }

      const removed = await supabaseAdmin.storage
        .from(WORKSPACE_FILE_BUCKET)
        .remove([row.storage_path]);

      if (removed.error) {
        const check = await supabaseAdmin.storage
          .from(WORKSPACE_FILE_BUCKET)
          .info(row.storage_path);
        if (!storageObjectMissing(check.error)) {
          pendingIds.push(row.id);
          continue;
        }
      }

      const metadata = await supabaseAdmin
        .from("workspace_files")
        .delete()
        .eq("id", row.id)
        .eq("business_id", auth.member.business_id)
        .eq("storage_path", row.storage_path);
      if (metadata.error) {
        pendingIds.push(row.id);
        continue;
      }
      deletedIds.push(row.id);
    }

    if (failedIds.length || pendingIds.length) {
      return NextResponse.json({
        success: false,
        ...identity,
        error: `${deletedIds.length} deleted, ${pendingIds.length} pending cleanup, ${failedIds.length} failed. Retry remaining files.`,
        deletedIds,
        failedIds,
        pendingIds,
      }, { status: 207 });
    }

    return NextResponse.json({ success: true, ...identity, deletedIds, failedIds, pendingIds });
  }

  return fail("Unsupported workspace Storage action.", 400);
}
