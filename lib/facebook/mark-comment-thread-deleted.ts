import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

type DeletedBy = "customer" | "page";

type MessageRow = {
  id: string;
  conversation_id: string | null;
  platform_message_id: string | null;
  raw_payload: unknown;
};

function getParentCommentId(
  rawPayload: unknown,
): string | null {
  if (
    !rawPayload ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    return null;
  }

  const payload =
    rawPayload as Record<string, unknown>;

  const value =
    payload.parent_comment_id ??
    payload.parent_id;

  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

export async function markFacebookCommentThreadDeleted({
  businessId,
  pageId,
  commentId,
  deletedBy,
}: {
  businessId?: string | null;
  pageId?: string | null;
  commentId: string;
  deletedBy: DeletedBy;
}) {
  const normalizedCommentId =
    commentId.trim();

  if (!normalizedCommentId) {
    return {
      affectedMessageIds: [] as string[],
      conversationId: null as string | null,
    };
  }

  let resolvedBusinessId =
    businessId?.trim() || null;

  if (!resolvedBusinessId) {
    const normalizedPageId =
      pageId?.trim() || null;

    if (!normalizedPageId) {
      return {
        affectedMessageIds: [] as string[],
        conversationId: null as string | null,
      };
    }

    const {
      data: socialAccount,
      error: socialAccountError,
    } = await supabaseAdmin
      .from("social_accounts")
      .select("business_id")
      .eq("platform", "facebook")
      .eq(
        "platform_account_id",
        normalizedPageId,
      )
      .eq("is_active", true)
      .maybeSingle();

    if (socialAccountError) {
      throw new Error(
        socialAccountError.message,
      );
    }

    resolvedBusinessId =
      socialAccount?.business_id ?? null;
  }

  if (!resolvedBusinessId) {
    return {
      affectedMessageIds: [] as string[],
      conversationId: null as string | null,
    };
  }

  const {
    data: rootMessageData,
    error: rootMessageError,
  } = await supabaseAdmin
    .from("messages")
    .select(`
      id,
      conversation_id,
      platform_message_id,
      raw_payload
    `)
    .eq("business_id", resolvedBusinessId)
    .eq(
      "platform_message_id",
      normalizedCommentId,
    )
    .maybeSingle();

  if (rootMessageError) {
    throw new Error(
      rootMessageError.message,
    );
  }

  const rootMessage =
    rootMessageData as MessageRow | null;

  if (!rootMessage?.conversation_id) {
    return {
      affectedMessageIds: [] as string[],
      conversationId: null as string | null,
    };
  }

  const {
    data: conversationMessagesData,
    error: conversationMessagesError,
  } = await supabaseAdmin
    .from("messages")
    .select(`
      id,
      conversation_id,
      platform_message_id,
      raw_payload
    `)
    .eq("business_id", resolvedBusinessId)
    .eq(
      "conversation_id",
      rootMessage.conversation_id,
    );

  if (conversationMessagesError) {
    throw new Error(
      conversationMessagesError.message,
    );
  }

  const conversationMessages =
    (conversationMessagesData ?? []) as MessageRow[];

  const deletedPlatformIds =
    new Set<string>([
      normalizedCommentId,
    ]);

  let foundAnotherReply = true;

  while (foundAnotherReply) {
    foundAnotherReply = false;

    for (
      const candidate of
      conversationMessages
    ) {
      const candidatePlatformId =
        candidate.platform_message_id
          ?.trim();

      if (
        !candidatePlatformId ||
        deletedPlatformIds.has(
          candidatePlatformId,
        )
      ) {
        continue;
      }

      const parentCommentId =
        getParentCommentId(
          candidate.raw_payload,
        );

      if (
        parentCommentId &&
        deletedPlatformIds.has(
          parentCommentId,
        )
      ) {
        deletedPlatformIds.add(
          candidatePlatformId,
        );
        foundAnotherReply = true;
      }
    }
  }

  const affectedMessageIds =
    conversationMessages
      .filter((candidate) => {
        const platformMessageId =
          candidate.platform_message_id
            ?.trim();

        return Boolean(
          platformMessageId &&
            deletedPlatformIds.has(
              platformMessageId,
            ),
        );
      })
      .map((candidate) =>
        candidate.id,
      );

  const deletedText =
    deletedBy === "page"
      ? "Message deleted by Page"
      : "Message deleted by Commenter";

  if (affectedMessageIds.length > 0) {
    const { error: updateError } =
      await supabaseAdmin
        .from("messages")
        .update({
          comment_is_deleted: true,
          comment_deleted_by:
            deletedBy,
          comment_is_liked: false,
          comment_is_hidden: false,
          message_text:
            deletedText,
        })
        .eq(
          "business_id",
          resolvedBusinessId,
        )
        .in(
          "id",
          affectedMessageIds,
        );

    if (updateError) {
      throw new Error(
        updateError.message,
      );
    }
  }

  /*
   * Update the conversation preview only when the message that is actually
   * latest in this conversation belongs to the deleted thread. Deleting an
   * old Facebook comment must never overwrite a newer Messenger/Telegram or
   * newer Facebook-comment preview.
   */
  if (affectedMessageIds.length > 0) {
    const {
      data: latestMessageData,
      error: latestMessageError,
    } = await supabaseAdmin
      .from("messages")
      .select(`
        id,
        comment_is_deleted,
        comment_deleted_by,
        direction
      `)
      .eq("business_id", resolvedBusinessId)
      .eq(
        "conversation_id",
        rootMessage.conversation_id,
      )
      .order("platform_created_at", {
        ascending: false,
        nullsFirst: false,
      })
      .order("created_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (latestMessageError) {
      throw new Error(
        latestMessageError.message,
      );
    }

    const latestMessage =
      latestMessageData as
        | {
            id: string;
            comment_is_deleted: boolean | null;
            comment_deleted_by: string | null;
            direction: string | null;
          }
        | null;

    if (
      latestMessage?.comment_is_deleted === true &&
      affectedMessageIds.includes(latestMessage.id)
    ) {
      const latestDeletedBy =
        latestMessage.comment_deleted_by === "page"
          ? "page"
          : latestMessage.comment_deleted_by === "customer"
            ? "customer"
            : latestMessage.direction === "outgoing"
              ? "page"
              : deletedBy;

      const latestDeletedText =
        latestDeletedBy === "page"
          ? "Message deleted by Page"
          : "Message deleted by Commenter";

      const { error: previewUpdateError } =
        await supabaseAdmin
          .from("conversations")
          .update({
            last_message_text:
              latestDeletedText,
            updated_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            rootMessage.conversation_id,
          )
          .eq(
            "business_id",
            resolvedBusinessId,
          );

      if (previewUpdateError) {
        throw new Error(
          previewUpdateError.message,
        );
      }
    }
  }

  return {
    affectedMessageIds,
    conversationId:
      rootMessage.conversation_id,
  };
}
