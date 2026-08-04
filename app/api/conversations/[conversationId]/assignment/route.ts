import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type AssignmentBody = {
  assignedTo?: string | null;
};

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { conversationId } = await context.params;

  let body: AssignmentBody;

  try {
    body = (await request.json()) as AssignmentBody;
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

  if (assignedTo) {
    const {
      data: teamMember,
      error: teamMemberError,
    } = await supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("id", assignedTo)
      .eq("is_active", true)
      .maybeSingle();

    if (teamMemberError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to verify the team member.",
        },
        {
          status: 500,
        },
      );
    }

    if (!teamMember) {
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
  }

  const now = new Date().toISOString();

  const {
    data: conversation,
    error: updateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      assigned_to: assignedTo,
      assigned_at: assignedTo ? now : null,
      updated_at: now,
    })
    .eq("id", conversationId)
    .select(`
      id,
      assigned_to,
      assigned_at
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
        error: "Conversation was not found.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    success: true,
    conversation,
  });
}