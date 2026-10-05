import { randomUUID } from "expo-crypto";
import { Directory, File } from "expo-file-system";
import { api, ApiError } from "./api/client";
import { supabase } from "./supabase/client";
import { STORAGE_PAGE_SIZE, stageStorageFiles, storageFileName, type WorkspaceStorageFile, type WorkspaceStorageSnapshot, type WorkspaceStorageView } from "./workspace-storage";
import { registerStorageDraft, storageDraftRoot } from "./workspace-storage-drafts";

export type StorageScope = { userId: string; workspaceId: string; memberId: string; conversationId: string };

// Verify fresh thread access and reply permission in addition to Storage's
// server-owned membership/subscription guard.
export async function verifyStorageScope(scope: StorageScope, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Storage selection was cancelled.");
  const { data } = await supabase.auth.getSession();
  if (signal.aborted || data.session?.user.id !== scope.userId) throw new ApiError("Please reopen Storage after signing in.", 401);
  const query = new URLSearchParams({ workspaceIds: scope.workspaceId, conversationIds: scope.conversationId });
  const result = await api<{ member: { id: string; role: string }; permissions?: Record<string, string | boolean>; conversations: { id: string; business_id: string }[] }>(`/api/mobile/bootstrap?${query}`, scope.workspaceId, { signal });
  if (signal.aborted || result.member?.id !== scope.memberId || !result.conversations?.some(row => row.id === scope.conversationId && row.business_id === scope.workspaceId)) {
    throw new ApiError("This conversation or workspace is no longer available. Reopen it from Inbox.", 403);
  }
  return result.member.role === "owner" || result.permissions?.conversations === "manage";
}

export type StoragePageQuery = { view: WorkspaceStorageView; kind: "media" | "files"; query: string; cursor?: string | null };
export async function loadStorage(scope: StorageScope, signal: AbortSignal, page: StoragePageQuery = { view: "recent", kind: "media", query: "" }) {
  const canDraft = await verifyStorageScope(scope, signal);
  const query = new URLSearchParams({ limit: String(STORAGE_PAGE_SIZE), view: page.view, kind: page.kind, q: page.query.trim() });
  if (page.cursor) query.set("cursor", page.cursor);
  const result = await api<WorkspaceStorageSnapshot & { success: boolean; businessId: string; memberId: string; hasMore: boolean; nextCursor: string | null }>(`/api/workspace-storage/files?${query}`, scope.workspaceId, { signal });
  if (result.success !== true || !Array.isArray(result.files) || typeof result.hasMore !== "boolean" || (result.hasMore && !result.nextCursor) || result.files.length > STORAGE_PAGE_SIZE) throw new Error("Workspace Storage pagination is unavailable. Check its API deployment.");
  if (result.businessId !== scope.workspaceId || result.memberId !== scope.memberId) throw new ApiError("Storage belongs to another workspace or membership. Reopen it from Inbox.", 403);
  const snapshot: WorkspaceStorageSnapshot = {
    files: result.files, categories: result.categories ?? [],
    canManage: result.canManage === true, organizationAvailable: result.organizationAvailable === true,
  };
  return { snapshot, canDraft, hasMore: result.hasMore, nextCursor: result.nextCursor };
}

export async function favoriteStorageFile(scope: StorageScope, file: WorkspaceStorageFile, signal: AbortSignal) {
  await verifyStorageScope(scope, signal);
  await api("/api/workspace-storage/files", scope.workspaceId, { method: "POST", body: { action: "toggle-favorite", fileId: file.id, favorite: !file.favorite }, signal });
}

export async function prepareStorageDraft(scope: StorageScope, files: WorkspaceStorageFile[], room: number, signal: AbortSignal, owns: () => boolean) {
  const isCurrent = () => !signal.aborted && owns();
  if (!await verifyStorageScope(scope, signal)) throw new ApiError("You do not have permission to reply in this workspace.", 403);
  if (!isCurrent()) throw new Error("Storage selection was cancelled.");
  // Unique app-created directory; cleanup never targets picked/user files.
  const root = storageDraftRoot(); root.create({ intermediates: true, idempotent: true });
  const directory = new Directory(root, randomUUID());
  directory.create();
  const discard = () => { try { if (directory.exists) directory.delete(); } catch { /* Cache eviction may already have removed it. */ } };
  const pending = await stageStorageFiles(files, room, {
    isCurrent, discard,
    getUrl: async file => {
      const result = await api<{ signedUrl: string }>("/api/workspace-storage/files", scope.workspaceId, { method: "POST", body: { action: "get-file-url", fileId: file.id }, signal });
      return result.signedUrl;
    },
    download: async (file, url) => {
      const target = new File(directory, `${randomUUID()}-${storageFileName(file)}`);
      const saved = await File.downloadFileAsync(url, target, { signal });
      return { key: `storage:${randomUUID()}:${file.id}`, uri: saved.uri, name: file.name, mimeType: file.mimeType, kind: file.kind, bytes: saved.size };
    },
  });
  let release: (() => void) | undefined;
  try { release = registerStorageDraft(scope, pending, directory); }
  catch (error) { discard(); throw error; }
  return { pending, discard: () => { release?.(); discard(); } };
}
