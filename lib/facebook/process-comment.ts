import "server-only";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

type FacebookCommentAuthor = {
  id?: string;
  name?: string;
};

export type FacebookFeedCommentValue = {
  item?: string;

  verb?: string;

  comment_id?: string;

  post_id?: string;

  parent_id?: string;

  message?: string;

  created_time?: number;

  from?: FacebookCommentAuthor;
};

type ProcessFacebookCommentInput = {
  pageId: string;
  value: FacebookFeedCommentValue;
};

function toIso(
  timestamp?: number,
) {
  if (!timestamp) {
    return new Date().toISOString();
  }

  /*
   * Facebook feed created_time
   * may be seconds rather than milliseconds.
   */
  const milliseconds =
    timestamp < 10_000_000_000
      ? timestamp * 1000
      : timestamp;

  return new Date(
    milliseconds,
  ).toISOString();
}



export async function processFacebookComment({
  pageId,
  value,
}: ProcessFacebookCommentInput) {
  console.log(
    "===== FACEBOOK COMMENT START =====",
    {
      pageId,
      item: value.item,
      verb: value.verb,
      commentId: value.comment_id,
      postId: value.post_id,
      parentId: value.parent_id,
      authorId: value.from?.id,
      authorName: value.from?.name,
      webhookMessage: value.message,
    },
  );

  if (
    value.item !== "comment" ||
    value.verb !== "add"
  ) {
    console.log(
      "COMMENT STOP - not comment/add",
      {
        item: value.item,
        verb: value.verb,
      },
    );

    return;
  }

  const commentId =
    value.comment_id?.trim();

  const postId =
    value.post_id?.trim();

  let message =
    value.message?.trim() ?? "";

  let authorId =
    value.from?.id?.trim() ?? "";

  let authorName =
    value.from?.name?.trim() ??
    null;

  let createdTime =
    value.created_time;

  console.log(
    "STEP 0 - parsed webhook values",
    {
      pageId,
      commentId,
      postId,
      authorId,
      authorName,
      message,
      createdTime,
    },
  );

  const pageAccessToken =
    process.env
      .FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageAccessToken) {
    console.error(
      "COMMENT ERROR - FACEBOOK_PAGE_ACCESS_TOKEN missing",
    );

    throw new Error(
      "FACEBOOK_PAGE_ACCESS_TOKEN is missing.",
    );
  }

  /*
   * Facebook feed events sometimes do not contain
   * the comment message.
   *
   * Fetch the complete comment from Graph API.
   */
  if (
    !message ||
    !authorId
  ) {
    console.log(
      "STEP 0.1 - fetching full Facebook comment",
      {
        commentId,
        missingMessage:
          !message,
        missingAuthor:
          !authorId,
      },
    );

    if (!commentId) {
      console.warn(
        "COMMENT STOP - no commentId available for Graph lookup",
      );

      return;
    }

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION ??
      "v26.0";

    const fields = [
      "id",
      "message",
      "from",
      "created_time",
      "parent",
    ].join(",");

    const url =
      `https://graph.facebook.com/${graphVersion}/${commentId}` +
      `?fields=${encodeURIComponent(
        fields,
      )}` +
      `&access_token=${encodeURIComponent(
        pageAccessToken,
      )}`;

    const graphResponse =
      await fetch(url, {
        method: "GET",
        cache: "no-store",
      });

    const graphText =
      await graphResponse.text();

    console.log(
      "STEP 0.2 - Graph API response",
      {
        status:
          graphResponse.status,
        ok:
          graphResponse.ok,
        body:
          graphText,
      },
    );

    let graphResult: {
      id?: string;

      message?: string;

      created_time?: string;

      from?: {
        id?: string;
        name?: string;
      };

      parent?: {
        id?: string;
      };

      error?: {
        message?: string;
        code?: number;
      };
    } = {};

    if (graphText.trim()) {
      try {
        graphResult =
          JSON.parse(
            graphText,
          ) as typeof graphResult;
      } catch {
        console.error(
          "COMMENT ERROR - invalid Graph JSON",
          graphText,
        );

        throw new Error(
          "Facebook comment lookup returned invalid JSON.",
        );
      }
    }

    if (!graphResponse.ok) {
      console.error(
        "COMMENT ERROR - Graph lookup failed",
        graphResult,
      );

      throw new Error(
        graphResult.error
          ?.message ??
          "Unable to load Facebook comment details.",
      );
    }

    message =
      graphResult.message?.trim() ??
      message;

    authorId =
      graphResult.from?.id?.trim() ??
      authorId;

    authorName =
      graphResult.from?.name?.trim() ??
      authorName;

    if (
      graphResult.created_time
    ) {
      const parsed =
        new Date(
          graphResult.created_time,
        );

      if (
        !Number.isNaN(
          parsed.getTime(),
        )
      ) {
        createdTime =
          Math.floor(
            parsed.getTime() /
              1000,
          );
      }
    }

    console.log(
      "STEP 0.3 - enriched comment",
      {
        commentId,
        message,
        authorId,
        authorName,
        createdTime,
      },
    );
  }

  console.log(
    "FACEBOOK COMMENT DEBUG",
    {
      pageId,
      commentId,
      postId,
      authorId,
      authorName,
      message,
      item: value.item,
      verb: value.verb,
    },
  );

  if (
    !pageId ||
    !commentId ||
    !authorId
  ) {
    console.warn(
      "COMMENT STOP - incomplete event",
      {
        pageId,
        commentId,
        authorId,
      },
    );

    return;
  }

  console.log(
    "COMMENT AUTHOR CHECK",
    {
      pageId,
      authorId,
      same:
        pageId === authorId,
    },
  );

  /*
   * Ignore comments made by the Page itself.
   */
  if (
    authorId === pageId
  ) {
    console.log(
      "COMMENT STOP - author is the Page itself",
      {
        pageId,
        authorId,
      },
    );

    return;
  }

  const configuredPageId =
    process.env
      .FACEBOOK_PAGE_ID;

  if (!configuredPageId) {
    console.error(
      "COMMENT ERROR - FACEBOOK_PAGE_ID missing",
    );

    throw new Error(
      "FACEBOOK_PAGE_ID is missing.",
    );
  }

  console.log(
    "STEP 0.4 - Page ID check",
    {
      incomingPageId:
        pageId,
      configuredPageId,
      matches:
        pageId ===
        configuredPageId,
    },
  );

  if (
    pageId !== configuredPageId
  ) {
    console.warn(
      "COMMENT STOP - Page ID does not match",
      {
        pageId,
        configuredPageId,
      },
    );

    return;
  }

  /*
   * Prevent duplicate webhook delivery.
   */
  const {
    data: existingMessage,
    error:
      existingMessageError,
  } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq(
      "platform_message_id",
      commentId,
    )
    .maybeSingle();

  console.log(
    "STEP 0.5 - duplicate check",
    {
      existingMessage,
      existingMessageError,
    },
  );

  if (
    existingMessageError
  ) {
    throw new Error(
      existingMessageError.message,
    );
  }

  if (existingMessage) {
    console.log(
      "COMMENT STOP - duplicate comment already saved",
      {
        commentId,
        existingMessageId:
          existingMessage.id,
      },
    );

    return;
  }

  /*
   * Resolve Facebook social account.
   */
  const {
    data: socialAccount,
    error: accountError,
  } = await supabaseAdmin
    .from("social_accounts")
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

  console.log(
    "STEP 1 - social account",
    {
      socialAccount,
      accountError,
    },
  );

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
    toIso(
      createdTime,
    );

  console.log(
    "STEP 1.5 - comment time",
    {
      createdTime,
      commentTime,
    },
  );

  /*
   * Create/update customer.
   */
  console.log(
    "STEP 2 - before contact upsert",
    {
      businessId:
        socialAccount.business_id,
      authorId,
      authorName,
      commentTime,
    },
  );

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .upsert(
      {
        business_id:
          socialAccount.business_id,

        platform:
          "facebook",

        platform_user_id:
          authorId,

        full_name:
          authorName,

        last_contact_at:
          commentTime,

        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "business_id,platform,platform_user_id",
      },
    )
    .select("id")
    .single();

  console.log(
    "STEP 2.1 - contact upsert result",
    {
      contact,
      contactError,
    },
  );

  if (
    contactError ||
    !contact
  ) {
    throw new Error(
      contactError?.message ??
        "Unable to create Facebook comment contact.",
    );
  }

  /*
   * Create/reuse customer conversation.
   */
  console.log(
    "STEP 3 - before conversation upsert",
    {
      businessId:
        socialAccount.business_id,
      socialAccountId:
        socialAccount.id,
      contactId:
        contact.id,
      sourceType:
        "comment",
      commentId,
      postId,
    },
  );

  const {
    data: conversation,
    error:
      conversationError,
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
          value.parent_id ??
          null,

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
      unread_count,
      source_type,
      facebook_comment_id
    `)
    .single();

  console.log(
    "STEP 3.1 - conversation upsert result",
    {
      conversation,
      conversationError,
    },
  );

  if (
    conversationError ||
    !conversation
  ) {
    throw new Error(
      conversationError
        ?.message ??
        "Unable to create Facebook comment conversation.",
    );
  }

  /*
   * Store comment in messages.
   */
  console.log(
    "STEP 4 - before message insert",
    {
      conversationId:
        conversation.id,
      commentId,
      authorId,
      pageId,
      message,
      commentTime,
    },
  );

  const {
    error: messageError,
  } = await supabaseAdmin
    .from("messages")
    .insert({
      business_id:
        socialAccount.business_id,

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
        message ||
        "Facebook comment",

      attachment_url:
        null,

      is_echo:
        false,

      raw_payload:
        value,

      platform_created_at:
        commentTime,
    });

  console.log(
    "STEP 4.1 - message insert result",
    {
      commentId,
      message,
      messageError,
    },
  );

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

  /*
   * Update conversation preview.
   */
  console.log(
    "STEP 5 - before conversation update",
    {
      conversationId:
        conversation.id,
      sourceType:
        "comment",
      lastMessage:
        message ||
        "Facebook comment",
      unreadCount,
    },
  );

  const {
    error: updateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      source_type:
        "comment",

      facebook_post_id:
        postId ?? null,

      facebook_comment_id:
        commentId,

      parent_comment_id:
        value.parent_id ??
        null,

      last_message_text:
        message ||
        "Facebook comment",

      last_message_at:
        commentTime,

      unread_count:
        unreadCount,

      status:
        "open",

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      conversation.id,
    );

  console.log(
    "STEP 5.1 - conversation update result",
    {
      updateError,
    },
  );

  if (updateError) {
    throw new Error(
      updateError.message,
    );
  }

  console.log(
    "===== FACEBOOK COMMENT SUCCESS =====",
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