import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  processFacebookComment,
  type FacebookFeedCommentValue,
} from "@/lib/facebook/process-comment";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncBody = {
  socialAccountId?: string;
};

type FacebookSocialAccountRow = {
  id: string;
  business_id: string;
  platform: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  facebook_token_status: string | null;
};

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
};

type GraphPost = {
  id?: string;
  message?: string;
  created_time?: string;
};

type GraphCommentAuthor = {
  id?: string;
  name?: string;
};

type GraphCommentParent = {
  id?: string;
};

type GraphComment = {
  id?: string;
  message?: string;
  created_time?: string;
  from?: GraphCommentAuthor;
  parent?: GraphCommentParent;
};

type GraphListResponse<T> = {
  data?: T[];
  error?: GraphError;
};

function redirectToIntegrations(
  request: NextRequest,
  params: {
    message?: string;
    warning?: string;
  },
) {
  const url = new URL(
    "/dashboard/integrations",
    request.nextUrl.origin,
  );

  if (params.message) {
    url.searchParams.set(
      "facebook",
      "connected",
    );
    url.searchParams.set(
      "message",
      params.message,
    );
  }

  if (params.warning) {
    url.searchParams.set(
      "warning",
      params.warning,
    );
  }

  return NextResponse.redirect(
    url,
    303,
  );
}

async function readGraphJson<T>(
  response: Response,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      "Facebook returned invalid JSON while syncing comments.",
    );
  }
}

function toUnixSeconds(
  value?: string,
) {
  if (!value) {
    return Math.floor(
      Date.now() / 1000,
    );
  }

  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    return Math.floor(
      Date.now() / 1000,
    );
  }

  return Math.floor(parsed / 1000);
}

async function fetchPagePosts({
  pageId,
  pageAccessToken,
  graphVersion,
}: {
  pageId: string;
  pageAccessToken: string;
  graphVersion: string;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${pageId}/feed`,
  );

  url.searchParams.set(
    "fields",
    "id,message,created_time",
  );
  url.searchParams.set(
    "limit",
    "20",
  );
  url.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const payload =
    await readGraphJson<
      GraphListResponse<GraphPost>
    >(response);

  if (
    !response.ok ||
    payload.error
  ) {
    throw new Error(
      payload.error?.message ??
        `Unable to load Facebook Page posts (HTTP ${response.status}).`,
    );
  }

  return payload.data ?? [];
}

async function fetchPostComments({
  postId,
  pageAccessToken,
  graphVersion,
}: {
  postId: string;
  pageAccessToken: string;
  graphVersion: string;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${postId}/comments`,
  );

  url.searchParams.set(
    "fields",
    "id,message,from{id,name},created_time,parent{id}",
  );
  url.searchParams.set(
    "filter",
    "stream",
  );
  url.searchParams.set(
    "limit",
    "100",
  );
  url.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  const payload =
    await readGraphJson<
      GraphListResponse<GraphComment>
    >(response);

  if (
    !response.ok ||
    payload.error
  ) {
    throw new Error(
      payload.error?.message ??
        `Unable to load Facebook comments for post ${postId} (HTTP ${response.status}).`,
    );
  }

  return payload.data ?? [];
}

