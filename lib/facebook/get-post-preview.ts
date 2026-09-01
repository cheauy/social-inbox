import "server-only";

import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

export type FacebookPostPreview = {
  id: string;
  message:
    | string
    | null;
  full_picture:
    | string
    | null;
  permalink_url:
    | string
    | null;
  created_time:
    | string
    | null;
};

type GraphPostResult = {
  id?: string;
  message?: string;
  full_picture?: string;
  permalink_url?: string;
  created_time?: string;
  error?: {
    message?: string;
    code?: number;
  };
};

type GraphPostRequestResult = {
  response: Response;
  result: GraphPostResult;
};

async function requestFacebookPostPreview({
  graphVersion,
  postId,
  accessToken,
}: {
  graphVersion: string;
  postId: string;
  accessToken: string;
}): Promise<GraphPostRequestResult> {
  const url =
    new URL(
      `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(postId)}`,
    );

  url.searchParams.set(
    "fields",
    [
      "id",
      "message",
      "full_picture",
      "permalink_url",
      "created_time",
    ].join(","),
  );

  url.searchParams.set(
    "access_token",
    accessToken,
  );

  const response =
    await fetch(
      url,
      {
        method: "GET",
        cache: "no-store",
      },
    );

  const responseText =
    await response.text();

  let result:
    GraphPostResult = {};

  if (
    responseText.trim()
  ) {
    try {
      result =
        JSON.parse(
          responseText,
        ) as GraphPostResult;
    } catch {
      console.warn(
        "[Tenh Facebook Post Preview] Invalid JSON.",
      );
    }
  }

  return {
    response,
    result,
  };
}

export async function getFacebookPostPreview(
  postId: string,
  pageId?: string,
): Promise<FacebookPostPreview | null> {
  const normalizedPostId =
    postId.trim();

  if (!normalizedPostId) {
    return null;
  }

  let pageAccessToken:
    string;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (error) {
    console.warn(
      "[Tenh Facebook Post Preview] No Page token; skipping preview.",
      error,
    );
    return null;
  }

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  try {
    let requestResult =
      await requestFacebookPostPreview({
        graphVersion,
        postId: normalizedPostId,
        accessToken:
          pageAccessToken,
      });

    /*
     * A stale Page token must not silently remove the Facebook content card.
     * TENH already stores the authorized User token, so if Meta reports a
     * normal token error, re-derive the Page token once and retry the same
     * read. This never bypasses Meta authorization; revoked access still
     * falls through safely and requires reconnecting.
     */
    if (
      (
        !requestResult.response.ok ||
        requestResult.result.error
      ) &&
      isFacebookAccessTokenError(
        requestResult.result.error,
      )
    ) {
      try {
        pageAccessToken =
          await refreshFacebookPageAccessToken(
            pageId,
          );

        requestResult =
          await requestFacebookPostPreview({
            graphVersion,
            postId:
              normalizedPostId,
            accessToken:
              pageAccessToken,
          });
      } catch (refreshError) {
        console.warn(
          "[Tenh Facebook Post Preview] Automatic Page-token recovery failed.",
          refreshError,
        );
      }
    }

    const {
      response,
      result,
    } = requestResult;

    if (
      !response.ok ||
      result.error
    ) {
      console.warn(
        "[Tenh Facebook Post Preview] Unable to load preview.",
        {
          postId:
            normalizedPostId,
          status:
            response.status,
          error:
            result.error,
        },
      );
      return null;
    }

    return {
      id:
        result.id ??
        normalizedPostId,
      message:
        result.message
          ?.trim() ??
        null,
      full_picture:
        result
          .full_picture
          ?.trim() ??
        null,
      permalink_url:
        result
          .permalink_url
          ?.trim() ??
        null,
      created_time:
        result
          .created_time
          ?.trim() ??
        null,
    };
  } catch (error) {
    console.warn(
      "[Tenh Facebook Post Preview] Request failed.",
      error,
    );
    return null;
  }
}
