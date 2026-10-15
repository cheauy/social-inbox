import type { WorkspaceStorageCategory, WorkspaceStorageFile } from "./workspace-storage-cache";

export type StorageIdentity = { businessId: string; memberId: string };
export type PendingStorageUpload = { uploadId: string; fileName: string; mimeType: string; sizeBytes: number; categoryId: string | null; storagePath: string; expiresAt: string };
export type StorageResponse = Partial<StorageIdentity> & {
  success?: boolean; error?: string; code?: string;
  files?: WorkspaceStorageFile[]; categories?: WorkspaceStorageCategory[];
  category?: WorkspaceStorageCategory; clientFile?: WorkspaceStorageFile;
  signedUrl?: string; upload?: { uploadId: string; bucket: string; path: string; token: string };
  canManage?: boolean; organizationAvailable?: boolean; hasMore?: boolean; nextCursor?: string | null;
  deletedIds?: string[]; failedIds?: string[]; pendingIds?: string[];
  pendingDeletions?: Array<{ id: string; name: string }>;
  pendingUploads?: PendingStorageUpload[];
  previews?: Array<Pick<WorkspaceStorageFile, "id" | "previewUrl" | "previewExpiresAt" | "contentVersion">>;
};

export class StorageApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function workspaceStorageRequest(
  identity: StorageIdentity, body?: object, signal?: AbortSignal,
  query?: URLSearchParams, categories = false,
): Promise<StorageResponse> {
  const response = await fetch(`/api/workspace-storage/${categories ? "categories" : "files"}${query ? `?${query}` : ""}`, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", "x-tenh-business-id": identity.businessId, "x-tenh-member-id": identity.memberId },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({})) as StorageResponse;
  if (signal?.aborted) throw new DOMException("Storage request cancelled.", "AbortError");
  if ((response.ok || response.status === 207) &&
      (result.businessId !== identity.businessId || result.memberId !== identity.memberId)) {
    throw new StorageApiError("Storage workspace or membership changed. Reopen Storage from Inbox.", 403);
  }
  if (response.status !== 207 && (!response.ok || !result.success)) {
    throw new StorageApiError(result.error || "Workspace Storage request failed.", response.status, result.code);
  }
  return result;
}

export type StorageUploadAttempt = {
  id: string; file: File; categoryId: string | null;
  upload?: NonNullable<StorageResponse["upload"]>; error?: string; state: "waiting" | "uploading" | "failed" | "complete";
};

// Retry the same capability. A lost finalization response must never create a new object.
export async function runStorageUpload(
  attempt: StorageUploadAttempt,
  request: (body: object) => Promise<StorageResponse>,
  uploadBytes: (upload: NonNullable<StorageResponse["upload"]>, file: File) => Promise<void>,
) {
  const metadata = { fileName: attempt.file.name, mimeType: attempt.file.type.trim().toLowerCase() || "application/octet-stream", sizeBytes: attempt.file.size, categoryId: attempt.categoryId };
  const finalize = () => request({ action: "finalize-upload", ...metadata, uploadId: attempt.upload!.uploadId, storagePath: attempt.upload!.path });
  if (attempt.upload) {
    try { return await finalize(); }
    catch (cause) {
      if (!(cause instanceof StorageApiError) || cause.code !== "UPLOAD_INCOMPLETE") throw cause;
    }
  }
  const prepared = await request({ action: "prepare-upload", ...metadata, ...(attempt.upload ? { uploadId: attempt.upload.uploadId } : {}) });
  if (prepared.clientFile) return prepared;
  if (!prepared.upload) throw new Error("Upload details were missing.");
  attempt.upload = prepared.upload;
  await uploadBytes(prepared.upload, attempt.file);
  return finalize();
}
