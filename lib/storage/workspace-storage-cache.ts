export type WorkspaceStorageFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "file";
  createdAt: string;
  previewUrl: string | null;
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
  files: WorkspaceStorageFile[];
  categories: WorkspaceStorageCategory[];
  canManage: boolean;
  organizationAvailable: boolean;
};

export const WORKSPACE_STORAGE_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 4;

type Entry = { snapshot: WorkspaceStorageSnapshot; storedAt: number };
type Pending = {
  generation: number;
  controller: AbortController;
  promise: Promise<{ snapshot: WorkspaceStorageSnapshot; current: boolean }>;
};

const entries = new Map<string, Entry>();
const generations = new Map<string, number>();
const pending = new Map<string, Pending>();
let activeMemberId: string | null = null;

function generation(key: string) {
  return generations.get(key) ?? 0;
}

function abortPending(key: string) {
  pending.get(key)?.controller.abort();
  pending.delete(key);
}

export function clearWorkspaceStorageCache() {
  for (const request of pending.values()) request.controller.abort();
  entries.clear();
  generations.clear();
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
  const owner = generation(key);
  const existing = pending.get(key);
  if (existing?.generation === owner) return existing.promise;

  const controller = new AbortController();
  const promise = fetcher(controller.signal).then((snapshot) => {
    const current = generation(key) === owner;
    if (current) write(key, snapshot);
    return { snapshot, current };
  }).finally(() => {
    if (pending.get(key)?.promise === promise) pending.delete(key);
  });
  pending.set(key, { generation: owner, controller, promise });
  return promise;
}

export function beginWorkspaceStorageMutation(key: string) {
  abortPending(key);
  const next = generation(key) + 1;
  generations.set(key, next);
  return next;
}

export function commitWorkspaceStorageMutation(
  key: string,
  owner: number,
  update: (snapshot: WorkspaceStorageSnapshot) => WorkspaceStorageSnapshot,
) {
  if (generation(key) !== owner) return false;
  abortPending(key);
  generations.set(key, owner + 1);
  const entry = entries.get(key);
  if (entry) write(key, update(entry.snapshot));
  return true;
}

export function dropWorkspaceStorageCache(key: string) {
  beginWorkspaceStorageMutation(key);
  entries.delete(key);
}
