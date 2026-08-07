import { NextResponse } from "next/server";

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
        error: "Conversation ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: conversation,
    error,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      unread_count: 0,
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

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to mark conversation as read.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    conversation,
  });
}