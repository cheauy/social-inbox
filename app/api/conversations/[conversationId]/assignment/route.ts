import {
  NextRequest,
  NextResponse,
} from "next/server";

import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

type AssignmentBody = {
  assignedTo?: string | null;

  /*
   * Temporary: send the logged-in team member ID.
   * Later, read this from the authenticated session.
   */
  actorMemberId?: string | null;
};

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type ContactResult = {
  id: string;
  full_name: string | null;
};

type TeamMemberResult = {
  id: string;
  full_name: string;
  profile_picture_url: string | null;
  role: string;
};

type ConversationResult = {
  id: string;
  business_id: string;
  contact_id: string | null;
  assigned_to: string | null;

  contact:
    | ContactResult
    | ContactResult[]
    | null;

  assigned_member:
    | TeamMemberResult
    | TeamMemberResult[]
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

  let body: AssignmentBody;

  try {
    body =
      (await request.json()) as AssignmentBody;
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

  const assignedTo =
    body.assignedTo?.trim() || null;

  const actorMemberId =
    body.actorMemberId?.trim() || null;

  /*
   * Load the current conversation before updating.
   * This provides the previous assignment and customer.
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
      assigned_to,

      contact:contacts (
        id,
        full_name
      ),

      assigned_member:team_members (
        id,
        full_name,
        profile_picture_url,
        role
      )
    `)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    console.error(
      "Unable to load conversation before assignment:",
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

  const currentConversation =
    conversationData as unknown as ConversationResult;

  const previousAssignedTo =
    currentConversation.assigned_to;

  const contact =
    getSingleResult(
      currentConversation.contact,
    );

  const previousMember =
    getSingleResult(
      currentConversation.assigned_member,
    );

  const customerName =
    contact?.full_name ??
    "Facebook customer";

  /*
   * Do not create duplicate activity when the
   * selected assignment has not changed.
   */
  if (previousAssignedTo === assignedTo) {
    return NextResponse.json({
      success: true,

      conversation: {
        id: currentConversation.id,
        assigned_to:
          previousAssignedTo,
      },

      activityRecorded: false,
    });
  }

  /*
   * Verify and load the new assignee.
   */
  let selectedMember:
    | TeamMemberResult
    | null = null;

  if (assignedTo) {
    const {
      data: teamMemberData,
      error: teamMemberError,
    } = await supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        profile_picture_url,
        role
      `)
      .eq("id", assignedTo)
      .eq("is_active", true)
      .maybeSingle();

    if (teamMemberError) {
      console.error(
        "Unable to verify team member:",
        teamMemberError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to verify the team member.",
          details:
            teamMemberError.message,
        },
        {
          status: 500,
        },
      );
    }

    if (!teamMemberData) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The selected team member was not found.",
        },
        {
          status: 404,
        },
      );
    }

    selectedMember =
      teamMemberData as TeamMemberResult;
  }

  /*
   * Load the person who performed the action.
   */
  let actorMember:
    | TeamMemberResult
    | null = null;

  if (actorMemberId) {
    const {
      data: actorData,
      error: actorError,
    } = await supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        profile_picture_url,
        role
      `)
      .eq("id", actorMemberId)
      .maybeSingle();

    if (actorError) {
      console.error(
        "Unable to load assignment actor:",
        actorError,
      );
    } else {
      actorMember =
        actorData as TeamMemberResult | null;
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
      assigned_to: assignedTo,

      assigned_at: assignedTo
        ? now
        : null,

      updated_at: now,
    })
    .eq("id", conversationId)
    .select(`
      id,
      assigned_to,
      assigned_at,
      updated_at
    `)
    .maybeSingle();

  if (updateError) {
    console.error(
      "Unable to assign conversation:",
      updateError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to update the conversation assignment.",
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

  let activityRecorded = false;

  try {
    if (selectedMember) {
      await createConversationActivity({
        businessId:
          currentConversation.business_id,

        conversationId:
          currentConversation.id,

        contactId:
          currentConversation.contact_id,

        actorMemberId:
          actorMember?.id ?? null,

        activityType: "assigned",

        title:
          `assigned the conversation to ${selectedMember.full_name}`,

        description:
          `${customerName} was assigned to ${selectedMember.full_name}.`,

        customerName,

        actorName:
          actorMember?.full_name ??
          "System",

        actorProfilePictureUrl:
          actorMember
            ?.profile_picture_url ??
          null,

        metadata: {
          previousAssignedToId:
            previousMember?.id ?? null,

          previousAssignedToName:
            previousMember?.full_name ??
            null,

          assignedToId:
            selectedMember.id,

          assignedToName:
            selectedMember.full_name,
        },
      });
    } else {
      await createConversationActivity({
        businessId:
          currentConversation.business_id,

        conversationId:
          currentConversation.id,

        contactId:
          currentConversation.contact_id,

        actorMemberId:
          actorMember?.id ?? null,

        activityType: "unassigned",

        title:
          "removed the conversation assignment",

        description:
          `${customerName} is now unassigned.`,

        customerName,

        actorName:
          actorMember?.full_name ??
          "System",

        actorProfilePictureUrl:
          actorMember
            ?.profile_picture_url ??
          null,

        metadata: {
          previousAssignedToId:
            previousMember?.id ?? null,

          previousAssignedToName:
            previousMember?.full_name ??
            null,

          assignedToId: null,
          assignedToName: null,
        },
      });
    }

    activityRecorded = true;
  } catch (activityError) {
    console.error(
      "Assignment changed, but activity could not be recorded:",
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