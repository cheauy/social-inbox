import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

type CreateNoteBody = {
  authorId?: string;
  noteText?: string;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  const { contactId } = await context.params;

  const { data, error } = await supabaseAdmin
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
        role
      )
    `)
    .eq("contact_id", contactId)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    console.error(
      "Unable to load contact notes:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load internal notes.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    notes: data ?? [],
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  const { contactId } = await context.params;

  let body: CreateNoteBody;

  try {
    body = (await request.json()) as CreateNoteBody;
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

  if (!authorId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Assign this conversation to a staff member before adding a note.",
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
        error: "Note cannot be empty.",
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

  const { data: author, error: authorError } =
    await supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("id", authorId)
      .eq("is_active", true)
      .maybeSingle();

  if (authorError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify note author.",
        details: authorError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!author) {
    return NextResponse.json(
      {
        success: false,
        error: "The selected staff member was not found.",
      },
      {
        status: 404,
      },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("contact_notes")
    .insert({
      contact_id: contactId,
      author_id: authorId,
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
        role
      )
    `)
    .single();

  if (error) {
    console.error(
      "Unable to create contact note:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to create internal note.",
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
