/*
 * Private file storage for Telegram Personal media and profile photos, in the
 * same Supabase buckets and paths the TENH web app already serves (signed links,
 * visibility-checked). Optional: without it media stays a text placeholder.
 */

export const MESSAGE_MEDIA_BUCKET = "tenh-message-media";
export const CONTACT_AVATAR_BUCKET = "tenh-contact-avatars";

export interface MediaStorage {
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  download(bucket: string, path: string, maxBytes: number): Promise<Uint8Array>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

const SAFE_PATH = /^[0-9A-Za-z][0-9A-Za-z._/-]{0,400}$/;

function objectUrl(base: string, bucket: string, path: string) {
  if (!SAFE_PATH.test(path) || path.includes("..")) throw new Error("Unsafe storage path.");
  return `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Supabase Storage over HTTPS with the service key (worker environment only; never logged). */
export class SupabaseMediaStorage implements MediaStorage {
  private readonly base: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new Error("Storage URL must use https.");
    }
    this.base = parsed.origin;
    this.key = key;
  }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }

  async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
    const response = await fetch(objectUrl(this.base, bucket, path), {
      method: "POST",
      headers: this.headers({ "content-type": contentType || "application/octet-stream", "x-upsert": "true", "cache-control": "3600" }),
      body: new Blob([new Uint8Array(bytes)]),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Storage upload failed (${response.status}).`);
  }

  async download(bucket: string, path: string, maxBytes: number) {
    const response = await fetch(objectUrl(this.base, bucket, path), { headers: this.headers(), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Storage download failed (${response.status}).`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Stored file is too large.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("Stored file is too large.");
    return bytes;
  }

  async remove(bucket: string, paths: string[]) {
    if (!paths.length) return;
    for (const path of paths) objectUrl(this.base, bucket, path); // validates
    const response = await fetch(`${this.base}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: "DELETE",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ prefixes: paths }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Storage delete failed (${response.status}).`);
  }
}
