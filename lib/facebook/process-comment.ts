import "server-only";

import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  getFacebookPostPreview,
} from "@/lib/facebook/get-post-preview";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

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
  };
  [key: string]:
    unknown;
};

type ProcessFacebookCommentInput = {
  pageId: string;
  value:
    FacebookFeedCommentValue;
};

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

    const deletedText =
      deletedBy ===
      "customer"
        ? "Comment deleted by user"
        : "Comment deleted by Page";

    const {
      error:
        updateMessageError,
    } =
      await supabaseAdmin
        .from(
          "messages",
        )
        .update({
          comment_is_deleted:
            true,
          comment_deleted_by:
            deletedBy,
          message_text:
            deletedText,
        })
        .eq(
          "id",
          existingMessage.id,
        );

    if (
      updateMessageError
    ) {
      throw new Error(
        updateMessageError
          .message,
      );
    }

    if (
      existingMessage
        .conversation_id
    ) {
      await supabaseAdmin
        .from(
          "conversations",
        )
        .update({
          last_message_text:
            deletedText,
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          existingMessage
            .conversation_id,
        );
    }

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

  const postId =
    value.post_id
      ?.trim();

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
      !authorName
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
        "id,message,from,created_time,parent",
      );
      url.searchParams.set(
        "access_token",
        pageAccessToken,
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

      let result: {
        message?: string;
        created_time?: string;
        from?: {
          id?: string;
          name?: string;
        };
        error?: {
          message?: string;
          code?: number;
        };
      } = {};

      if (text.trim()) {
        try {
          result =
            JSON.parse(
              text,
            ) as typeof result;
        } catch {
          console.warn(
            "[Tenh Facebook Comment] Graph enrichment returned invalid JSON.",
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
    const parentCommentId =
      value.parent_id
        ?.trim() ??
      null;

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

    const {
      data:
        parentMessage,
      error:
        parentMessageError,
    } =
      await supabaseAdmin
        .from("messages")
        .select(`
          conversation_id
        `)
        .eq(
          "platform_message_id",
          parentCommentId,
        )
        .maybeSingle();

    if (parentMessageError) {
      throw new Error(
        parentMessageError.message,
      );
    }

    let targetConversationId =
      parentMessage
        ?.conversation_id ??
      null;

    /*
     * Fallback for an older/root comment that has a TENH conversation but no
     * local message row available anymore.
     */
    if (!targetConversationId) {
      const {
        data:
          rootConversation,
        error:
          rootConversationError,
      } =
        await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq(
            "social_account_id",
            socialAccount.id,
          )
          .eq(
            "facebook_comment_id",
            parentCommentId,
          )
          .maybeSingle();

      if (rootConversationError) {
        throw new Error(
          rootConversationError.message,
        );
      }

      targetConversationId =
        rootConversation?.id ??
        null;
    }

    if (!targetConversationId) {
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

    const {
      data:
        targetConversation,
      error:
        targetConversationError,
    } =
      await supabaseAdmin
        .from("conversations")
        .select(`
          id,
          business_id,
          social_account_id,
          contact_id,
          unread_count
        `)
        .eq(
          "id",
          targetConversationId,
        )
        .eq(
          "social_account_id",
          socialAccount.id,
        )
        .maybeSingle();

    if (targetConversationError) {
      throw new Error(
        targetConversationError.message,
      );
    }

    if (
      !targetConversation ||
      !targetConversation.contact_id
    ) {
      console.warn(
        "[Tenh Facebook Comment] Page reply matched a conversation without a customer contact.",
        {
          pageId,
          commentId,
          parentCommentId,
          targetConversationId,
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

    let pageReplyPostPreview =
      null;

    if (postId) {
      try {
        pageReplyPostPreview =
          await getFacebookPostPreview(
            postId,
            pageId,
          );
      } catch (error) {
        console.warn(
          "[Tenh Facebook Comment] Page reply post preview failed; saving reply without preview.",
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

  const {
    data:
      conversation,
    error:
      conversationError,
  } =
    await supabaseAdmin
      .from(
        "conversations",
      )
      .upsert(
        {
          business_id:
            socialAccount
              .business_id,
          social_account_id:
            socialAccount.id,
          contact_id:
            contact.id,
          platform:
            "facebook",
          source_type:
            "comment",
          facebook_post_id:
            postId ??
            null,
          facebook_comment_id:
            commentId,
          parent_comment_id:
            value
              .parent_id ??
            null,
          status:
            "open",
          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "social_account_id,contact_id",
        },
      )
      .select(`
        id,
        unread_count
      `)
      .single();

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

  let postPreview =
    null;

  if (postId) {
    try {
      postPreview =
        await getFacebookPostPreview(
          postId,
          pageId,
        );
    } catch (error) {
      console.warn(
        "[Tenh Facebook Comment] Post preview failed; saving comment without preview.",
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

  const {
    error:
      updateError,
  } =
    await supabaseAdmin
      .from(
        "conversations",
      )
      .update({
        source_type:
          "comment",
        facebook_post_id:
          postId ??
          null,
        facebook_comment_id:
          commentId,
        parent_comment_id:
          value
            .parent_id ??
          null,
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
      })
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
