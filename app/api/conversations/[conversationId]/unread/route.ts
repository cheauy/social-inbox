import {
  NextResponse,
} from "next/server";

import {
  getInboxConversationAccess,
} from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function PATCH(
  _request: Request,
  context: RouteContext,
) {
  const { conversationId } =
    await context.params;

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

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      unread_count
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
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the conversation.",
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

  const {
    data: messages,
    error: messagesError,
  } = await supabaseAdmin
    .from("messages")
    .select(`
      id,
      direction,
      created_at
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "conversation_id",
      normalizedConversationId,
    )
    .order("created_at", {
      ascending: false,
    });

  if (messagesError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load conversation messages.",
      },
      {
        status: 500,
      },
    );
  }

  let unreadCount = 0;

  for (const message of messages ?? []) {
    if (
      message.direction !==
      "incoming"
    ) {
      break;
    }

    unreadCount += 1;
  }

  /*
   * Manual Mark unread is also useful when the latest row is outgoing.
   * Keep the existing TENH behavior of showing one unread badge in that case.
   */
  if (unreadCount === 0) {
    unreadCount = 1;
  }

  const {
    data: updatedConversation,
    error: updateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      unread_count:
        unreadCount,
    })
    .eq(
      "id",
      normalizedConversationId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select(`
      id,
      unread_count
    `)
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to mark conversation as unread.",
      },
      {
        status: 500,
      },
    );
  }

  if (!updatedConversation) {
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

  return NextResponse.json({
    success: true,
    conversation:
      updatedConversation,
  });
}
