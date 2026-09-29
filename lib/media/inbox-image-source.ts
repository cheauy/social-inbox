/** Only known image CDNs and this project's Storage may be fetched by the image endpoint. */
export function allowedInboxImageUrl(value: string, supabaseUrl?: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const host = url.hostname.toLowerCase();
    const meta = ["fbcdn.net", "fbsbx.com"].some(domain => host === domain || host.endsWith(`.${domain}`));
    let storage = false;
    if (supabaseUrl) {
      const configured = new URL(supabaseUrl);
      storage = configured.protocol === "https:" && url.origin === configured.origin && url.pathname.startsWith("/storage/v1/");
    }
    return meta || storage ? url : null;
  } catch { return null; }
}

/** Bound bytes as they arrive, not after buffering an arbitrarily large image. */
export async function readBoundedImage(response: Response, maxBytes = 20 * 1024 * 1024): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) { await response.body?.cancel(); throw new Error("Image too large."); }
  if (!response.ok || !response.body || !/^image\/(?:png|jpeg|webp|gif|avif)(?:;|$)/i.test(response.headers.get("content-type") || "")) {
    await response.body?.cancel(); throw new Error("Image unavailable.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Image too large."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function fetchInboxImage(value: string, supabaseUrl?: string): Promise<Uint8Array> {
  let url = allowedInboxImageUrl(value, supabaseUrl);
  const signal = AbortSignal.timeout(12000);
  for (let hop = 0; hop < 4; hop++) {
    if (!url) throw new Error("Untrusted image source.");
    const response = await fetch(url, { redirect: "manual", signal, headers: { Accept: "image/*" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      url = location ? allowedInboxImageUrl(new URL(location, url).href, supabaseUrl) : null;
      continue;
    }
    return readBoundedImage(response);
  }
  throw new Error("Too many image redirects.");
}
