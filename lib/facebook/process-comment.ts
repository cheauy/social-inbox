import "server-only";

import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  getFacebookPostPreview,
  type FacebookPostPreview,
} from "@/lib/facebook/get-post-preview";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  markFacebookCommentThreadDeleted,
} from "@/lib/facebook/mark-comment-thread-deleted";

export type FacebookFeedCommentValue = {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  message?: string;
  created_time?:
    | number
    | string;
  from?: {
    id?: string;
    name?: string;
    picture?: unknown;
    profile_pic?: string;
    profile_picture_url?: string;
  };
  [key: string]:
    unknown;
};

type ProcessFacebookCommentInput = {
  pageId: string;
  value:
    FacebookFeedCommentValue;
};

function cleanString(
  value: unknown,
) {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function profilePictureFromValue(
  value: unknown,
): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const direct =
    cleanString(value.profile_pic) ??
    cleanString(value.profile_picture_url);

  if (direct) {
    return direct;
  }

  if (isRecord(value.picture)) {
    const directPicture =
      cleanString(value.picture.url);

    if (directPicture) {
      return directPicture;
    }

    if (isRecord(value.picture.data)) {
      return cleanString(
        value.picture.data.url,
      );
    }
  }

  return null;
}

function webhookPostPreviewFromValue(
  value: FacebookFeedCommentValue,
  postId: string | null,
): FacebookPostPreview | null {
  if (!postId) {
    return null;
  }

  const post =
    isRecord(value.post)
      ? value.post
      : null;

  const message =
    cleanString(post?.message) ??
    cleanString(value.post_message) ??
    cleanString(value.post_description);

  const fullPicture =
    cleanString(post?.full_picture) ??
    cleanString(post?.picture) ??
    cleanString(value.full_picture);

  const permalinkUrl =
    cleanString(post?.permalink_url) ??
    cleanString(value.permalink_url);

  const createdTime =
    cleanString(post?.created_time);

  return {
    id:
      cleanString(post?.id) ??
      postId,
    message,
    full_picture:
      fullPicture,
    permalink_url:
      permalinkUrl,
    created_time:
      createdTime,
  };
}

type CommentAuthorProfileResult = {
  name: string | null;
  profilePictureUrl: string | null;
  accessToken: string;
};

