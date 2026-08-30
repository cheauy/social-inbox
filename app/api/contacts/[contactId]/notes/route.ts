import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getInboxContactAccess } from "@/lib/inbox/get-inbox-resource-access";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createTeamMentions } from "@/lib/team/create-team-mentions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

type CreateNoteBody = {
  noteText?: string;
  conversationId?: string;
  mentionedMemberIds?: string[];
  mentionEveryone?: boolean;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getInboxContactAccess((await context.params).contactId);

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

  const { contactId } =
    await context.params;

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq(
      "business_id",
      authResult.member.business_id,
    )
    .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify customer access.",
        details:
          contactError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  const {
    data: notes,
    error: notesError,
  } = await supabaseAdmin
    .from("contact_notes")
    .select(`
      id,
      contact_id,
      author_id,
      note_text,
      created_at,
      updated_at,

      author:team_members (
        id,
        full_name,
        email,
        role,
        profile_picture_url
      )
    `)
    .eq("contact_id", contactId)
    .order("created_at", {
      ascending: false,
    });

  if (notesError) {
    console.error(
      "Unable to load internal notes:",
      notesError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load internal notes.",
        details:
          notesError.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    notes: notes ?? [],
    currentMemberId:
      authResult.member.id,
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getInboxContactAccess((await context.params).contactId);

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

  const { contactId } =
    await context.params;

  let body: CreateNoteBody;

  try {
    body =
      (await request.json()) as CreateNoteBody;
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

  const noteText =
    body.noteText?.trim();

  const conversationId =
    body.conversationId?.trim();

  if (!conversationId) {
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

  if (!noteText) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Internal note cannot be empty.",
      },
      {
        status: 400,
      },
    );
  }

  if (noteText.length > 5000) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Internal note cannot contain more than 5,000 characters.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name
    `)
    .eq("id", contactId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the customer.",
        details:
          contactError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id
    `)
    .eq("id", conversationId)
    .eq("contact_id", contactId)
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
          "Unable to verify the conversation.",
        details:
          conversationError.message,
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
          "A matching conversation was not found.",
      },
      {
        status: 404,
      },
    );
  }

  const {
    data: note,
    error: insertError,
  } = await supabaseAdmin
    .from("contact_notes")
    .insert({
      contact_id: contact.id,
      author_id: currentMember.id,
      note_text: noteText,
    })
    .select(`
      id,
      contact_id,
      author_id,
      note_text,
      created_at,
      updated_at,

      author:team_members (
        id,
        full_name,
        email,
        role,
        profile_picture_url
      )
    `)
    .single();

  if (insertError) {
    console.error(
      "Unable to create internal note:",
      insertError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to create internal note.",
        details:
          insertError.message,
      },
      {
        status: 500,
      },
    );
  }

  const customerName =
    contact.full_name?.trim() ||
    "Facebook customer";

  let activityRecorded = false;

  try {
    await createConversationActivity({
      businessId:
        currentMember.business_id,

      conversationId:
        conversation.id,

      contactId:
        contact.id,

      actorMemberId:
        currentMember.id,

      activityType:
        "note_added",

      title:
        "added an internal note",

      description:
        `${currentMember.full_name} added an internal note for ${customerName}.`,

      customerName,

      actorName:
        currentMember.full_name,

      actorProfilePictureUrl:
        currentMember.profile_picture_url,

      metadata: {
        noteId: note.id,
        noteText: note.note_text,

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
      "Note created, but activity recording failed:",
      activityError,
    );
  }

  let mentionNotificationsCreated = 0;

  try {
    const mentionResult = await createTeamMentions({
      businessId: currentMember.business_id,
      actorMemberId: currentMember.id,
      actorName: currentMember.full_name,
      sourceType: "contact_note",
      sourceId: note.id,
      mentionedMemberIds:
        body.mentionedMemberIds ?? [],
      mentionEveryone:
        body.mentionEveryone === true,
      contactId: contact.id,
      conversationId: conversation.id,
      notificationType: "internal_note_mention",
      title: `${currentMember.full_name} mentioned you in an internal note`,
      body: `${customerName}: ${note.note_text}`.slice(0, 500),
      link: `/dashboard/inbox?conversation=${encodeURIComponent(
        conversation.id,
      )}`,
    });

    mentionNotificationsCreated =
      mentionResult.notificationsCreated;
  } catch (mentionError) {
    console.error(
      "Internal note saved, but mention notifications failed:",
      mentionError,
    );
  }

  return NextResponse.json({
    success: true,
    note,
    activityRecorded,
    mentionNotificationsCreated,
  });
}