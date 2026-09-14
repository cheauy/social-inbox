import { sessionStorage } from "./auth/secure-storage";
import type { InboxConversation } from "./types";

// One bounded encrypted snapshot, never a plaintext database of customer data.
const KEY = "inbox-preview-v1";
const MAX_AGE = 24 * 60 * 60 * 1000;
let epoch = 0;
let queue: Promise<unknown> = Promise.resolve();
const scopeKey = (ids: string[]) => [...new Set(ids)].sort().join(",");

export async function readInboxCache(userId: string, workspaceIds: string[]) {
  const start = epoch;
  try {
    await queue;
    const raw = await sessionStorage.getItem(KEY);
    if (!raw || start !== epoch) return null;
    const saved = JSON.parse(raw);
    if (saved.userId !== userId || saved.scope !== scopeKey(workspaceIds) ||
      !Number.isFinite(saved.at) || Date.now() - saved.at < 0 || Date.now() - saved.at > MAX_AGE ||
      !Array.isArray(saved.rows) || saved.rows.length > 30 ||
      saved.rows.some((row: InboxConversation) => !row?.id || !workspaceIds.includes(row.business_id))) return null;
    return saved.rows as InboxConversation[];
  } catch { return null; }
}

export function writeInboxCache(userId: string, workspaceIds: string[], rows: InboxConversation[]) {
  const start = epoch;
  const value = JSON.stringify({ userId, scope: scopeKey(workspaceIds), at: Date.now(), rows: rows.slice(0, 30) });
  // Bound encrypted chunks, including non-ASCII names and message previews.
  if (encodeURIComponent(value).length > 120000) return;
  queue = queue.catch(() => {}).then(async () => {
    if (start === epoch) await sessionStorage.setItem(KEY, value);
  }).catch(() => {});
}

export function clearInboxCache() {
  epoch++;
  // Removal runs after an in-flight write; a logout cannot resurrect the cache.
  queue = queue.catch(() => {}).then(() => sessionStorage.removeItem(KEY)).catch(() => {});
  return queue;
}
