import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getInboxConversationAccess,
} from "@/lib/inbox/get-inbox-resource-access";
import {
  createConversationActivity,
} from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type PinConversationBody = {
  isPinned?: boolean;
  /* Kept for request compatibility; the server never trusts this value. */
  pinnedBy?: string | null;
};

type ContactResult = {
  id: string;
  full_name: string | null;
};

type ConversationResult = {
  id: string;
  business_id: string;
  contact_id: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  pinned_by: string | null;
  updated_at: string | null;
  contact:
    | ContactResult
    | ContactResult[]
    | null;
};

function getSingleResult<T>(
  value: T | T[] | null,
): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

export async function PATCH(
  request: NextRequest,
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

  let body: PinConversationBody;

  try {
    body =
      (await request.json()) as PinConversationBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    typeof body.isPinned !==
    "boolean"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "isPinned must be true or false.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * Read the current state first so duplicate clicks or a teammate already
   * applying the same state do not create duplicate History entries.
   */
  const {
    data: currentConversationData,
    error: currentConversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id,
      is_pinned,
      pinned_at,
      pinned_by,
      updated_at,
      contact:contacts (
        id,
        full_name
      )
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

  if (currentConversationError) {
    console.error(
      "Unable to load conversation before pin change:",
      currentConversationError,
    );

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

  if (!currentConversationData) {
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

  const currentConversation =
    currentConversationData as unknown as ConversationResult;

  if (
    currentConversation.is_pinned ===
    body.isPinned
  ) {
    return NextResponse.json({
      success: true,
      conversation: {
        id:
          currentConversation.id,
        is_pinned:
          currentConversation.is_pinned,
        pinned_at:
          currentConversation.pinned_at,
        pinned_by:
          currentConversation.pinned_by,
        updated_at:
          currentConversation.updated_at,
      },
      activityRecorded: false,
      message:
        "Conversation pin state was unchanged.",
    });
  }

  const now =
    new Date().toISOString();

  /*
   * The boolean guard makes the write safe against two same-direction pin
   * requests racing each other. Only the request that changes the row records
   * an activity item.
   */
  const {
    data: conversation,
    error,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      is_pinned: body.isPinned,
      pinned_at: body.isPinned
        ? now
        : null,
      pinned_by: body.isPinned
        ? currentMember.id
        : null,
      updated_at: now,
    })
    .eq(
      "id",
      normalizedConversationId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "is_pinned",
      !body.isPinned,
    )
    .select(`
      id,
      business_id,
      contact_id,
      is_pinned,
      pinned_at,
      pinned_by,
      updated_at
    `)
    .maybeSingle();

  if (error) {
    console.error(
      "Unable to update conversation pin:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          body.isPinned
            ? "Unable to pin conversation."
            : "Unable to unpin conversation.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * If another request won the race, return the latest authoritative row
   * instead of reporting a false failure or writing duplicate activity.
   */
  if (!conversation) {
    const {
      data: latestConversation,
      error: latestError,
    } = await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        is_pinned,
        pinned_at,
        pinned_by,
        updated_at
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

    if (latestError || !latestConversation) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Conversation was not found or could not be updated.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      conversation:
        latestConversation,
      activityRecorded: false,
      message:
        "Conversation pin state was already updated.",
    });
  }

  const contact =
    getSingleResult(
      currentConversation.contact,
    );
  const customerName =
    contact?.full_name?.trim() ||
    "Customer";

  let activityRecorded = false;

  try {
    await createConversationActivity({
      businessId:
        currentConversation.business_id,
      conversationId:
        currentConversation.id,
      contactId:
        currentConversation.contact_id,
      actorMemberId:
        currentMember.id,
      activityType:
        body.isPinned
          ? "pinned"
          : "unpinned",
      title:
        body.isPinned
          ? "pinned conversation"
          : "unpinned conversation",
      description:
        body.isPinned
          ? `${currentMember.full_name} pinned ${customerName}'s conversation.`
          : `${currentMember.full_name} unpinned ${customerName}'s conversation.`,
      customerName,
      actorName:
        currentMember.full_name,
      actorProfilePictureUrl:
        currentMember.profile_picture_url,
      metadata: {
        isPinned:
          body.isPinned,
        actor: {
          memberId:
            currentMember.id,
          name:
            currentMember.full_name,
          role:
            currentMember.role,
        },
      },
    });

    activityRecorded = true;
  } catch (activityError) {
    /*
     * Pin itself succeeded. History failure must never roll back the user's
     * action; log it and return the authoritative pin state.
     */
    console.error(
      "Pin changed, but activity could not be recorded:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    conversation,
    activityRecorded,
  });
}
