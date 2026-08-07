import {
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

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

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      unread_count
    `)
    .eq(
      "id",
      normalizedConversationId,
    )
    .maybeSingle();

  if (
    conversationError ||
    !conversation
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation not found.",
        details:
          conversationError?.message,
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
        details:
          messagesError.message,
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
   * If the latest message was outgoing,
   * still mark the conversation unread
   * with a count of 1.
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
    .select(`
      id,
      unread_count
    `)
    .single();

  if (updateError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to mark conversation as unread.",
        details:
          updateError.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    conversation:
      updatedConversation,
  });
}