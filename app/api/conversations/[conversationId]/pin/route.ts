import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type PinConversationBody = {
  isPinned?: boolean;
  pinnedBy?: string | null;
};

export async function PATCH(
  request: NextRequest,
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
        error:
          "Conversation ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  let body: PinConversationBody;

  try {
    body =
      (await request.json()) as PinConversationBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    typeof body.isPinned !==
    "boolean"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "isPinned must be true or false.",
      },
      {
        status: 400,
      },
    );
  }

  const now =
    new Date().toISOString();

  const {
    data: conversation,
    error,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      is_pinned: body.isPinned,
      pinned_at: body.isPinned
        ? now
        : null,
      pinned_by: body.isPinned
        ? body.pinnedBy ?? null
        : null,
      updated_at: now,
    })
    .eq(
      "id",
      normalizedConversationId,
    )
    .select(`
      id,
      is_pinned,
      pinned_at,
      pinned_by
    `)
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          body.isPinned
            ? "Unable to pin conversation."
            : "Unable to unpin conversation.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    conversation,
  });
}