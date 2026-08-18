import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type PinConversationBody = {
  isPinned?: boolean;
  /* Kept for request compatibility; the server no longer trusts this value. */
  pinnedBy?: string | null;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

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
      /* Never accept another member id supplied by the browser. */
      pinned_by: body.isPinned
        ? currentMember.id
        : null,
      updated_at: now,
    })
    .eq(
      "id",
      normalizedConversationId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select(`
      id,
      is_pinned,
      pinned_at,
      pinned_by
    `)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          body.isPinned
            ? "Unable to pin conversation."
            : "Unable to unpin conversation.",
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
          "Conversation was not found or you do not have access.",
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
