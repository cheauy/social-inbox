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

  const value = (
    rawPayload as Record<string, unknown>
  ).parent_comment_id;

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
            "Message deleted by commenter or Page",
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

  return {
    affectedMessageIds,
    conversationId:
      rootMessage.conversation_id,
  };
}
