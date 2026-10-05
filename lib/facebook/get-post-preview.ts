import "server-only";

import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  mergePostPreview, record, safePostImage, safePostLink,
  type FacebookCommentParent, type FacebookPostPhoto, type PostPreviewData,
} from "@/lib/facebook/post-preview-data";

export type FacebookPostPreview = PostPreviewData;

type GraphAttachmentMedia = {
  image?: {
    src?: string;
  };
  source?: string;
};

type GraphAttachment = {
  target?: { id?: string; url?: string };
  url?: string;
  media?: GraphAttachmentMedia;
  subattachments?: {
    data?: GraphAttachment[];
    paging?: { next?: string };
  };
};

type GraphPostResult = {
  id?: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time?: string;
  attachments?: {
    data?: GraphAttachment[];
    paging?: { next?: string };
  };
  object?: {
    id?: string;
  };
  parent?: GraphPostResult;
  from?: { id?: string; name?: string };
  attachment?: GraphAttachment;
  page_story_id?: string;
  link?: string;
  images?: { source?: string; width?: number; height?: number }[];
  error?: {
    message?: string;
    code?: number;
  };
};

type GraphPostRequestResult = {
  response: Response;
  result: GraphPostResult;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function attachmentPhotos(
  attachments: GraphPostResult["attachments"],
): { photos: FacebookPostPhoto[]; complete: boolean } {
  const stack = (attachments?.data ?? []).slice(0, 51).map(attachment => ({ attachment, depth: 0 }));
  const photos: FacebookPostPhoto[] = [];
  let complete = Array.isArray(attachments?.data) && !attachments?.paging?.next;
  let visited = 0;
  while (stack.length && visited < 100 && photos.length < 50) {
    const { attachment, depth } = stack.shift()!;
    visited += 1;
    if (attachment.subattachments) {
      if (attachment.subattachments.paging?.next || !Array.isArray(attachment.subattachments.data)) complete = false;
      const children = attachment.subattachments.data ?? [];
      if (depth >= 8 && children.length) complete = false;
      else stack.push(...children.slice(0, 51).map(child => ({ attachment: child, depth: depth + 1 })));
      if (children.length > 50) complete = false;
      if (children.length || attachment.subattachments.paging?.next || !Array.isArray(attachment.subattachments.data)) continue;
    }
    const src = safePostImage(attachment.media?.image?.src), id = cleanString(attachment.target?.id);
    if (src && !photos.some(photo => (id && photo.id === id) || photo.src === src)) {
      photos.push({ id, src, permalink_url: safePostLink(attachment.target?.url) ?? safePostLink(attachment.url) });
    }
  }
  if (stack.length || (attachments?.data?.length ?? 0) > 50) complete = false;
  return { photos, complete };
}

async function requestFacebookPostPreview({
  graphVersion,
  postId,
  accessToken,
  fields,
}: {
  graphVersion: string;
  postId: string;
  accessToken: string;
  fields: string;
}): Promise<GraphPostRequestResult> {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(postId)}`,
  );

  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });

  const responseText = await response.text();
  let result: GraphPostResult = {};

  if (responseText.trim()) {
    try {
      result = JSON.parse(responseText) as GraphPostResult;
    } catch {
      console.warn("[Tenh Facebook Post Preview] Invalid JSON.");
    }
  }

  return {
    response,
    result,
  };
}

async function requestWithTokenRepair({
  graphVersion,
  postId,
  pageId,
  accessToken,
  fields,
}: {
  graphVersion: string;
  postId: string;
  pageId?: string;
  accessToken: string;
  fields: string;
}): Promise<{
  requestResult: GraphPostRequestResult;
  accessToken: string;
}> {
  let currentToken = accessToken;
  let requestResult = await requestFacebookPostPreview({
    graphVersion,
    postId,
    accessToken: currentToken,
    fields,
  });

  if (
    (!requestResult.response.ok || requestResult.result.error) &&
    isFacebookAccessTokenError(requestResult.result.error)
  ) {
    try {
      currentToken = await refreshFacebookPageAccessToken(pageId);
      requestResult = await requestFacebookPostPreview({
        graphVersion,
        postId,
        accessToken: currentToken,
        fields,
      });
    } catch (refreshError) {
      console.warn(
        "[Tenh Facebook Post Preview] Automatic Page-token recovery failed.",
        refreshError,
      );
    }
  }

  return {
    requestResult,
    accessToken: currentToken,
  };
}

function normalizePreview({
  result,
  postId,
}: {
  result: GraphPostResult;
  postId: string;
}): FacebookPostPreview {
  const attachments = attachmentPhotos(result.attachments);
  return {
    id: cleanString(result.id) ?? postId,
    message: cleanString(result.message),
    full_picture:
      safePostImage(result.full_picture) ?? attachments.photos[0]?.src ?? null,
    permalink_url: safePostLink(result.permalink_url),
    created_time: cleanString(result.created_time),
    photos: attachments.photos,
    attachments_complete: attachments.complete,
  };
}

async function loadFacebookPostPreview(
  postId: string,
  pageId?: string,
): Promise<FacebookPostPreview | null> {
  const normalizedPostId = postId.trim();

  if (!normalizedPostId) {
    return null;
  }

  let pageAccessToken: string;

  try {
    pageAccessToken = await getFacebookPageAccessToken(pageId);
  } catch (error) {
    console.warn(
      "[Tenh Facebook Post Preview] No Page token; skipping preview.",
      error,
    );
    return null;
  }

  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION ?? "v26.0";

  try {
    const attachmentFields = "attachments.limit(50){target,url,media,subattachments.limit(50){target,url,media}}";
    const primary = await requestWithTokenRepair({
      graphVersion,
      postId: normalizedPostId,
      pageId,
      accessToken: pageAccessToken,
      fields: `id,message,full_picture,permalink_url,created_time,${attachmentFields}`,
    });

    pageAccessToken = primary.accessToken;

    if (
      primary.requestResult.response.ok &&
      !primary.requestResult.result.error
    ) {
      const preview = normalizePreview({
        result: primary.requestResult.result,
        postId: normalizedPostId,
      });

      if (Array.isArray(primary.requestResult.result.attachments?.data)) {
        return preview;
      }

      // A full_picture can be only the album cover; never skip attachment IDs.
      const mediaFallback = await requestWithTokenRepair({
        graphVersion,
        postId: normalizedPostId,
        pageId,
        accessToken: pageAccessToken,
        fields:
          `id,message,permalink_url,created_time,${attachmentFields}`,
      });

      if (
        mediaFallback.requestResult.response.ok &&
        !mediaFallback.requestResult.result.error
      ) {
        const fallbackPreview = normalizePreview({
          result: mediaFallback.requestResult.result,
          postId: normalizedPostId,
        });
        return mergePostPreview(preview, fallbackPreview, normalizedPostId);
      }

      return preview;
    }

    /*
     * A small number of post object types reject full_picture but allow the
     * attachment-backed shape. Try it once before giving up on the content
     * card. This remains read-only and uses the same authorized Page token.
     */
    const fallback = await requestWithTokenRepair({
      graphVersion,
      postId: normalizedPostId,
      pageId,
      accessToken: pageAccessToken,
      fields:
        "id,message,permalink_url,created_time,attachments{media,subattachments{media}}",
    });

    if (
      fallback.requestResult.response.ok &&
      !fallback.requestResult.result.error
    ) {
      const preview = normalizePreview({
        result: fallback.requestResult.result,
        postId: normalizedPostId,
      });
      // Legacy shape preserves media but cannot certify all attachment identities.
      preview.attachments_complete = false;
      return preview;
    }

    // Some object types reject attachment metadata altogether. Keep basic text
    // and the provider's full_picture without claiming complete album context.
    const basic = await requestWithTokenRepair({ graphVersion, postId: normalizedPostId, pageId,
      accessToken: fallback.accessToken, fields: "id,message,full_picture,permalink_url,created_time" });
    if (basic.requestResult.response.ok && !basic.requestResult.result.error) {
      return normalizePreview({ result: basic.requestResult.result, postId: normalizedPostId });
    }

    console.warn(
      "[Tenh Facebook Post Preview] Unable to load preview.",
      {
        postId: normalizedPostId,
        primaryStatus: primary.requestResult.response.status,
        primaryError: primary.requestResult.result.error,
        fallbackStatus: fallback.requestResult.response.status,
        fallbackError: fallback.requestResult.result.error,
      },
    );

    return null;
  } catch (error) {
    console.warn(
      "[Tenh Facebook Post Preview] Request failed.",
      error,
    );
    return null;
  }
}

async function loadFacebookPostIdForComment(
  commentId: string,
  pageId?: string,
): Promise<string | null> {
  const normalizedCommentId = commentId.trim();

  if (!normalizedCommentId) {
    return null;
  }

  let pageAccessToken: string;

  try {
    pageAccessToken = await getFacebookPageAccessToken(pageId);
  } catch (error) {
    console.warn(
      "[Tenh Facebook Comment Context] No Page token; cannot recover post ID.",
      error,
    );
    return null;
  }

  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION ?? "v26.0";

  try {
    const request = await requestWithTokenRepair({
      graphVersion,
      postId: normalizedCommentId,
      pageId,
      accessToken: pageAccessToken,
      fields: "id,object",
    });

    if (
      !request.requestResult.response.ok ||
      request.requestResult.result.error || cleanString(request.requestResult.result.id) !== normalizedCommentId
    ) {
      return null;
    }

    return cleanString(
      request.requestResult.result.object?.id,
    );
  } catch (error) {
    console.warn(
      "[Tenh Facebook Comment Context] Unable to recover post ID from comment.",
      error,
    );
    return null;
  }
}

// These caches contain only public post context, never tokens. Authorize the
// caller before using them. Bound both positive and failed lookups so unavailable
// posts cannot cause a Graph request on every inbox safety-net tick.
const previewCache = new Map<string, { value: FacebookPostPreview | null; expires: number; fetchedAt: number }>();
const previewInFlight = new Map<string, Promise<FacebookPostPreview | null>>();
const commentCache = new Map<string, { value: string | null; expires: number }>();
const commentInFlight = new Map<string, Promise<string | null>>();
const MAX_CONTEXT_CACHE = 256;

function trimContextCache<T>(cache: Map<string, T>) {
  while (cache.size > MAX_CONTEXT_CACHE) cache.delete(cache.keys().next().value!);
}

export async function getFacebookPostPreview(
  postId: string,
  pageId?: string,
  options: { refresh?: boolean } = {},
): Promise<FacebookPostPreview | null> {
  const key = `${pageId ?? ""}:${postId.trim()}`;
  const pending = previewInFlight.get(key);
  if (pending) return pending;
  const cached = previewCache.get(key);
  const now = Date.now();
  // An image failure can refresh a positive cache, but many cards failing at
  // once still perform at most one lookup per post per 30 seconds.
  if (cached && cached.expires > now && (!options.refresh || now - cached.fetchedAt < 30_000)) return cached.value;
  const work = loadFacebookPostPreview(postId, pageId).then(value => {
    previewCache.set(key, { value, fetchedAt: Date.now(), expires: Date.now() + (value?.message || value?.full_picture ? 300_000 : 60_000) });
    trimContextCache(previewCache);
    return value;
  }).finally(() => { previewInFlight.delete(key); });
  previewInFlight.set(key, work);
  return work;
}

export async function getFacebookPostIdForComment(commentId: string, pageId?: string): Promise<string | null> {
  const key = `${pageId ?? ""}:${commentId.trim()}`;
  const pending = commentInFlight.get(key);
  if (pending) return pending;
  const cached = commentCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const work = loadFacebookPostIdForComment(commentId, pageId).then(value => {
    commentCache.set(key, { value, expires: Date.now() + (value ? 900_000 : 60_000) });
    trimContextCache(commentCache);
    return value;
  }).finally(() => { commentInFlight.delete(key); });
  commentInFlight.set(key, work);
  return work;
}

export type FacebookCommentContext = {
  id: string;
  object_id: string | null;
  permalink_url: string | null;
  parent_id: string | null;
  parent_resolved: boolean;
  parent: FacebookCommentParent | null;
};
export type FacebookPhotoContext = {
  id: string;
  post_id: string | null;
  full_picture: string | null;
  permalink_url: string | null;
};

const commentContextCache = new Map<string, { value: FacebookCommentContext | null; expires: number }>();
const commentContextInFlight = new Map<string, Promise<FacebookCommentContext | null>>();
const photoContextCache = new Map<string, { value: FacebookPhotoContext | null; expires: number }>();
const photoContextInFlight = new Map<string, Promise<FacebookPhotoContext | null>>();

function cachedContext<T>(key: string, cache: Map<string, { value: T | null; expires: number }>,
  inFlight: Map<string, Promise<T | null>>, load: () => Promise<T | null>): Promise<T | null> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
  if (inFlight.size >= MAX_CONTEXT_CACHE) return Promise.resolve(null);
  const work = load().catch(() => null).then(value => {
    cache.set(key, { value, expires: Date.now() + (value ? 300_000 : 60_000) });
    trimContextCache(cache);
    return value;
  }).finally(() => { inFlight.delete(key); });
  inFlight.set(key, work);
  return work;
}

function normalizeParent(id: string, value: unknown): FacebookCommentParent {
  const parent = record(value), attachment = record(parent.attachment);
  const image = safePostImage(record(record(attachment.media).image).src);
  const text = cleanString(parent.message);
  return { id, author: cleanString(record(parent.from).name), text, image,
    permalink_url: safePostLink(parent.permalink_url),
    status: text ? "available" : image || Object.keys(attachment).length ? "media" : "unavailable" };
}

/** Read exact provider relationships. Callers must authorize the message/Page first. */
export async function getFacebookCommentContext(commentId: string, pageId: string): Promise<FacebookCommentContext | null> {
  const id = commentId.trim(), page = pageId.trim();
  if (!id || !page) return null;
  return cachedContext(`${page}:${id}`, commentContextCache, commentContextInFlight, async () => {
    const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION ?? "v26.0";
    let accessToken = await getFacebookPageAccessToken(page);
    let attempt = await requestWithTokenRepair({ graphVersion, postId: id, pageId: page, accessToken,
      fields: "id,object,permalink_url,parent{id,from,message,attachment,permalink_url}" });
    accessToken = attempt.accessToken;
    if (!attempt.requestResult.response.ok || attempt.requestResult.result.error) {
      attempt = await requestWithTokenRepair({ graphVersion, postId: id, pageId: page, accessToken,
        fields: "id,object,permalink_url,parent" });
      accessToken = attempt.accessToken;
    }
    const result = attempt.requestResult.result;
    if (!attempt.requestResult.response.ok || result.error || cleanString(result.id) !== id) return null;
    const objectId = cleanString(result.object?.id);
    const rawParentId = cleanString(result.parent?.id);
    const parentId = rawParentId && rawParentId !== objectId ? rawParentId : null;
    let parent = parentId && parentId !== id ? normalizeParent(parentId, result.parent) : null;
    // Meta can return only parent.id even after expansion. Read that exact ID
    // once; an inaccessible parent remains an explicit unavailable placeholder.
    if (parent && parent.status === "unavailable") {
      try {
        const lookup = await requestWithTokenRepair({ graphVersion, postId: parent.id, pageId: page, accessToken,
          fields: "id,from,message,attachment,permalink_url" });
        if (lookup.requestResult.response.ok && !lookup.requestResult.result.error &&
            cleanString(lookup.requestResult.result.id) === parent.id) parent = normalizeParent(parent.id, lookup.requestResult.result);
      } catch { /* Preserve the verified relationship when optional parent content is unavailable. */ }
    }
    return { id, object_id: objectId, permalink_url: safePostLink(result.permalink_url), parent_resolved: Object.prototype.hasOwnProperty.call(result, "parent"),
      parent_id: parentId && parentId !== id ? parentId : null, parent };
  });
}

/** Photo.page_story_id is optional; never manufacture a source post or permalink. */
export async function getFacebookPhotoContext(objectId: string, pageId: string): Promise<FacebookPhotoContext | null> {
  const id = objectId.trim(), page = pageId.trim();
  if (!id || !page) return null;
  return cachedContext(`${page}:${id}`, photoContextCache, photoContextInFlight, async () => {
    const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION ?? "v26.0";
    const accessToken = await getFacebookPageAccessToken(page);
    const attempt = await requestWithTokenRepair({ graphVersion, postId: id, pageId: page, accessToken,
      fields: "id,page_story_id,link,images" });
    const result = attempt.requestResult.result;
    if (!attempt.requestResult.response.ok || result.error || cleanString(result.id) !== id) return null;
    const images = Array.isArray(result.images) ? result.images.slice(0, 50) : [];
    let fullPicture: string | null = null, size = -1;
    for (const image of images) {
      const src = safePostImage(image?.source), area = (Number(image?.width) || 0) * (Number(image?.height) || 0);
      if (src && area > size) { fullPicture = src; size = area; }
    }
    return { id, post_id: cleanString(result.page_story_id), full_picture: fullPicture, permalink_url: safePostLink(result.link) };
  });
}
