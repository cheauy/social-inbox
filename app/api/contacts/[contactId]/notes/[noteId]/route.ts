import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    contactId: string;
    noteId: string;
  }>;
};

type UpdateNoteBody = {
  authorId?: string;
  noteText?: string;
};

type DeleteNoteBody = {
  authorId?: string;
};

async function loadOwnedNote(
  contactId: string,
  noteId: string,
  authorId: string,
) {
  return supabaseAdmin
    .from("contact_notes")
    .select("id")
    .eq("id", noteId)
    .eq("contact_id", contactId)
    .eq("author_id", authorId)
    .maybeSingle();
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { contactId, noteId } =
    await context.params;

  let body: UpdateNoteBody;

  try {
    body = (await request.json()) as UpdateNoteBody;
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

  const authorId = body.authorId?.trim();
  const noteText = body.noteText?.trim();

  if (!authorId || !noteText) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Author and note text are required.",
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
        error: "Note is too long.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: ownedNote,
    error: ownershipError,
  } = await loadOwnedNote(
    contactId,
    noteId,
    authorId,
  );

  if (ownershipError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify note ownership.",
        details: ownershipError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!ownedNote) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You can only edit notes created by the assigned staff member.",
      },
      {
        status: 403,
      },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("contact_notes")
    .update({
      note_text: noteText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
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
        role
      )
    `)
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to update internal note.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    note: data,
  });
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  const { contactId, noteId } =
    await context.params;

  let body: DeleteNoteBody;

  try {
    body = (await request.json()) as DeleteNoteBody;
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

  const authorId = body.authorId?.trim();

  if (!authorId) {
    return NextResponse.json(
      {
        success: false,
        error: "Author is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: ownedNote,
    error: ownershipError,
  } = await loadOwnedNote(
    contactId,
    noteId,
    authorId,
  );

  if (ownershipError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify note ownership.",
        details: ownershipError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!ownedNote) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You can only delete notes created by the assigned staff member.",
      },
      {
        status: 403,
      },
    );
  }

  const { error } = await supabaseAdmin
    .from("contact_notes")
    .delete()
    .eq("id", noteId);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete internal note.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
  });
}
