import "server-only";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
export type FacebookPostPreview = {
  id: string;
  message: string | null;
  full_picture: string | null;
  permalink_url: string | null;
  created_time: string | null;
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

export async function getFacebookPostPreview(
  postId: string,
): Promise<FacebookPostPreview | null> {
  const normalizedPostId =
    postId.trim();

  if (!normalizedPostId) {
    return null;
  }

 const pageAccessToken =
  await getFacebookPageAccessToken(
  );
  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  const fields = [
    "id",
    "message",
    "full_picture",
    "permalink_url",
    "created_time",
  ].join(",");

  const url =
    `https://graph.facebook.com/${graphVersion}/${normalizedPostId}` +
    `?fields=${encodeURIComponent(
      fields,
    )}` +
    `&access_token=${encodeURIComponent(
      pageAccessToken,
    )}`;

  try {
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

    let result: GraphPostResult =
      {};

    if (responseText.trim()) {
      try {
        result =
          JSON.parse(
            responseText,
          ) as GraphPostResult;
      } catch {
        console.warn(
          "Facebook post preview returned invalid JSON.",
        );

        return null;
      }
    }

    if (!response.ok) {
      console.warn(
        "Unable to load Facebook post preview.",
        {
          postId:
            normalizedPostId,
          status:
            response.status,
          error:
            result.error,
        },
      );

      /*
       * Do not block comment ingestion just because
       * the post preview cannot be loaded.
       */
      return null;
    }

    return {
      id:
        result.id ??
        normalizedPostId,

      message:
        result.message?.trim() ??
        null,

      full_picture:
        result.full_picture?.trim() ??
        null,

      permalink_url:
        result.permalink_url?.trim() ??
        null,

      created_time:
        result.created_time?.trim() ??
        null,
    };
  } catch (error) {
    console.warn(
      "Facebook post preview request failed:",
      error,
    );

    return null;
  }
}