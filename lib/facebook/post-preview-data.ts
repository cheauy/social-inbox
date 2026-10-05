/** Shared, dependency-free post-card data. No provider credentials here. */
export type PostPreviewData = {
  id: string;
  message: string | null;
  full_picture: string | null;
  permalink_url: string | null;
  created_time: string | null;
  photos?: FacebookPostPhoto[];
  attachments_complete?: boolean;
  photo_id?: string | null;
  comment_object_id?: string | null;
};
export type FacebookPostPhoto = { id: string | null; src: string; permalink_url: string | null };
export type FacebookCommentParent = {
  id: string;
  author: string | null;
  text: string | null;
  image: string | null;
  permalink_url: string | null;
  status: "available" | "deleted" | "unavailable" | "media";
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
export function safePostLink(value: unknown, _postId?: string | null): string | null {
  void _postId; // Backwards-compatible call signature; identity never manufactures a URL.
  const source = text(value);
  if (source) {
    try {
      const url = new URL(source);
      if (url.protocol === "https:" && !url.username && !url.password &&
          (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com") || url.hostname === "fb.watch")) return source;
    } catch { /* Invalid provider URL. */ }
  }
  return null;
}
export function safePostPhotos(value: unknown): FacebookPostPhoto[] {
  if (!Array.isArray(value)) return [];
  const photos: FacebookPostPhoto[] = [];
  for (const item of value.slice(0, 100)) {
    const photo = record(item), src = safePostImage(photo.src), id = text(photo.id);
    if (!src || photos.some(saved => (id && saved.id === id) || saved.src === src)) continue;
    photos.push({ id, src, permalink_url: safePostLink(photo.permalink_url) });
    if (photos.length === 50) break;
  }
  return photos;
}
export function mergePostPreview(saved: unknown, fresh: unknown, postId: string): PostPreviewData {
  const next = record(fresh), savedRecord = record(saved);
  const postChanged = !!text(next.id) && !!text(savedRecord.id) && text(next.id) !== text(savedRecord.id);
  const old = postChanged ? {} : savedRecord;
  const oldPhotos = postChanged ? [] : safePostPhotos(old.photos), freshPhotos = safePostPhotos(next.photos);
  const photos = next.attachments_complete === true ? freshPhotos : safePostPhotos([...freshPhotos, ...oldPhotos]);
  const hasObject = Object.prototype.hasOwnProperty.call(next, "comment_object_id");
  const objectId = hasObject ? text(next.comment_object_id) : text(old.comment_object_id);
  const objectChanged = postChanged || (hasObject && objectId !== text(old.comment_object_id));
  return {
    id: text(next.id) ?? text(old.id) ?? postId,
    message: text(next.message) ?? text(old.message),
    full_picture: safePostImage(next.full_picture) ?? safePostImage(old.full_picture),
    permalink_url: safePostLink(next.permalink_url) ?? safePostLink(old.permalink_url),
    created_time: text(next.created_time) ?? text(old.created_time),
    ...(Array.isArray(next.photos) || Array.isArray(old.photos) ? { photos } : {}),
    ...(typeof next.attachments_complete === "boolean" || typeof old.attachments_complete === "boolean"
      ? { attachments_complete: next.attachments_complete === true ||
          (next.attachments_complete !== false && !Array.isArray(next.photos) && old.attachments_complete === true) } : {}),
    ...(Object.prototype.hasOwnProperty.call(next, "photo_id") || Object.prototype.hasOwnProperty.call(old, "photo_id")
      ? { photo_id: Object.prototype.hasOwnProperty.call(next, "photo_id") ? text(next.photo_id) : objectChanged ? null : text(old.photo_id) } : {}),
    ...(hasObject || Object.prototype.hasOwnProperty.call(old, "comment_object_id") ? { comment_object_id: objectId } : {}),
  };
}