async function fetchCommentAuthorProfile({
  commentId,
  pageId,
  accessToken,
}: {
  commentId: string;
  pageId: string;
  accessToken: string;
}): Promise<CommentAuthorProfileResult> {
  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION ??
    "v26.0";

  async function request(token: string) {
    const url =
      new URL(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(commentId)}`,
      );

    /*
     * Keep this optional request separate from the core comment lookup. Some
     * Meta account/privacy combinations omit nested picture data. If that
     * happens, the comment itself must still be saved normally.
     */
    url.searchParams.set(
      "fields",
      "from{id,name,picture}",
    );
    url.searchParams.set(
      "access_token",
      token,
    );

    const controller =
      new AbortController();
    const timeout =
      setTimeout(
        () => controller.abort(),
        1200,
      );

    try {
      const response =
        await fetch(
          url,
          {
            method: "GET",
            cache: "no-store",
            signal:
              controller.signal,
          },
        );
      const text =
        await response.text();

      let result:
        Record<string, unknown> = {};

      if (text.trim()) {
        try {
          result =
            JSON.parse(text) as Record<string, unknown>;
        } catch {
          result = {};
        }
      }

      return {
        response,
        result,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  let currentToken =
    accessToken;
  let responseResult =
    await request(currentToken);
  const firstError =
    isRecord(responseResult.result.error)
      ? responseResult.result.error
      : null;

  if (
    (
      !responseResult.response.ok ||
      firstError
    ) &&
    isFacebookAccessTokenError(
      firstError as { code?: number } | null,
    )
  ) {
    try {
      currentToken =
        await refreshFacebookPageAccessToken(
          pageId,
        );
      responseResult =
        await request(currentToken);
    } catch (error) {
      console.warn(
        "[Tenh Facebook Comment] Optional commenter profile token recovery failed.",
        error,
      );
    }
  }

  if (!responseResult.response.ok) {
    return {
      name: null,
      profilePictureUrl:
        null,
      accessToken:
        currentToken,
    };
  }

  const from =
    isRecord(responseResult.result.from)
      ? responseResult.result.from
      : null;

  let profilePictureUrl =
    profilePictureFromValue(from);

  /*
   * Business Asset User Profile Access can expose a commenter's picture via
   * the profile picture edge even when the nested `from.picture` field is
   * omitted. Keep this as a short, optional fallback so a rejected/private
   * picture request can never delay or break Facebook comment ingestion.
   */
  const fromId =
    cleanString(from?.id);

  if (!profilePictureUrl && fromId) {
    const pictureController =
      new AbortController();
    const pictureTimeout =
      setTimeout(
        () => pictureController.abort(),
        900,
      );

    try {
      const pictureUrl =
        new URL(
          `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(fromId)}/picture`,
        );

      pictureUrl.searchParams.set(
        "redirect",
        "false",
      );
      pictureUrl.searchParams.set(
        "type",
        "normal",
      );
      pictureUrl.searchParams.set(
        "access_token",
        currentToken,
      );

      const pictureResponse =
        await fetch(
          pictureUrl,
          {
            method: "GET",
            cache: "no-store",
            signal:
              pictureController.signal,
          },
        );
      const pictureText =
        await pictureResponse.text();

      if (pictureResponse.ok && pictureText.trim()) {
        try {
          const pictureResult =
            JSON.parse(pictureText) as Record<string, unknown>;
          const pictureData =
            isRecord(pictureResult.data)
              ? pictureResult.data
              : null;
          const isSilhouette =
            pictureData?.is_silhouette === true;

          if (!isSilhouette) {
            profilePictureUrl =
              cleanString(pictureData?.url) ??
              profilePictureUrl;
          }
        } catch {
          // Optional avatar fallback only; keep the comment flow healthy.
        }
      }
    } catch {
      // Optional avatar fallback only; initials remain the safe fallback.
    } finally {
      clearTimeout(pictureTimeout);
    }
  }

  return {
    name:
      cleanString(from?.name),
    profilePictureUrl,
    accessToken:
      currentToken,
  };
}

function toIso(
  value?:
    | number
    | string,
) {
  if (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  ) {
    const milliseconds =
      value < 1_000_000_000_000
        ? value * 1000
        : value;

    return new Date(
      milliseconds,
    ).toISOString();
  }

  if (
    typeof value ===
      "string" &&
    value.trim()
  ) {
    const numeric =
      Number(value);

    if (
      Number.isFinite(
        numeric,
      )
    ) {
      return toIso(
        numeric,
      );
    }

    const parsed =
      new Date(value);

    if (
      !Number.isNaN(
        parsed.getTime(),
      )
    ) {
      return parsed.toISOString();
    }
  }

  return new Date()
    .toISOString();
}


type ExistingFacebookCommentConversation = {
  id: string;
  business_id: string;
  social_account_id: string;
  contact_id: string | null;
  unread_count: number | null;
  facebook_comment_id: string | null;
  facebook_post_id: string | null;
  parent_comment_id: string | null;
};

async function loadExistingFacebookCommentConversation({
  conversationId,
  socialAccountId,
}: {
  conversationId: string;
  socialAccountId: string;
}): Promise<ExistingFacebookCommentConversation | null> {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      social_account_id,
      contact_id,
      unread_count,
      facebook_comment_id,
      facebook_post_id,
      parent_comment_id
    `)
    .eq("id", conversationId)
    .eq("social_account_id", socialAccountId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ExistingFacebookCommentConversation | null;
}

