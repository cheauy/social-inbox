export type WorkspaceStorageFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "file";
  createdAt: string;
  previewUrl: string | null;
  previewExpiresAt?: number | null;
  contentVersion?: string;
  categoryId: string | null;
  favorite: boolean;
};

export type WorkspaceStorageCategory = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceStorageSnapshot = {
  queryKey?: string;
  files: WorkspaceStorageFile[];
  categories: WorkspaceStorageCategory[];
  canManage: boolean;
  organizationAvailable: boolean;
  businessId?: string;
  memberId?: string;
  hasMore?: boolean;
  nextCursor?: string | null;
  pendingDeletions?: Array<{ id: string; name: string }>;
  pendingUploads?: Array<{ uploadId: string; fileName: string; mimeType: string; sizeBytes: number; categoryId: string | null; storagePath: string; expiresAt: string }>;
};

export function mergeWorkspaceStorageFiles(
  previous: WorkspaceStorageFile[],
  incoming: WorkspaceStorageFile[],
  append = false,
  now = Date.now(),
) {
  const existing = new Map(previous.map(file => [file.id, file]));
  const merged = new Map(append ? existing : []);
  for (const file of incoming) {
    const old = existing.get(file.id);
    const preservePreview = old?.contentVersion && old.contentVersion === file.contentVersion
      && old.previewUrl && (old.previewExpiresAt ?? 0) > now;
    const next = preservePreview
      ? { ...file, previewUrl: old.previewUrl, previewExpiresAt: old.previewExpiresAt }
      : file;
    const unchanged = old && Object.keys(old).length === Object.keys(next).length
      && (Object.keys(next) as Array<keyof WorkspaceStorageFile>).every(key => old[key] === next[key]);
    merged.set(file.id, unchanged ? old : next);
  }
  return [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
}

export const WORKSPACE_STORAGE_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 4;

type Entry = { snapshot: WorkspaceStorageSnapshot; storedAt: number };
type Context = { revision: number };
type Mutation = { context: Context; committed: boolean };
type Pending = {
  generation: number;
  controller: AbortController;
  promise: Promise<{ snapshot: WorkspaceStorageSnapshot; current: boolean }>;
};

const entries = new Map<string, Entry>();
const contexts = new Map<string, Context>();
const pending = new Map<string, Pending>();
let activeMemberId: string | null = null;

function context(key: string) {
  let current = contexts.get(key);
  if (!current) {
    current = { revision: 0 };
    contexts.set(key, current);
  }
  return current;
}

function abortPending(key: string) {
  pending.get(key)?.controller.abort();
  pending.delete(key);
}

export function clearWorkspaceStorageCache() {
  for (const request of pending.values()) request.controller.abort();
  entries.clear();
  contexts.clear();
  pending.clear();
  activeMemberId = null;
}

export function workspaceStorageCacheKey(businessId: string, memberId: string) {
  if (activeMemberId !== null && activeMemberId !== memberId) clearWorkspaceStorageCache();
  activeMemberId = memberId;
  return `${businessId}:${memberId}`;
}

export function readWorkspaceStorageCache(key: string, now = Date.now()) {
  const entry = entries.get(key);
  if (!entry || now - entry.storedAt > WORKSPACE_STORAGE_CACHE_TTL_MS) {
    if (entry) entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry.snapshot;
}

function write(key: string, snapshot: WorkspaceStorageSnapshot) {
  entries.delete(key);
  entries.set(key, { snapshot, storedAt: Date.now() });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

export async function refreshWorkspaceStorageCache(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<WorkspaceStorageSnapshot>,
) {
  const owner = context(key);
  const revision = owner.revision;
  const existing = pending.get(key);
  if (existing?.generation === revision) return existing.promise;

  const controller = new AbortController();
  const promise = fetcher(controller.signal).then((snapshot) => {
    const current = contexts.get(key) === owner && owner.revision === revision;
    if (current) write(key, snapshot);
    return { snapshot, current };
  }).finally(() => {
    if (pending.get(key)?.promise === promise) pending.delete(key);
  });
  pending.set(key, { generation: revision, controller, promise });
  return promise;
}

export function beginWorkspaceStorageMutation(key: string) {
  abortPending(key);
  const owner = context(key);
  owner.revision += 1;
  return { context: owner, committed: false };
}

export function commitWorkspaceStorageMutation(
  key: string,
  owner: Mutation,
  update: (snapshot: WorkspaceStorageSnapshot) => WorkspaceStorageSnapshot,
) {
  if (contexts.get(key) !== owner.context || owner.committed) return false;
  owner.committed = true;
  abortPending(key);
  owner.context.revision += 1;
  const entry = entries.get(key);
  if (entry) write(key, update(entry.snapshot));
  return true;
}

export function dropWorkspaceStorageCache(key: string) {
  abortPending(key);
  contexts.delete(key);
  entries.delete(key);
}
