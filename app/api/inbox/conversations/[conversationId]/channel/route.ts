import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type ConversationPlatformRow = {
  id: string;
  platform: string | null;
};

export async function GET(
  _request: NextRequest,
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
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const { conversationId } =
    await context.params;

  if (!conversationId?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation ID is required.",
      },
      { status: 400 },
    );
  }

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from("conversations")
      .select("id,platform")
      .eq(
        "id",
        conversationId,
      )
      .eq(
        "business_id",
        authResult.member.business_id,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "[TENH Inbox] Unable to resolve conversation platform:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to resolve the conversation channel.",
      },
      { status: 500 },
    );
  }

  const conversation =
    data as unknown as
      ConversationPlatformRow | null;

  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation was not found.",
      },
      { status: 404 },
    );
  }

  const platform =
    conversation.platform === "telegram"
      ? "telegram"
      : conversation.platform === "facebook"
        ? "facebook"
        : null;

  if (!platform) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This conversation channel is not supported for sending yet.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      platform,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