async function findExistingFacebookCommentConversationByReference({
  socialAccountId,
  commentId,
}: {
  socialAccountId: string;
  commentId: string;
}): Promise<ExistingFacebookCommentConversation | null> {
  const normalizedCommentId = commentId.trim();

  if (!normalizedCommentId) {
    return null;
  }

  const {
    data: message,
    error: messageError,
  } = await supabaseAdmin
    .from("messages")
    .select("conversation_id")
    .eq("platform_message_id", normalizedCommentId)
    .maybeSingle();

  if (messageError) {
    throw new Error(messageError.message);
  }

  if (message?.conversation_id) {
    const conversation =
      await loadExistingFacebookCommentConversation({
        conversationId: message.conversation_id,
        socialAccountId,
      });

    if (conversation) {
      return conversation;
    }
  }

  /*
   * Older TENH rows can still have the root comment on the conversation even
   * when the individual message row is unavailable. Match only the exact
   * facebook_comment_id here; parent_comment_id is intentionally not used as
   * a standalone lookup because several customers can reply to the same
   * parent and picking one would be unsafe.
   */
  const {
    data: rootConversation,
    error: rootConversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      social_account_id,
      contact_id,
      unread_count,
      facebook_comment_id,
      facebook_post_id,
      parent_comment_id
    `)
    .eq("social_account_id", socialAccountId)
    .eq("facebook_comment_id", normalizedCommentId)
    .maybeSingle();

  if (rootConversationError) {
    throw new Error(rootConversationError.message);
  }

  return rootConversation as ExistingFacebookCommentConversation | null;
}

async function findFacebookCommentConversationForCustomer({
  businessId,
  socialAccountId,
  platformUserId,
}: {
  businessId: string;
  socialAccountId: string;
  platformUserId: string;
}): Promise<ExistingFacebookCommentConversation | null> {
  const normalizedPlatformUserId = platformUserId.trim();

  if (!normalizedPlatformUserId) {
    return null;
  }

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("business_id", businessId)
    .eq("platform", "facebook")
    .eq("platform_user_id", normalizedPlatformUserId)
    .maybeSingle();

  if (contactError) {
    throw new Error(contactError.message);
  }

  if (!contact?.id) {
    return null;
  }

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      social_account_id,
      contact_id,
      unread_count,
      facebook_comment_id,
      facebook_post_id,
      parent_comment_id
    `)
    .eq("social_account_id", socialAccountId)
    .eq("contact_id", contact.id)
    .maybeSingle();

  if (conversationError) {
    throw new Error(conversationError.message);
  }

  return conversation as ExistingFacebookCommentConversation | null;
}

type CommentParentGraphResult = {
  parent?: {
    id?: string;
  } | null;
  from?: {
    id?: string;
  } | null;
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
};

