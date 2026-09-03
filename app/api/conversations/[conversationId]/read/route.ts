import { NextResponse } from "next/server";

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
        error: "Conversation ID is required.",
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
    /*
     * updated_at is the read "row version". The browser keeps it and
     * ignores any later conversations row that is not strictly newer,
     * which is how a stale realtime echo of the pre-read unread_count is
     * told apart from a teammate genuinely hitting Mark unread. Both look
     * identical otherwise, so the comparison must stay server-clock to
     * server-clock.
     */
    .select(`
      id,
      unread_count,
      updated_at
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
