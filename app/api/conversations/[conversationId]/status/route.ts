import {
  NextRequest,
  NextResponse,
} from "next/server";

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

  /*
   * Temporary actor ID.
   *
   * Later, replace this with the authenticated
   * team member from your login/session.
   */
  actorMemberId?: string | null;
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

type TeamMemberResult = {
  id: string;
  full_name: string;
  profile_picture_url: string | null;
};

function getSingleContact(
  contact:
    | ContactResult
    | ContactResult[]
    | null,
): ContactResult | null {
  if (Array.isArray(contact)) {
    return contact[0] ?? null;
  }

  return contact;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { conversationId } =
    await context.params;

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
   * Load the conversation before updating it.
   * This gives us:
   * - old status
   * - business ID
   * - contact ID
   * - customer name
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
          "Conversation was not found.",
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

  const contact = getSingleContact(
    conversation.contact,
  );

  const customerName =
    contact?.full_name ??
    "Facebook customer";

  /*
   * Do not create duplicate timeline entries
   * when the selected status is unchanged.
   */
  if (oldStatus === nextStatus) {
    return NextResponse.json({
      success: true,
      conversation: {
        id: conversation.id,
        status: oldStatus,
      },
      activityRecorded: false,
    });
  }

  /*
   * Load the user/team member taking the action.
   *
   * For now, actorMemberId comes from the request.
   * Later this should come from authenticated session.
   */
  let currentMember:
    | TeamMemberResult
    | null = null;

  if (body.actorMemberId) {
    const {
      data: memberData,
      error: memberError,
    } = await supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        profile_picture_url
      `)
      .eq(
        "id",
        body.actorMemberId,
      )
      .maybeSingle();

    if (memberError) {
      console.error(
        "Unable to load activity actor:",
        memberError,
      );
    } else {
      currentMember =
        memberData as TeamMemberResult | null;
    }
  }

  const now =
    new Date().toISOString();

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
    .eq("id", conversationId)
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
        details: updateError.message,
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
          "Conversation was not found.",
      },
      {
        status: 404,
      },
    );
  }

  /*
   * Record the activity only after the status
   * update has succeeded.
   *
   * Timeline failure will not undo the status
   * update, but it will be logged.
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
        currentMember?.id ?? null,

      activityType:
        "status_changed",

      title:
        `changed status from ${oldStatus} to ${nextStatus}`,

      description:
        `${customerName}'s conversation status was changed.`,

      customerName,

      actorName:
        currentMember?.full_name ??
        "System",

      actorProfilePictureUrl:
        currentMember
          ?.profile_picture_url ??
        null,

      metadata: {
        oldStatus,
        newStatus: nextStatus,
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