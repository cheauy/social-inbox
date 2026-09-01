import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getInboxConversationAccess,
} from "@/lib/inbox/get-inbox-resource-access";

import {
  getMessagePage,
  MESSAGE_PAGE_SIZE,
  type MessageCursor,
} from "@/lib/inbox/get-messages";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

import {
  getFacebookPostIdForComment,
  getFacebookPostPreview,
} from "@/lib/facebook/get-post-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

function parseLimit(
  value: string | null,
) {
  if (!value) {
    return MESSAGE_PAGE_SIZE;
  }

  const parsed =
    Number.parseInt(
      value,
      10,
    );

  if (
    !Number.isFinite(parsed)
  ) {
    return MESSAGE_PAGE_SIZE;
  }

  return Math.min(
    100,
    Math.max(
      1,
      parsed,
    ),
  );
}


function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function cleanString(
  value: unknown,
) {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  const {
    conversationId,
  } = await context.params;

  const normalizedConversationId =
    conversationId?.trim();

  if (!normalizedConversationId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const access =
    await getInboxConversationAccess(normalizedConversationId);

  if (!access.success) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  const currentMember = access.member;

  /*
   * Never trust a business id from the browser.
   * Verify the requested conversation belongs to the logged-in
   * member's business before using the admin client to paginate.
   */
  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id,
      social_account_id,
      source_type,
      facebook_post_id,
      facebook_comment_id
    `)
    .eq(
      "id",
      normalizedConversationId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (conversationError) {
    console.error(
      "Unable to verify conversation for message pagination:",
      conversationError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify the conversation.",
      },
      {
        status: 500,
      },
    );
  }

  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  const beforeCreatedAt =
    request.nextUrl.searchParams
      .get("beforeCreatedAt")
      ?.trim() ||
    null;

  const beforeId =
    request.nextUrl.searchParams
      .get("beforeId")
      ?.trim() ||
    null;

  /*
   * The cursor is a pair. Requiring both values keeps pagination
   * deterministic when messages share the same created_at value.
   */
  if (
    Boolean(beforeCreatedAt) !==
    Boolean(beforeId)
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Both beforeCreatedAt and beforeId are required for pagination.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    beforeCreatedAt &&
    Number.isNaN(
      Date.parse(
        beforeCreatedAt,
      ),
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "beforeCreatedAt is invalid.",
      },
      {
        status: 400,
      },
    );
  }

  const before:
    MessageCursor | null =
    beforeCreatedAt &&
    beforeId
      ? {
          createdAt:
            beforeCreatedAt,
          id:
            beforeId,
        }
      : null;

  try {
    const page =
      await getMessagePage({
        conversationId:
          normalizedConversationId,
        before,
        limit:
          parseLimit(
            request.nextUrl.searchParams.get(
              "limit",
            ),
          ),
      });

    let responseMessages =
      page.messages;

    /*
     * Repair older Facebook comment rows that were saved while Meta omitted
     * post_id or while the optional post-preview lookup was unavailable. This
     * runs only for the current root comment and only while preview data is
     * missing, so the normal 2-second active-thread poll does not keep calling
     * Graph after the row has been repaired once.
     */
    if (
      conversation.source_type === "comment" &&
      conversation.facebook_comment_id &&
      conversation.social_account_id
    ) {
      const rootMessage =
        responseMessages.find(
          (message) =>
            message.platform_message_id ===
            conversation.facebook_comment_id,
        ) ?? null;

      const rootPayload =
        isRecord(rootMessage?.raw_payload)
          ? rootMessage.raw_payload
          : null;
      const savedPreview =
        isRecord(rootPayload?.post_preview)
          ? rootPayload.post_preview
          : null;
      const savedPostId =
        cleanString(rootPayload?.post_id) ??
        cleanString(savedPreview?.id) ??
        cleanString(conversation.facebook_post_id);
      const hasUsefulPreview =
        Boolean(
          savedPreview &&
            (cleanString(savedPreview.message) ||
              cleanString(savedPreview.full_picture) ||
              cleanString(savedPreview.permalink_url)),
        );

      if (rootMessage && (!savedPostId || !hasUsefulPreview)) {
        const {
          data: socialAccount,
          error: socialAccountError,
        } = await supabaseAdmin
          .from("social_accounts")
          .select("platform,platform_account_id")
          .eq("id", conversation.social_account_id)
          .eq("business_id", currentMember.business_id)
          .maybeSingle();

        if (
          !socialAccountError &&
          socialAccount?.platform === "facebook" &&
          cleanString(socialAccount.platform_account_id)
        ) {
          const pageId =
            cleanString(socialAccount.platform_account_id)!;
          const resolvedPostId =
            savedPostId ??
            (await getFacebookPostIdForComment(
              conversation.facebook_comment_id,
              pageId,
            ));

          if (resolvedPostId) {
            const repairedPreview =
              await getFacebookPostPreview(
                resolvedPostId,
                pageId,
              );
            const nextRawPayload = {
              ...(rootPayload ?? {}),
              post_id: resolvedPostId,
              post_preview:
                repairedPreview ??
                savedPreview ??
                {
                  id: resolvedPostId,
                  message: null,
                  full_picture: null,
                  permalink_url: null,
                  created_time: null,
                },
            };

            const { error: messageRepairError } =
              await supabaseAdmin
                .from("messages")
                .update({
                  raw_payload: nextRawPayload,
                })
                .eq("id", rootMessage.id)
                .eq("conversation_id", normalizedConversationId);

            if (messageRepairError) {
              console.warn(
                "Unable to persist repaired Facebook post preview:",
                messageRepairError.message,
              );
            } else {
              responseMessages =
                responseMessages.map(
                  (message) =>
                    message.id === rootMessage.id
                      ? {
                          ...message,
                          raw_payload: nextRawPayload,
                        }
                      : message,
                );
            }

            if (conversation.facebook_post_id !== resolvedPostId) {
              const { error: conversationRepairError } =
                await supabaseAdmin
                  .from("conversations")
                  .update({
                    facebook_post_id: resolvedPostId,
                  })
                  .eq("id", normalizedConversationId)
                  .eq("business_id", currentMember.business_id);

              if (conversationRepairError) {
                console.warn(
                  "Unable to persist repaired Facebook post ID:",
                  conversationRepairError.message,
                );
              }
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      messages:
        responseMessages,
      hasMore:
        page.hasMore,
      nextCursor:
        page.nextCursor,
    });
  } catch (error) {
    console.error(
      "Unable to paginate older messages:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load older messages.",
      },
      {
        status: 500,
      },
    );
  }
}
