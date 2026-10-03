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

export async function GET(request: NextRequest) {
  const auth = await getWorkspaceStorageAccess();
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
  const favorites = new Set((favoriteRows ?? []).map((row) => row.file_id));
  return NextResponse.json({
    success: true,
    businessId: auth.member.business_id,
    memberId: auth.member.id,
    ...(options.paged ? { hasMore, nextCursor: hasMore && rows.length ? workspaceStorageCursor(rows[rows.length - 1], queryKey) : null } : {}),
    canManage,
    organizationAvailable,
    categories: categoryRows,
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
    })),
  });
}

export async function POST(request: NextRequest) {
  const auth = await getWorkspaceStorageAccess();
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

    const categoryId = body.categoryId?.trim() || null;
    if (categoryId) {
      const { data: category, error: categoryError } = await supabaseAdmin
        .from("workspace_file_categories")
        .select("id")
        .eq("id", categoryId)
        .eq("business_id", auth.member.business_id)
        .maybeSingle();
      if (categoryError || !category) {
        await supabaseAdmin.storage.from(WORKSPACE_FILE_BUCKET).remove([path]);
        return fail("That Storage category was not found.", 400);
      }
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
        ...(categoryId ? { category_id: categoryId } : {}),
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

    return NextResponse.json({ success: true, signedUrl: signed.data.signedUrl });
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
    return NextResponse.json({ success: true, favorite });
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
    )).slice(0, 200);
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
      return NextResponse.json({ success: true });
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

    for (const row of owned.values()) {
      if (
        row.storage_bucket !== WORKSPACE_FILE_BUCKET ||
        !isWorkspaceFilePathOwned(row.storage_path, auth.member.business_id)
      ) {
        failedIds.push(row.id);
        continue;
      }

      const wasPending = Boolean(row.deleted_at);
      if (!wasPending) {
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
        if (!check.error && check.data) {
          if (!wasPending) {
            await supabaseAdmin
              .from("workspace_files")
              .update({ deleted_at: null })
              .eq("id", row.id)
              .eq("business_id", auth.member.business_id);
          }
          failedIds.push(row.id);
          continue;
        }
        if (!storageObjectMissing(check.error)) {
          failedIds.push(row.id);
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
        failedIds.push(row.id);
        continue;
      }
      deletedIds.push(row.id);
    }

    if (failedIds.length) {
      return NextResponse.json({
        success: false,
        error: `${deletedIds.length} file${deletedIds.length === 1 ? " was" : "s were"} deleted, but ${failedIds.length} could not be fully deleted. Retry the remaining selection.`,
        deletedIds,
        failedIds,
      }, { status: 207 });
    }

    return NextResponse.json({ success: true, deletedIds, failedIds });
  }

  return fail("Unsupported workspace Storage action.", 400);
}
