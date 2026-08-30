import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type AssignmentBody = {
  assignedTo?: string | null;
};

type ContactResult = {
  id: string;
  full_name: string | null;
};

type TeamMemberResult = {
  id: string;
  business_id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
  is_active: boolean;
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

  if (!conversationId?.trim()) {
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
    await getInboxConversationAccess(conversationId);

  if (!access.success) {
    return NextResponse.json(
      {
        success: false,
        error: access.error,
      },
      {
        status: access.status,
      },
    );
  }

  const currentMember = access.member;

  /*
   * 2. Read the selected assignee.
   *
   * null means unassigned.
   */
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
    typeof body.assignedTo === "string"
      ? body.assignedTo.trim() || null
      : null;

  /*
   * 3. Load the conversation and its current
   * assignee before making the change.
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

      assigned_member:team_members!conversations_assigned_to_fkey (
        id,
        business_id,
        full_name,
        email,
        role,
        profile_picture_url,
        is_active
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
          "Conversation was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  const conversation =
    conversationData as unknown as ConversationResult;

  const previousAssignedTo =
    conversation.assigned_to;

  const contact =
    getSingleResult(
      conversation.contact,
    );

  const previousMember =
    getSingleResult(
      conversation.assigned_member,
    );

  const customerName =
    contact?.full_name?.trim() ||
    "Facebook customer";

  /*
   * 4. Do not record duplicate activity when
   * the assignment has not changed.
   */
  if (previousAssignedTo === assignedTo) {
    return NextResponse.json({
      success: true,

      conversation: {
        id: conversation.id,
        assigned_to:
          previousAssignedTo,
      },

      activityRecorded: false,
      message:
        "Conversation assignment was unchanged.",
    });
  }

  /*
   * 5. Verify the selected team member.
   *
   * The assignee must belong to the same
   * business and must be active.
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
        business_id,
        full_name,
        email,
        role,
        profile_picture_url,
        is_active
      `)
      .eq("id", assignedTo)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .eq("is_active", true)
      .maybeSingle();

    if (teamMemberError) {
      console.error(
        "Unable to verify selected team member:",
        teamMemberError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to verify the selected team member.",
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
            "The selected team member was not found or does not belong to this business.",
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
   * 6. Update the conversation assignment.
   */
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
    .eq("id", conversation.id)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select(`
      id,
      assigned_to,
      assigned_at,
      updated_at
    `)
    .maybeSingle();

  if (updateError) {
    console.error(
      "Unable to update conversation assignment:",
      updateError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to update the conversation assignment.",
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
   * 7. Record the assignment activity.
   */
  let activityRecorded = false;

  try {
    if (selectedMember) {
      const activityTitle =
        previousMember
          ? `reassigned the conversation from ${previousMember.full_name} to ${selectedMember.full_name}`
          : `assigned the conversation to ${selectedMember.full_name}`;

      const activityDescription =
        previousMember
          ? `${currentMember.full_name} reassigned ${customerName}'s conversation from ${previousMember.full_name} to ${selectedMember.full_name}.`
          : `${currentMember.full_name} assigned ${customerName}'s conversation to ${selectedMember.full_name}.`;

      await createConversationActivity({
        businessId:
          conversation.business_id,

        conversationId:
          conversation.id,

        contactId:
          conversation.contact_id,

        actorMemberId:
          currentMember.id,

        activityType: "assigned",

        title: activityTitle,

        description:
          activityDescription,

        customerName,

        actorName:
          currentMember.full_name,

        actorProfilePictureUrl:
          currentMember.profile_picture_url,

        metadata: {
          previousAssignee: {
            memberId:
              previousMember?.id ?? null,

            name:
              previousMember?.full_name ??
              null,
          },

          newAssignee: {
            memberId:
              selectedMember.id,

            name:
              selectedMember.full_name,

            role:
              selectedMember.role,
          },

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
    } else {
      await createConversationActivity({
        businessId:
          conversation.business_id,

        conversationId:
          conversation.id,

        contactId:
          conversation.contact_id,

        actorMemberId:
          currentMember.id,

        activityType: "unassigned",

        title:
          previousMember
            ? `removed ${previousMember.full_name} from the conversation`
            : "removed the conversation assignment",

        description:
          previousMember
            ? `${currentMember.full_name} removed ${previousMember.full_name} from ${customerName}'s conversation.`
            : `${currentMember.full_name} marked ${customerName}'s conversation as unassigned.`,

        customerName,

        actorName:
          currentMember.full_name,

        actorProfilePictureUrl:
          currentMember.profile_picture_url,

        metadata: {
          previousAssignee: {
            memberId:
              previousMember?.id ?? null,

            name:
              previousMember?.full_name ??
              null,
          },

          newAssignee: null,

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