import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getInboxContactAccess } from "@/lib/inbox/get-inbox-resource-access";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    contactId: string;
    noteId: string;
  }>;
};

type UpdateNoteBody = {
  noteText?: string;
  conversationId?: string;
};

type DeleteNoteBody = {
  conversationId?: string;
};

type ContactResult = {
  id: string;
  business_id: string;
  full_name: string | null;
};

type NoteResult = {
  id: string;
  contact_id: string;
  author_id: string;
  note_text: string;
  created_at: string;
  updated_at: string;
};

async function loadNoteContext({
  contactId,
  noteId,
  conversationId,
  businessId,
}: {
  contactId: string;
  noteId: string;
  conversationId: string;
  businessId: string;
}) {
  const {
    data: contactData,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name
    `)
    .eq("id", contactId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (contactError) {
    throw new Error(
      `Unable to load customer: ${contactError.message}`,
    );
  }

  if (!contactData) {
    return {
      success: false as const,
      status: 404,
      error:
        "Customer was not found or you do not have access.",
    };
  }

  const {
    data: conversationData,
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
    .eq("business_id", businessId)
    .maybeSingle();

  if (conversationError) {
    throw new Error(
      `Unable to load conversation: ${conversationError.message}`,
    );
  }

  if (!conversationData) {
    return {
      success: false as const,
      status: 404,
      error:
        "A matching conversation was not found.",
    };
  }

  const {
    data: noteData,
    error: noteError,
  } = await supabaseAdmin
    .from("contact_notes")
    .select(`
      id,
      contact_id,
      author_id,
      note_text,
      created_at,
      updated_at
    `)
    .eq("id", noteId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (noteError) {
    throw new Error(
      `Unable to load internal note: ${noteError.message}`,
    );
  }

  if (!noteData) {
    return {
      success: false as const,
      status: 404,
      error:
        "Internal note was not found.",
    };
  }

  return {
    success: true as const,
    contact:
      contactData as ContactResult,
    conversationId:
      conversationData.id as string,
    note:
      noteData as NoteResult,
  };
}

/*
 * Edit note.
 */
export async function PATCH(
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

  const {
    contactId,
    noteId,
  } = await context.params;

  let body: UpdateNoteBody;

  try {
    body =
      (await request.json()) as UpdateNoteBody;
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
          "Note cannot be empty.",
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
          "Note cannot contain more than 5,000 characters.",
      },
      {
        status: 400,
      },
    );
  }

  let contextResult;

  try {
    contextResult =
      await loadNoteContext({
        contactId,
        noteId,
        conversationId,
        businessId:
          currentMember.business_id,
      });
  } catch (loadError) {
    console.error(
      "Unable to load note context:",
      loadError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          loadError instanceof Error
            ? loadError.message
            : "Unable to load note information.",
      },
      {
        status: 500,
      },
    );
  }

  if (!contextResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: contextResult.error,
      },
      {
        status: contextResult.status,
      },
    );
  }

  const {
    contact,
    note,
  } = contextResult;

  /*
   * Only the note author can edit it.
   * Change this later if owner/admin should
   * edit every staff note.
   */
  if (
    note.author_id !==
    currentMember.id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You can only edit notes that you created.",
      },
      {
        status: 403,
      },
    );
  }

  if (note.note_text === noteText) {
    return NextResponse.json({
      success: true,
      note,
      activityRecorded: false,
      message:
        "The internal note was unchanged.",
    });
  }

  const oldNoteText =
    note.note_text;

  const { data, error } =
    await supabaseAdmin
      .from("contact_notes")
      .update({
        note_text: noteText,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", note.id)
      .eq(
        "author_id",
        currentMember.id,
      )
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

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to update internal note.",
        details: error.message,
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

      conversationId,

      contactId:
        contact.id,

      actorMemberId:
        currentMember.id,

      activityType:
        "note_updated",

      title:
        "updated an internal note",

      description:
        `${currentMember.full_name} updated an internal note for ${customerName}.`,

      customerName,

      actorName:
        currentMember.full_name,

      actorProfilePictureUrl:
        currentMember.profile_picture_url,

      metadata: {
        noteId: note.id,
        oldNoteText,
        newNoteText: data.note_text,

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
      "Note was updated, but activity could not be recorded:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    note: data,
    activityRecorded,
  });
}

/*
 * Delete note.
 */
export async function DELETE(
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

  const {
    contactId,
    noteId,
  } = await context.params;

  let body: DeleteNoteBody;

  try {
    body =
      (await request.json()) as DeleteNoteBody;
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

  let contextResult;

  try {
    contextResult =
      await loadNoteContext({
        contactId,
        noteId,
        conversationId,
        businessId:
          currentMember.business_id,
      });
  } catch (loadError) {
    console.error(
      "Unable to load note context:",
      loadError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          loadError instanceof Error
            ? loadError.message
            : "Unable to load note information.",
      },
      {
        status: 500,
      },
    );
  }

  if (!contextResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: contextResult.error,
      },
      {
        status: contextResult.status,
      },
    );
  }

  const {
    contact,
    note,
  } = contextResult;

  if (
    note.author_id !==
    currentMember.id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You can only delete notes that you created.",
      },
      {
        status: 403,
      },
    );
  }

  const deletedNoteText =
    note.note_text;

  const { error } =
    await supabaseAdmin
      .from("contact_notes")
      .delete()
      .eq("id", note.id)
      .eq(
        "author_id",
        currentMember.id,
      );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to delete internal note.",
        details: error.message,
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

      conversationId,

      contactId:
        contact.id,

      actorMemberId:
        currentMember.id,

      activityType:
        "note_deleted",

      title:
        "deleted an internal note",

      description:
        `${currentMember.full_name} deleted an internal note for ${customerName}.`,

      customerName,

      actorName:
        currentMember.full_name,

      actorProfilePictureUrl:
        currentMember.profile_picture_url,

      metadata: {
        noteId: note.id,
        deletedNoteText,

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
      "Note was deleted, but activity could not be recorded:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    activityRecorded,
  });
}