import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  ConversationStatus,
} from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses =
  new Set<ConversationStatus>([
    "open",
    "pending",
    "resolved",
    "closed",
    "spam",
  ]);

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type UpdateStatusBody = {
  status?: string;
};

type ContactResult = {
  id: string;
  full_name: string | null;
};

type ConversationResult = {
  id: string;
  business_id: string;
  contact_id: string | null;
  status: ConversationStatus;

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
  /*
   * 1. Authenticate the user and resolve
   * the matching team member on the server.
   */
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

  if (!conversationId?.trim()) {
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
   * 2. Parse request body.
   */
  let body: UpdateStatusBody;

  try {
    body =
      (await request.json()) as UpdateStatusBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const nextStatus =
    body.status as
      | ConversationStatus
      | undefined;

  if (
    !nextStatus ||
    !allowedStatuses.has(nextStatus)
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid conversation status.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * 3. Load the conversation.
   *
   * business_id is also filtered so a member
   * cannot update another business's conversation.
   */
  const {
    data: conversationData,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id,
      status,

      contact:contacts (
        id,
        full_name
      )
    `)
    .eq("id", conversationId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (conversationError) {
    console.error(
      "Unable to load conversation:",
      conversationError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the conversation.",
        details:
          conversationError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!conversationData) {
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

  const conversation =
    conversationData as unknown as ConversationResult;

  const oldStatus =
    conversation.status;

  const contact =
    getSingleResult(
      conversation.contact,
    );

  const customerName =
    contact?.full_name?.trim() ||
    "Facebook customer";

  /*
   * 4. Avoid duplicate timeline activity.
   */
  if (oldStatus === nextStatus) {
    return NextResponse.json({
      success: true,

      conversation: {
        id: conversation.id,
        status: oldStatus,
      },

      activityRecorded: false,
      message:
        "Conversation status was unchanged.",
    });
  }

  const now =
    new Date().toISOString();

  /*
   * 5. Update status.
   *
   * Filter by business_id again to protect
   * the write operation.
   */
  const {
    data: updatedConversation,
    error: updateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      status: nextStatus,
      status_updated_at: now,
      updated_at: now,
    })
    .eq("id", conversation.id)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select(`
      id,
      status,
      status_updated_at,
      updated_at
    `)
    .maybeSingle();

  if (updateError) {
    console.error(
      "Unable to update conversation status:",
      updateError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to update conversation status.",
        details:
          updateError.message,
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
          "Conversation was not found or could not be updated.",
      },
      {
        status: 404,
      },
    );
  }

  /*
   * 6. Record the activity after a successful update.
   */
  let activityRecorded = false;

  try {
    await createConversationActivity({
      businessId:
        conversation.business_id,

      conversationId:
        conversation.id,

      contactId:
        conversation.contact_id,

      actorMemberId:
        currentMember.id,

      activityType:
        "status_changed",

      title:
        `changed status from ${oldStatus} to ${nextStatus}`,

      description:
        `${currentMember.full_name} changed ${customerName}'s conversation status from ${oldStatus} to ${nextStatus}.`,

      customerName,

      actorName:
        currentMember.full_name,

      actorProfilePictureUrl:
        currentMember.profile_picture_url,

      metadata: {
        oldStatus,
        newStatus: nextStatus,

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
    console.error(
      "Status changed, but activity could not be recorded:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    conversation:
      updatedConversation,
    activityRecorded,
  });
}