export async function POST(
  request: NextRequest,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return redirectToIntegrations(
      request,
      {
        warning:
          authResult.error,
      },
    );
  }

  if (
    authResult.member.role !==
    "owner"
  ) {
    return redirectToIntegrations(
      request,
      {
        warning:
          "Only the workspace owner can manually sync Facebook comments.",
      },
    );
  }

  let body: SyncBody = {};

  try {
    const contentType =
      request.headers.get(
        "content-type",
      ) ?? "";

    if (
      contentType.includes(
        "application/json",
      )
    ) {
      body =
        (await request.json()) as SyncBody;
    } else {
      const formData =
        await request.formData();
      const rawId =
        formData.get(
          "socialAccountId",
        );

      body.socialAccountId =
        typeof rawId === "string"
          ? rawId
          : undefined;
    }
  } catch {
    return redirectToIntegrations(
      request,
      {
        warning:
          "Unable to read the Facebook comment sync request.",
      },
    );
  }

  const socialAccountId =
    body.socialAccountId?.trim();

  if (!socialAccountId) {
    return redirectToIntegrations(
      request,
      {
        warning:
          "Choose a connected Facebook Page before syncing comments.",
      },
    );
  }

  const {
    data: socialAccountData,
    error: socialAccountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id,
      platform,
      platform_account_id,
      account_name,
      is_active,
      facebook_token_status
    `)
    .eq(
      "id",
      socialAccountId,
    )
    .eq(
      "business_id",
      authResult.member.business_id,
    )
    .maybeSingle();

  if (
    socialAccountError ||
    !socialAccountData
  ) {
    return redirectToIntegrations(
      request,
      {
        warning:
          "Unable to load the connected Facebook Page.",
      },
    );
  }

  const socialAccount =
    socialAccountData as FacebookSocialAccountRow;

  if (
    socialAccount.platform !==
      "facebook" ||
    !socialAccount.is_active ||
    socialAccount.facebook_token_status ===
      "disconnected"
  ) {
    return redirectToIntegrations(
      request,
      {
        warning:
          "This Facebook Page connection is not active.",
      },
    );
  }

  const pageId =
    socialAccount.platform_account_id?.trim();

  if (!pageId) {
    return redirectToIntegrations(
      request,
      {
        warning:
          "This Facebook Page connection is missing its Page ID.",
      },
    );
  }

  try {
    const pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION
        ?.trim() || "v26.0";

    const posts =
      await fetchPagePosts({
        pageId,
        pageAccessToken,
        graphVersion,
      });

    let discoveredCount = 0;
    let processedCount = 0;
    let failedCount = 0;

    for (const post of posts) {
      const postId =
        post.id?.trim();

      if (!postId) {
        continue;
      }

      let comments: GraphComment[];

      try {
        comments =
          await fetchPostComments({
            postId,
            pageAccessToken,
            graphVersion,
          });
      } catch (error) {
        failedCount += 1;
        console.warn(
          "[Tenh Facebook Comment Sync] Unable to load comments for post.",
          {
            pageId,
            postId,
            error:
              error instanceof Error
                ? error.message
                : "Unknown error",
          },
        );
        continue;
      }

      for (const comment of comments) {
        const commentId =
          comment.id?.trim();

        if (!commentId) {
          continue;
        }

        discoveredCount += 1;

        const value = {
          item: "comment",
          verb: "add",
          comment_id:
            commentId,
          post_id: postId,
          parent_id:
            comment.parent?.id?.trim() ||
            postId,
          message:
            comment.message ?? "",
          created_time:
            toUnixSeconds(
              comment.created_time,
            ),
          from:
            comment.from?.id ||
            comment.from?.name
              ? {
                  id:
                    comment.from?.id ??
                    "",
                  name:
                    comment.from?.name ??
                    "Facebook User",
                }
              : undefined,
        } as FacebookFeedCommentValue;

        try {
          await processFacebookComment({
            pageId,
            value,
          });

          processedCount += 1;
        } catch (error) {
          failedCount += 1;
          console.error(
            "[Tenh Facebook Comment Sync] Unable to process comment.",
            {
              pageId,
              postId,
              commentId,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown error",
            },
          );
        }
      }
    }

    const pageName =
      socialAccount.account_name?.trim() ||
      "Facebook Page";

    if (
      discoveredCount === 0
    ) {
      return redirectToIntegrations(
        request,
        {
          warning:
            `No Facebook comments were found on the latest posts for ${pageName}.`,
        },
      );
    }

    if (
      processedCount === 0
    ) {
      return redirectToIntegrations(
        request,
        {
          warning:
            `Facebook returned ${discoveredCount} comment(s), but TENH could not import them. Check Vercel logs for "Tenh Facebook Comment Sync".`,
        },
      );
    }

    return redirectToIntegrations(
      request,
      {
        message:
          `Synced ${processedCount} Facebook comment(s) from ${pageName}${
            failedCount > 0
              ? ` (${failedCount} item(s) could not be processed).`
              : "."
          }`,
      },
    );
  } catch (error) {
    console.error(
      "[Tenh Facebook Comment Sync] Sync failed:",
      error,
    );

    return redirectToIntegrations(
      request,
      {
        warning:
          error instanceof Error
            ? error.message
            : "Unable to sync Facebook comments.",
      },
    );
  }
}
