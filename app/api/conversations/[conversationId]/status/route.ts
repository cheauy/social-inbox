import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ConversationStatus } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set<ConversationStatus>([
  "open",
  "pending",
  "resolved",
  "closed",
  "spam",
]);

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

type UpdateStatusBody = {
  status?: string;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { conversationId } = await context.params;

  let body: UpdateStatusBody;

  try {
    body = (await request.json()) as UpdateStatusBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const status = body.status as ConversationStatus | undefined;

  if (!status || !allowedStatuses.has(status)) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid conversation status.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .update({
      status,
      status_updated_at: now,
      updated_at: now,
    })
    .eq("id", conversationId)
    .select("id,status")
    .maybeSingle();

  if (error) {
    console.error("Unable to update conversation status:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to update conversation status.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation was not found.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    conversation: data,
  });
}
