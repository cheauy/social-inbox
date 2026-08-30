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
      business_id
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

    return NextResponse.json({
      success: true,
      messages:
        page.messages,
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
