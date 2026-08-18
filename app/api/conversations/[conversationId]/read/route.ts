import { NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
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
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

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

  /*
   * V3.11.30 stability/security:
   * The admin client bypasses RLS, so always scope the write to the
   * authenticated TENH workspace. A conversation UUID from another
   * business must never be enough to change its unread state.
   */
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
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select(`
      id,
      unread_count
    `)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to mark conversation as read.",
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

  return NextResponse.json({
    success: true,
    conversation,
  });
}
