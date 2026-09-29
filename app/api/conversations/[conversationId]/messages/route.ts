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
import { latestCustomerChannel } from "@/lib/inbox/latest-customer-channel";



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



export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    return await getConversationMessages(request, context);
  } catch (error) {
    // Auth/client initialization and access queries can throw before pagination.
    // Keep those failures inside the API's JSON contract too.
    console.error("Unable to load conversation messages:", error);
    return NextResponse.json(
      { success: false, error: "Unable to load conversation messages. Please try again." },
      { status: 500 },
    );
  }
}

async function getConversationMessages(
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
      platform,
      updated_at,
      last_message_at,
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
          sentAt:
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

    const responseMessages =
      page.messages;

    // Repair legacy comment flags from the newest page only. The version check
    // prevents this read from overwriting a concurrent conversation update.
    if (!before && conversation.platform === "facebook" && conversation.updated_at) {
      const source = latestCustomerChannel(page.messages, normalizedConversationId);
      const newest = Math.max(0, ...page.messages.map(row => Date.parse(row.platform_created_at || row.created_at) || 0));
      const currentTime = Date.parse(conversation.last_message_at ?? "") || 0;
      if (source && source !== conversation.source_type && newest >= currentTime) {
        const { error: repairError } = await supabaseAdmin.from("conversations")
          .update({ source_type: source }).eq("id", normalizedConversationId)
          .eq("business_id", currentMember.business_id).eq("updated_at", conversation.updated_at);
        if (repairError) console.warn("Unable to repair conversation channel", { code: repairError.code });
      }
    }

    // Facebook post context is repaired independently by the on-demand card
    // endpoint. Message delivery must never wait for a Graph preview lookup.

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
