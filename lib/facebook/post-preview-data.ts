/** Shared, dependency-free post-card data. No provider credentials here. */
export type PostPreviewData = {
  id: string;
  message: string | null;
  full_picture: string | null;
  permalink_url: string | null;
  created_time: string | null;
};
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function safePostImage(value: unknown): string | null {
  const source = text(value);
  if (!source) return null;
  try { const url = new URL(source); return url.protocol === "https:" && !url.username && !url.password ? source : null; } catch { return null; }
}
export function safePostLink(value: unknown, postId?: string | null): string | null {
  const source = text(value);
  if (source) {
    try {
      const url = new URL(source);
      if (url.protocol === "https:" && !url.username && !url.password &&
          (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com") || url.hostname === "fb.watch")) return source;
    } catch { /* use the known post ID */ }
  }
  return postId && /^[A-Za-z0-9_]+$/.test(postId) ? `https://www.facebook.com/${encodeURIComponent(postId)}` : null;
}
export function mergePostPreview(saved: unknown, fresh: unknown, postId: string): PostPreviewData {
  const old = record(saved), next = record(fresh);
  return {
    id: text(next.id) ?? text(old.id) ?? postId,
    message: text(next.message) ?? text(old.message),
    full_picture: safePostImage(next.full_picture) ?? safePostImage(old.full_picture),
    permalink_url: safePostLink(next.permalink_url, null) ?? safePostLink(old.permalink_url, postId),
    created_time: text(next.created_time) ?? text(old.created_time),
  };
}
