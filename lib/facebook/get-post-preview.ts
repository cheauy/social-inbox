import "server-only";

import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

export type FacebookPostPreview = {
  id: string;
  message: string | null;
  full_picture: string | null;
  permalink_url: string | null;
  created_time: string | null;
};

type GraphAttachmentMedia = {
  image?: {
    src?: string;
  };
  source?: string;
};

type GraphAttachment = {
  media?: GraphAttachmentMedia;
  subattachments?: {
    data?: GraphAttachment[];
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
  };
  object?: {
    id?: string;
  };
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

function attachmentImageUrl(
  attachments: GraphPostResult["attachments"],
): string | null {
  const stack = [...(attachments?.data ?? [])];

  while (stack.length > 0) {
    const attachment = stack.shift();

    if (!attachment) {
      continue;
    }

    const image =
      cleanString(attachment.media?.image?.src) ??
      cleanString(attachment.media?.source);

    if (image) {
      return image;
    }

    stack.push(...(attachment.subattachments?.data ?? []));
  }

  return null;
}

function fallbackFacebookPostUrl(
  postId: string,
  pageId?: string,
): string | null {
  const parts = postId.split("_").filter(Boolean);

  if (parts.length >= 2) {
    const ownerId = parts[0];
    const objectId = parts.slice(1).join("_");

    return `https://www.facebook.com/${encodeURIComponent(ownerId)}/posts/${encodeURIComponent(objectId)}`;
  }

  const normalizedPageId = pageId?.trim();

  if (normalizedPageId) {
    return `https://www.facebook.com/${encodeURIComponent(normalizedPageId)}/posts/${encodeURIComponent(postId)}`;
  }

  return null;
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
  pageId,
}: {
  result: GraphPostResult;
  postId: string;
  pageId?: string;
}): FacebookPostPreview {
  return {
    id: cleanString(result.id) ?? postId,
    message: cleanString(result.message),
    full_picture:
      cleanString(result.full_picture) ??
      attachmentImageUrl(result.attachments),
    permalink_url:
      cleanString(result.permalink_url) ??
      fallbackFacebookPostUrl(postId, pageId),
    created_time: cleanString(result.created_time),
  };
}

export async function getFacebookPostPreview(
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
    /*
     * Fast path used by the original TENH comment card. Keep the field set
     * small so normal Page posts remain one inexpensive Graph request.
     */
    const primary = await requestWithTokenRepair({
      graphVersion,
      postId: normalizedPostId,
      pageId,
      accessToken: pageAccessToken,
      fields: "id,message,full_picture,permalink_url,created_time",
    });

    pageAccessToken = primary.accessToken;

    if (
      primary.requestResult.response.ok &&
      !primary.requestResult.result.error
    ) {
      const preview = normalizePreview({
        result: primary.requestResult.result,
        postId: normalizedPostId,
        pageId,
      });

      if (preview.full_picture) {
        return preview;
      }

      /*
       * Some photo/video/Reel-backed Page posts omit full_picture while still
       * exposing media through attachments. Ask for that shape only when the
       * normal response has no image; failure here never hides the card.
       */
      const mediaFallback = await requestWithTokenRepair({
        graphVersion,
        postId: normalizedPostId,
        pageId,
        accessToken: pageAccessToken,
        fields:
          "id,message,permalink_url,created_time,attachments{media,subattachments{media}}",
      });

      if (
        mediaFallback.requestResult.response.ok &&
        !mediaFallback.requestResult.result.error
      ) {
        const fallbackPreview = normalizePreview({
          result: mediaFallback.requestResult.result,
          postId: normalizedPostId,
          pageId,
        });

        return {
          ...preview,
          message: preview.message ?? fallbackPreview.message,
          full_picture:
            preview.full_picture ?? fallbackPreview.full_picture,
          permalink_url:
            preview.permalink_url ?? fallbackPreview.permalink_url,
          created_time:
            preview.created_time ?? fallbackPreview.created_time,
        };
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
      return normalizePreview({
        result: fallback.requestResult.result,
        postId: normalizedPostId,
        pageId,
      });
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

export async function getFacebookPostIdForComment(
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
      fields: "object",
    });

    if (
      !request.requestResult.response.ok ||
      request.requestResult.result.error
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
