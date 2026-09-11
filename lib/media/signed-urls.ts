import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Call only AFTER checking current workspace/room access. This cache reuses
// capabilities, never authorizes callers. Keep at least one minute of validity.
const links = new Map<string, { url: string; until: number }>();
const pending = new Map<string, Promise<void>>();
const MAX_LINKS = 2000;
export async function cachedSignedUrls(bucket: string, paths: string[], seconds: number) {
  const unique = [...new Set(paths)].sort();
  const keyFor = (path: string) => JSON.stringify([bucket, path, seconds]);
  const missing = unique.filter(path => (links.get(keyFor(path))?.until ?? 0) <= Date.now());
  if (missing.length) {
    const batch = JSON.stringify([bucket, missing, seconds]);
    let work = pending.get(batch);
    if (!work) {
      work = (async () => {
        const started = Date.now();
        const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrls(missing, seconds);
        if (error) throw error;
        for (const entry of data ?? []) {
          if (!entry.path || !entry.signedUrl || entry.error) continue;
          const key = keyFor(entry.path);
          links.delete(key);
          links.set(key, { url: entry.signedUrl, until: started + Math.max(0, Math.min(300, seconds - 60)) * 1000 });
        }
        while (links.size > MAX_LINKS) links.delete(links.keys().next().value!);
      })().finally(() => pending.delete(batch));
      pending.set(batch, work);
    }
    await work;
  }
  return unique.flatMap(path => {
    const entry = links.get(keyFor(path));
    return entry && entry.until > Date.now() ? [{ path, signedUrl: entry.url }] : [];
  });
}
