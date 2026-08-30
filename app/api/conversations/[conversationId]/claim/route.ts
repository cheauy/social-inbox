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

type ConversationRow = {
  id: string;
  business_id: string;
  contact_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
};

export async function PATCH(
  _request: NextRequest,
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
      { status: 400 },
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
      assigned_at
    `)
    .eq("id", normalizedConversationId)
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
        details: conversationError.message,
      },
      { status: 500 },
    );
  }

  if (!conversationData) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation was not found or you do not have access.",
      },
      { status: 404 },
    );
  }

  const conversation =
    conversationData as ConversationRow;

  if (
    conversation.assigned_to ===
    currentMember.id
  ) {
    return NextResponse.json({
      success: true,
      alreadyAssigned: true,
      conversation,
    });
  }

  if (conversation.assigned_to) {
    return NextResponse.json(
      {
        success: false,
        conflict: true,
        error:
          "This conversation was already assigned to another teammate.",
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  const {
    data: claimedConversation,
    error: claimError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      assigned_to: currentMember.id,
      assigned_at: now,
      updated_at: now,
    })
    .eq("id", normalizedConversationId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .is("assigned_to", null)
    .select(`
      id,
      business_id,
      contact_id,
      assigned_to,
      assigned_at
    `)
    .maybeSingle();

  if (claimError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to assign the conversation to you.",
        details: claimError.message,
      },
      { status: 500 },
    );
  }

  if (!claimedConversation) {
    return NextResponse.json(
      {
        success: false,
        conflict: true,
        error:
          "Another teammate claimed this conversation first.",
      },
      { status: 409 },
    );
  }

  let customerName = "Facebook customer";

  if (conversation.contact_id) {
    const { data: contact } =
      await supabaseAdmin
        .from("contacts")
        .select("full_name")
        .eq("id", conversation.contact_id)
        .eq(
          "business_id",
          currentMember.business_id,
        )
        .maybeSingle();

    customerName =
      contact?.full_name?.trim() ||
      customerName;
  }

  let activityRecorded = false;

  try {
    await createConversationActivity({
      businessId:
        currentMember.business_id,
      conversationId:
        normalizedConversationId,
      contactId:
        conversation.contact_id,
      actorMemberId:
        currentMember.id,
      activityType: "assigned",
      title: "assigned conversation to self",
      description:
        `${currentMember.full_name} claimed ${customerName}.`,
      customerName,
      actorName:
        currentMember.full_name,
      actorProfilePictureUrl:
        currentMember.profile_picture_url,
      metadata: {
        assignedTo: {
          memberId: currentMember.id,
          name: currentMember.full_name,
          role: currentMember.role,
        },
        assignmentMethod: "claim",
      },
    });

    activityRecorded = true;
  } catch (activityError) {
    console.error(
      "Conversation was claimed, but activity recording failed:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    conversation: claimedConversation,
    activityRecorded,
  });
}
