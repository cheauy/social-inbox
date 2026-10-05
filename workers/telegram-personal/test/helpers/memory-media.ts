import type { MediaStorage } from "../../src/media-storage.ts";

/** In-memory stand-in for Supabase Storage. */
export class MemoryMediaStorage implements MediaStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failUploads = false;

  async upload(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
    if (this.failUploads) throw new Error("Storage upload failed (500).");
    this.objects.set(`${bucket}/${path}`, { bytes: new Uint8Array(bytes), contentType });
  }

  async download(bucket: string, path: string, maxBytes: number) {
    const object = this.objects.get(`${bucket}/${path}`);
    if (!object) throw new Error("Storage download failed (404).");
    if (object.bytes.byteLength > maxBytes) throw new Error("Stored file is too large.");
    return object.bytes;
  }

  async remove(bucket: string, paths: string[]) {
    for (const path of paths) this.objects.delete(`${bucket}/${path}`);
  }
}