async function resolveFacebookCommentConversationFromParentChain({
  businessId,
  socialAccountId,
  pageId,
  startingCommentId,
  pageAccessToken,
}: {
  businessId: string;
  socialAccountId: string;
  pageId: string;
  startingCommentId: string;
  pageAccessToken: string | null;
}): Promise<{
  conversation: ExistingFacebookCommentConversation | null;
  accessToken: string | null;
}> {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION ?? "v26.0";
  const visited = new Set<string>();
  let currentCommentId = startingCommentId.trim();
  let currentAccessToken = pageAccessToken;

  /*
   * Facebook comment threads can be nested. Walk a small, bounded parent
   * chain so replies made in Business Suite, replies to old replies, and
   * replies on older posts can reconnect to a TENH thread without guessing.
   */
  for (let depth = 0; depth < 8 && currentCommentId; depth += 1) {
    if (visited.has(currentCommentId)) {
      break;
    }

    visited.add(currentCommentId);

    const localConversation =
      await findExistingFacebookCommentConversationByReference({
        socialAccountId,
        commentId: currentCommentId,
      });

    if (localConversation) {
      return {
        conversation: localConversation,
        accessToken: currentAccessToken,
      };
    }

    if (!currentAccessToken) {
      break;
    }

    const requestParent = async (token: string) => {
      const url = new URL(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(currentCommentId)}`,
      );
      url.searchParams.set("fields", "parent{id},from{id}");
      url.searchParams.set("access_token", token);

      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
      });
      const text = await response.text();
      let result: CommentParentGraphResult = {};

      if (text.trim()) {
        try {
          result = JSON.parse(text) as CommentParentGraphResult;
        } catch {
          result = {};
        }
      }

      return { response, result };
    };

    let attempt = await requestParent(currentAccessToken);

    if (
      (!attempt.response.ok || attempt.result.error) &&
      isFacebookAccessTokenError(attempt.result.error)
    ) {
      try {
        currentAccessToken =
          await refreshFacebookPageAccessToken(pageId);
        attempt = await requestParent(currentAccessToken);
      } catch (error) {
        console.warn(
          "[Tenh Facebook Comment] Parent-chain token recovery failed.",
          error,
        );
      }
    }

    if (!attempt.response.ok || attempt.result.error) {
      break;
    }

    const authorId = cleanString(attempt.result.from?.id);

    /*
     * If an old individual comment row is gone, the customer identity is a
     * safe fallback because TENH's current schema has one conversation per
     * Facebook customer per Page. Never use the Page itself as a customer.
     */
    if (authorId && authorId !== pageId) {
      const customerConversation =
        await findFacebookCommentConversationForCustomer({
          businessId,
          socialAccountId,
          platformUserId: authorId,
        });

      if (customerConversation) {
        return {
          conversation: customerConversation,
          accessToken: currentAccessToken,
        };
      }
    }

    currentCommentId = cleanString(attempt.result.parent?.id) ?? "";
  }

  return {
    conversation: null,
    accessToken: currentAccessToken,
  };
}

export async function processFacebookComment({
  pageId,
  value,
}: ProcessFacebookCommentInput) {
  if (
    value.item !==
    "comment"
  ) {
    return;
  }

  const commentId =
    value.comment_id
      ?.trim();

  if (!commentId) {
    return;
  }

  /*
   * DELETE / REMOVE
   */
  if (
    value.verb ===
    "remove"
  ) {
    const actorId =
      value.from?.id
        ?.trim() ??
      null;

    const {
      data:
        existingMessage,
      error:
        existingMessageError,
    } =
      await supabaseAdmin
        .from(
          "messages",
        )
        .select(`
          id,
          conversation_id,
          comment_deleted_by
        `)
        .eq(
          "platform_message_id",
          commentId,
        )
        .maybeSingle();

    if (
      existingMessageError
    ) {
      throw new Error(
        existingMessageError
          .message,
      );
    }

    if (
      !existingMessage
    ) {
      console.warn(
        "[Tenh Facebook Comment] Deleted comment was not found locally.",
        {
          commentId,
          actorId,
        },
      );
      return;
    }

    const deletedBy:
      | "customer"
      | "page" =
      existingMessage
        .comment_deleted_by ===
        "page"
        ? "page"
        : actorId === pageId
          ? "page"
          : "customer";

    await markFacebookCommentThreadDeleted({
      pageId,
      commentId,
      deletedBy,
    });

    console.log(
      "[Tenh Facebook Comment] ✅ DELETED",
      {
        commentId,
        deletedBy,
      },
    );

    return;
  }

  if (
    value.verb !==
    "add"
  ) {
    return;
  }

  /*
   * V3.1.17 — multi-Page routing.
   * Do not compare against one FACEBOOK_PAGE_ID. The incoming Page is
   * validated against the active social_accounts record below.
   */

  const webhookPost =
    isRecord(value.post)
      ? value.post
      : null;

  let postId =
    cleanString(value.post_id) ??
    cleanString(webhookPost?.id);

  /*
   * Keep one normalized parent ID for the entire ingest path. Some Meta feed
   * events for replies-to-replies omit parent_id even though the Graph
   * comment object still exposes parent{id}. Recover it best-effort below so
   * customer replies to a Page/TENH reply cannot disappear from the thread.
   */
  let normalizedParentId =
    cleanString(value.parent_id);

  let message =
    value.message
      ?.trim() ??
    "";

  let authorId =
    value.from?.id
      ?.trim() ??
    "";

  let authorName =
    value.from?.name
      ?.trim() ??
    null;

  let authorProfilePictureUrl =
    profilePictureFromValue(
      value.from,
    );

  let createdTime =
    value.created_time;

  let pageAccessToken:
    | string
    | null =
    null;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (error) {
    console.warn(
      "[Tenh Facebook Comment] No OAuth Page token for optional Graph enrichment.",
      error,
    );
  }

  /*
   * Feed webhook payload usually contains from.name already.
   * If message/author data is incomplete, enrich best-effort from Graph.
   * Never fail the webhook just because the enrichment request fails.
   */
  if (
    (
      !message ||
      !authorId ||
      !authorName ||
      !normalizedParentId ||
      !postId
    ) &&
    pageAccessToken
  ) {
    try {
      const graphVersion =
        process.env
          .FACEBOOK_GRAPH_API_VERSION ??
        "v26.0";

      const url =
        new URL(
          `https://graph.facebook.com/${graphVersion}/${commentId}`,
        );

      url.searchParams.set(
        "fields",
        "id,message,from,created_time,parent,object",
      );
      url.searchParams.set(
        "access_token",
        pageAccessToken,
      );

      type CommentGraphResult = {
        message?: string;
        created_time?: string;
        from?: {
          id?: string;
          name?: string;
        };
        parent?: {
          id?: string;
        } | null;
        object?: {
          id?: string;
        };
        error?: {
          message?: string;
          code?: number;
        };
      };

      const requestComment =
        async (token: string) => {
          url.searchParams.set(
            "access_token",
            token,
          );

          const response =
            await fetch(
              url,
              {
                method: "GET",
                cache: "no-store",
              },
            );

          const text =
            await response.text();

          let result:
            CommentGraphResult = {};

          if (text.trim()) {
            try {
              result =
                JSON.parse(
                  text,
                ) as CommentGraphResult;
            } catch {
              console.warn(
                "[Tenh Facebook Comment] Graph enrichment returned invalid JSON.",
              );
            }
          }

          return {
            response,
            result,
          };
        };

      let {
        response,
        result,
      } = await requestComment(
        pageAccessToken,
      );

      /*
       * If only the stored Page token went stale, recover it once from TENH's
       * already-authorized encrypted User token and retry. Revoked Facebook
       * authorization still fails safely and requires a real reconnect.
       */
      if (
        (
          !response.ok ||
          result.error
        ) &&
        isFacebookAccessTokenError(
          result.error,
        )
      ) {
        try {
          pageAccessToken =
            await refreshFacebookPageAccessToken(
              pageId,
            );

          ({
            response,
            result,
          } = await requestComment(
            pageAccessToken,
          ));
        } catch (refreshError) {
          console.warn(
            "[Tenh Facebook Comment] Automatic Page-token recovery failed during comment enrichment.",
            refreshError,
          );
        }
      }

      if (
        response.ok &&
        !result.error
      ) {
        message =
          result.message
            ?.trim() ||
          message;

        authorId =
          result.from?.id
            ?.trim() ||
          authorId;

        authorName =
          result.from?.name
            ?.trim() ||
          authorName;

        normalizedParentId =
          result.parent?.id
            ?.trim() ||
          normalizedParentId;

        /*
         * Some feed webhook variants can omit post_id. The Comment Graph
         * object exposes the object the comment belongs to, so recover the
         * Page post ID here before building the post content card. This is
         * best-effort only and never blocks saving the customer comment.
         */
        postId =
          postId ??
          result.object?.id
            ?.trim() ??
          null;

        if (
          result.created_time
        ) {
          createdTime =
            result.created_time;
        }
      } else {
        console.warn(
          "[Tenh Facebook Comment] Graph enrichment failed but webhook data will still be saved.",
          {
            status:
              response.status,
            error:
              result.error,
          },
        );
      }
    } catch (error) {
      console.warn(
        "[Tenh Facebook Comment] Graph enrichment request failed but webhook data will still be saved.",
        error,
      );
    }
  }

  if (!message) {
    message =
      "Facebook comment";
  }

  if (
    !authorId
  ) {
    console.warn(
      "[Tenh Facebook Comment] Cannot save comment because author ID is missing.",
      {
        commentId,
        postId,
      },
    );
    return;
  }

  const isPageAuthored =
    authorId === pageId;

  /*
   * Best-effort commenter identity enrichment. Keep the profile request
   * separate from the core comment request so a missing/private Facebook
   * picture can never block comment ingestion. When Meta exposes the real
   * picture, save it on the contact and on this message payload so the Inbox
   * can render it immediately without waiting for a contact-list refresh.
   */
  if (
    !isPageAuthored &&
    pageAccessToken
  ) {
    try {
      const profile =
        await fetchCommentAuthorProfile({
          commentId,
          pageId,
          accessToken:
            pageAccessToken,
        });

      pageAccessToken =
        profile.accessToken;
      authorName =
        profile.name ??
        authorName;
      authorProfilePictureUrl =
        profile.profilePictureUrl ??
        authorProfilePictureUrl;
    } catch (error) {
      console.warn(
        "[Tenh Facebook Comment] Optional commenter profile lookup failed; keeping webhook identity.",
        error,
      );
    }
  }

  /*
   * Duplicate protection must run BEFORE Page-reply handling.
   * TENH already saves replies it sends itself. Meta can later echo the same
   * reply through the Page feed webhook, so an existing platform_message_id
   * means there is nothing else to save.
   */
  const {
    data:
      existingMessage,
    error:
      duplicateError,
  } =
    await supabaseAdmin
      .from("messages")
      .select("id")
      .eq(
        "platform_message_id",
        commentId,
      )
      .maybeSingle();

  if (duplicateError) {
    throw new Error(
      duplicateError.message,
    );
  }

  if (existingMessage) {
    return;
  }

  const {
    data:
      socialAccount,
    error:
      accountError,
  } =
    await supabaseAdmin
      .from(
        "social_accounts",
      )
      .select(`
        id,
        business_id
      `)
      .eq(
        "platform",
        "facebook",
      )
      .eq(
        "platform_account_id",
        pageId,
      )
      .eq(
        "is_active",
        true,
      )
      .maybeSingle();

  if (accountError) {
    throw new Error(
      accountError.message,
    );
  }

  if (!socialAccount) {
    throw new Error(
      `Facebook Page ${pageId} was not found in social_accounts.`,
    );
  }

  const commentTime =
    toIso(createdTime);

  /*
   * V3.11.33 — Page replies created outside TENH (for example Meta Business
   * Suite) must still appear in the existing customer comment thread.
   *
   * Do NOT create the Facebook Page itself as a contact. Instead, resolve the
   * customer conversation from the reply's parent comment, save the new
   * comment as outgoing, keep unread_count unchanged, and return.
   */
  if (isPageAuthored) {
    const rawParentCommentId =
      normalizedParentId;
    const parentCommentId =
      rawParentCommentId &&
      rawParentCommentId !== postId
        ? rawParentCommentId
        : null;

    if (!parentCommentId) {
      console.log(
        "[Tenh Facebook Comment] Page-authored top-level comment ignored because it is not a reply to a TENH customer thread.",
        {
          pageId,
          commentId,
        },
      );
      return;
    }

    const resolvedThread =
      await resolveFacebookCommentConversationFromParentChain({
        businessId:
          socialAccount.business_id,
        socialAccountId:
          socialAccount.id,
        pageId,
        startingCommentId:
          parentCommentId,
        pageAccessToken,
      });

    pageAccessToken =
      resolvedThread.accessToken;

    const targetConversation =
      resolvedThread.conversation;

    if (!targetConversation) {
      console.warn(
        "[Tenh Facebook Comment] Page reply could not be matched to an existing customer thread.",
        {
          pageId,
          commentId,
          parentCommentId,
        },
      );
      return;
    }

    if (!targetConversation.contact_id) {
      console.warn(
        "[Tenh Facebook Comment] Page reply matched a conversation without a customer contact.",
        {
          pageId,
          commentId,
          parentCommentId,
          targetConversationId:
            targetConversation.id,
        },
      );
      return;
    }

    const {
      data:
        recipientContact,
      error:
        recipientContactError,
    } =
      await supabaseAdmin
        .from("contacts")
        .select(`
          platform_user_id
        `)
        .eq(
          "id",
          targetConversation.contact_id,
        )
        .eq(
          "business_id",
          socialAccount.business_id,
        )
        .maybeSingle();

    if (recipientContactError) {
      throw new Error(
        recipientContactError.message,
      );
    }

    const recipientId =
      recipientContact
        ?.platform_user_id ??
      null;

    let pageReplyPostPreview:
      FacebookPostPreview | null =
      webhookPostPreviewFromValue(
        value,
        postId,
      );

    if (postId) {
      try {
        pageReplyPostPreview =
          (
            await getFacebookPostPreview(
              postId,
              pageId,
            )
          ) ??
          pageReplyPostPreview;
      } catch (error) {
        console.warn(
          "[Tenh Facebook Comment] Page reply post preview failed; keeping webhook preview when available.",
          error,
        );
      }
    }

    const {
      error:
        pageReplyMessageError,
    } =
      await supabaseAdmin
        .from("messages")
        .insert({
          business_id:
            socialAccount
              .business_id,
          conversation_id:
            targetConversation.id,
          platform_message_id:
            commentId,
          sender_platform_id:
            pageId,
          recipient_platform_id:
            recipientId,
          direction:
            "outgoing",
          message_type:
            "text",
          message_text:
            message,
          attachment_url:
            null,
          is_echo:
            true,
          raw_payload: {
            ...value,
            parent_id:
              normalizedParentId ??
              value.parent_id ??
              null,
            // Keep the same metadata shape used by TENH's native
            // Facebook comment-reply route so the current MessagePanel
            // renders this Business Suite reply nested under its parent.
            source:
              "facebook_comment_reply",
            parent_comment_id:
              parentCommentId,
            reply_comment_id:
              commentId,
            tenh_source:
              "facebook_page_reply",
            post_preview:
              pageReplyPostPreview,
          },
          platform_created_at:
            commentTime,
        });

    if (pageReplyMessageError) {
      throw new Error(
        pageReplyMessageError.message,
      );
    }

    const {
      error:
        pageReplyConversationError,
    } =
      await supabaseAdmin
        .from("conversations")
        .update({
          source_type:
            "comment",
          last_message_text:
            message,
          last_message_at:
            commentTime,
          /*
           * A Page/agent reply is outgoing, so it must not create unread work
           * for TENH agents. Preserve the existing unread count exactly.
           */
          unread_count:
            targetConversation
              .unread_count ??
            0,
          status:
            "open",
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          targetConversation.id,
        );

    if (pageReplyConversationError) {
      throw new Error(
        pageReplyConversationError.message,
      );
    }

    console.log(
      "[Tenh Facebook Comment] ✅ PAGE REPLY SAVED",
      {
        conversationId:
          targetConversation.id,
        commentId,
        parentCommentId,
        recipientId,
        message,
      },
    );

    return;
  }

  /*
   * IMPORTANT:
   * feed comment payloads include `from.name`, so save it directly.
   * Do not overwrite an existing real customer name with null.
   */
  const contactPayload:
    Record<
      string,
      unknown
    > = {
    business_id:
      socialAccount
        .business_id,
    platform:
      "facebook",
    platform_user_id:
      authorId,
    last_contact_at:
      commentTime,
    updated_at:
      new Date()
        .toISOString(),
  };

  if (authorName) {
    contactPayload
      .full_name =
      authorName;
  }

  if (authorProfilePictureUrl) {
    contactPayload
      .profile_picture_url =
      authorProfilePictureUrl;
  }

  const {
    data: contact,
    error:
      contactError,
  } =
    await supabaseAdmin
      .from("contacts")
      .upsert(
        contactPayload,
        {
          onConflict:
            "business_id,platform,platform_user_id",
        },
      )
      .select("id")
      .single();

  if (
    contactError ||
    !contact
  ) {
    throw new Error(
      contactError
        ?.message ??
        "Unable to create Facebook comment contact.",
    );
  }

  const rawIncomingParentCommentId =
    normalizedParentId;
  const incomingParentCommentId =
    rawIncomingParentCommentId &&
    rawIncomingParentCommentId !== postId
      ? rawIncomingParentCommentId
      : null;

  let conversation:
    ExistingFacebookCommentConversation | null =
    null;

  /*
   * If this is a reply inside an existing Facebook thread, keep it attached
   * to that existing customer conversation. This is especially important for
   * customers replying to an old Page reply or to a comment on an older post:
   * do not overwrite the conversation's thread identity just because the
   * newest webhook event is nested.
   */
  if (incomingParentCommentId) {
    const resolvedThread =
      await resolveFacebookCommentConversationFromParentChain({
        businessId:
          socialAccount.business_id,
        socialAccountId:
          socialAccount.id,
        pageId,
        startingCommentId:
          incomingParentCommentId,
        pageAccessToken,
      });

    pageAccessToken =
      resolvedThread.accessToken;

    if (
      resolvedThread.conversation &&
      resolvedThread.conversation.contact_id ===
        contact.id
    ) {
      conversation =
        resolvedThread.conversation;
    }

    /*
     * The current TENH schema has one Facebook conversation per customer per
     * Page. If Meta cannot expose the old parent chain anymore (for example an
     * ancestor was deleted), reusing this same customer's existing Page
     * conversation is safe. Never attach a nested reply to another customer.
     */
    if (!conversation) {
      const customerConversation =
        await findFacebookCommentConversationForCustomer({
          businessId:
            socialAccount.business_id,
          socialAccountId:
            socialAccount.id,
          platformUserId:
            authorId,
        });

      if (
        customerConversation?.contact_id ===
        contact.id
      ) {
        conversation =
          customerConversation;
      }
    }
  }

  if (!conversation) {
    const {
      data: upsertedConversation,
      error: conversationError,
    } = await supabaseAdmin
      .from("conversations")
      .upsert(
        {
          business_id:
            socialAccount.business_id,
          social_account_id:
            socialAccount.id,
          contact_id:
            contact.id,
          platform:
            "facebook",
          source_type:
            "comment",
          facebook_post_id:
            postId ?? null,
          facebook_comment_id:
            commentId,
          parent_comment_id:
            incomingParentCommentId,
          status:
            "open",
          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "social_account_id,contact_id",
        },
      )
      .select(`
        id,
        business_id,
        social_account_id,
        contact_id,
        unread_count,
        facebook_comment_id,
        facebook_post_id,
        parent_comment_id
      `)
      .single();

    if (
      conversationError ||
      !upsertedConversation
    ) {
      throw new Error(
        conversationError?.message ??
          "Unable to create Facebook comment conversation.",
      );
    }

    conversation =
      upsertedConversation as ExistingFacebookCommentConversation;
  }

  let postPreview:
    FacebookPostPreview | null =
    webhookPostPreviewFromValue(
      value,
      postId,
    );

  if (postId) {
    try {
      postPreview =
        (
          await getFacebookPostPreview(
            postId,
            pageId,
          )
        ) ??
        postPreview;
    } catch (error) {
      console.warn(
        "[Tenh Facebook Comment] Post preview failed; keeping webhook preview when available.",
        error,
      );
    }
  }

  const {
    error:
      messageError,
  } =
    await supabaseAdmin
      .from("messages")
      .insert({
        business_id:
          socialAccount
            .business_id,
        conversation_id:
          conversation.id,
        platform_message_id:
          commentId,
        sender_platform_id:
          authorId,
        recipient_platform_id:
          pageId,
        direction:
          "incoming",
        message_type:
          "text",
        message_text:
          message,
        attachment_url:
          null,
        is_echo:
          false,
        raw_payload: {
          ...value,
          parent_id:
            normalizedParentId ??
            value.parent_id ??
            null,
          commenter_profile_picture_url:
            authorProfilePictureUrl,
          post_preview:
            postPreview,
        },
        platform_created_at:
          commentTime,
      });

  if (messageError) {
    throw new Error(
      messageError.message,
    );
  }

  const unreadCount =
    (
      conversation
        .unread_count ??
      0
    ) + 1;

  const conversationUpdate:
    Record<string, unknown> = {
      source_type:
        "comment",
      last_message_text:
        message,
      last_message_at:
        commentTime,
      unread_count:
        unreadCount,
      status:
        "open",
      updated_at:
        new Date()
          .toISOString(),
    };

  /*
   * A nested reply belongs to the existing Facebook thread. Preserve the
   * conversation's established root/post identifiers so an old-post reply
   * cannot silently turn the thread into a different root. For a new
   * top-level comment, keep the existing TENH behavior and promote it as the
   * current comment context for this customer.
   */
  if (
    !incomingParentCommentId ||
    !conversation.facebook_comment_id
  ) {
    conversationUpdate.facebook_comment_id =
      commentId;
  }

  if (
    !incomingParentCommentId ||
    !conversation.facebook_post_id
  ) {
    conversationUpdate.facebook_post_id =
      postId ?? null;
  }

  if (
    !incomingParentCommentId ||
    !conversation.parent_comment_id
  ) {
    conversationUpdate.parent_comment_id =
      incomingParentCommentId;
  }

  const {
    error:
      updateError,
  } =
    await supabaseAdmin
      .from(
        "conversations",
      )
      .update(
        conversationUpdate,
      )
      .eq(
        "id",
        conversation.id,
      );

  if (updateError) {
    throw new Error(
      updateError.message,
    );
  }

  console.log(
    "[Tenh Facebook Comment] ✅ SAVED",
    {
      conversationId:
        conversation.id,
      commentId,
      authorId,
      authorName,
      message,
    },
  );
}
