import {
  NextResponse,
} from "next/server";

import {
  getInboxConversationAccess,
} from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phaseTimer } from "@/lib/server/phase-timer";

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
  const timer = phaseTimer();
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
  timer.mark("auth");

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

  /*
   * The count is the run of incoming messages at the newest end of the
   * thread. It used to load the whole history to walk that run; long threads
   * paid for every message they had ever exchanged. The same number comes
   * from two bounded reads: the newest message that is not incoming, then a
   * count of incoming messages newer than it.
   *
   * Identical except at an exact created_at tie with that boundary row, where
   * the old walk's order was itself unspecified.
   */
  const {
    data: boundary,
    error: boundaryError,
  } = await supabaseAdmin
    .from("messages")
    .select("created_at")
    .eq("business_id", currentMember.business_id)
    .eq("conversation_id", normalizedConversationId)
    // Matches the old walk, where any non-"incoming" row (even null) ended the run.
    .or("direction.is.null,direction.neq.incoming")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (boundaryError) {
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

  let incomingQuery = supabaseAdmin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", currentMember.business_id)
    .eq("conversation_id", normalizedConversationId)
    .eq("direction", "incoming");

  if (boundary?.created_at) {
    incomingQuery = incomingQuery.gt("created_at", boundary.created_at);
  }

  const {
    count: incomingCount,
    error: messagesError,
  } = await incomingQuery;

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

  timer.mark("count");

  let unreadCount = incomingCount ?? 0;

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

  timer.mark("db");

  return NextResponse.json(
    {
      success: true,
      conversation:
        updatedConversation,
    },
    { headers: { "Server-Timing": timer.header() } },
  );
}
