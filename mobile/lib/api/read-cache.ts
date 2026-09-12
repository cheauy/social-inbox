// Session-only data: private messages never persist to unencrypted disk.
const entries = new Map<string, { value: unknown; at: number; bytes: number }>();
const pending = new Map<string, Promise<unknown>>();
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_AGE = 5 * 60_000;
let generation = 0;

export function clearReadCache(matches?: (key: string) => boolean) {
  generation++;
  if (matches) { for (const key of entries.keys()) if (matches(key)) entries.delete(key); }
  else entries.clear();
  pending.clear();
}

export function invalidateReadCache(userId: string, workspaceId: string | null | undefined, path: string) {
  if (/\/(conversations|team-chat\/rooms)\/[^/]+\/(read|unread|pin)$/.test(path)) return;
  clearReadCache(key => {
    const [user, workspace, resource] = JSON.parse(key) as string[];
    if (user !== userId || (workspaceId && workspace !== workspaceId)) return false;
    if (path.startsWith("/api/saved-repl")) return resource.startsWith("/api/saved-repl");
    if (path.startsWith("/api/team-chat/")) return resource.startsWith("/api/team-chat/");
    if (/^\/api\/(facebook|telegram)\//.test(path) || path.startsWith("/api/conversations/")) {
      return resource.startsWith("/api/conversations/") || resource.startsWith("/api/customers/");
    }
    if (path.startsWith("/api/customers/") || path.startsWith("/api/contacts/")) return resource.startsWith("/api/customers/");
    return true;
  });
}

export async function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  options: { onCached?: (value: T) => void; freshMs?: number } = {},
): Promise<T> {
  const entry = entries.get(key);
  if (entry && Date.now() - entry.at < MAX_AGE) {
    // Move to the end so frequently opened panels survive eviction.
    entries.delete(key);
    entries.set(key, entry);
    options.onCached?.(entry.value as T);
    if (Date.now() - entry.at < (options.freshMs ?? 15_000)) return entry.value as T;
  } else entries.delete(key);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const epoch = generation;
  const work = load().then(value => {
    if (epoch === generation) {
      const bytes = JSON.stringify(value).length * 2;
      if (bytes <= MAX_BYTES) {
        entries.delete(key);
        entries.set(key, { value, at: Date.now(), bytes });
        let total = [...entries.values()].reduce((sum, item) => sum + item.bytes, 0);
        for (const [oldKey, item] of entries) {
          if (entries.size <= 100 && total <= MAX_BYTES) break;
          entries.delete(oldKey);
          total -= item.bytes;
        }
      }
    }
    return value;
  }).finally(() => { if (pending.get(key) === work) pending.delete(key); });
  pending.set(key, work);
  return work;
}
