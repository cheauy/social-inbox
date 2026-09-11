import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { avatarThumbnail } from "@/lib/media/avatar-thumbnail";

// Called ONLY after the avatar route has checked current membership and
// contact ownership. The server cache never makes the private bucket public.
const readThumbnail = unstable_cache(async (bucket: string, path: string) => {
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) throw new Error("Avatar unavailable");
  if (data.size > 5 * 1024 * 1024) throw new Error("Avatar exceeds size limit");
  const thumbnail = await avatarThumbnail(Buffer.from(await data.arrayBuffer()));
  return thumbnail.toString("base64");
}, ["tenh-avatar-thumbnail-v1"], { revalidate: 300 });

const inFlight = new Map<string, Promise<string>>();

function coalescedThumbnail(bucket: string, path: string) {
  const key = JSON.stringify([bucket, path]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = readThumbnail(bucket, path).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

export async function loadStoredAvatar(bucket: string, path: string): Promise<{ data: Blob | null; error: boolean }> {
  try {
    const encoded = await coalescedThumbnail(bucket, path);
    return { data: new Blob([new Uint8Array(Buffer.from(encoded, "base64"))], { type: "image/webp" }), error: false };
  } catch {
    // Do not cache failures: the Facebook repair can populate a missing photo
    // and retry in the same request.
    return { data: null, error: true };
  }
}
