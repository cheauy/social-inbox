import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadMessages, loadVisibleChat } from "@/lib/telegram-personal/inbox-server";
import { featureGate, jsonError } from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ chatRowId: string }> };

async function access(chatRowId: string, strict: boolean) {
  const auth = await getCurrentMember(strict);
  if (!auth.success) return { response: jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED") };
  const gated = featureGate(auth.member);
  if (gated) return { response: gated };
  const chat = await loadVisibleChat(auth.member.business_id, auth.user.id, chatRowId);
  // 404 for chats in other workspaces and for chats this member may not see.
  if (!chat) return { response: jsonError("Chat not found.", 404, "NOT_FOUND") };
  return { auth, chat };
}

/** Messages of one shared chat, newest first; ?before=<iso>&beforeId=<telegram id> pages older. */
export async function GET(request: NextRequest, context: Context) {
  const { chatRowId } = await context.params;
  try {
    const result = await access(chatRowId, false);
    if ("response" in result) return result.response;
    const beforeAt = request.nextUrl.searchParams.get("before");
    const beforeId = Number(request.nextUrl.searchParams.get("beforeId"));
    const before = beforeAt && !Number.isNaN(Date.parse(beforeAt)) && Number.isSafeInteger(beforeId)
      ? { sentAt: new Date(beforeAt).toISOString(), messageId: beforeId }
      : null;
    const page = await loadMessages(result.chat.id, before);
    return NextResponse.json(
      {
        success: true,
        chat: { id: result.chat.id, title: result.chat.title, username: result.chat.username, unread: result.chat.unread_count },
        messages: page.messages.map((message) => ({
          id: message.id,
          telegramMessageId: message.telegram_message_id,
          direction: message.direction,
          type: message.message_type,
          body: message.body,
          placeholder: message.placeholder_kind,
          sentAt: message.sent_at,
        })),
        hasMore: page.hasMore,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[TENH Telegram Personal] messages failed:", error instanceof Error ? error.message : "unknown");
    return jsonError("Unable to load messages.", 500, "LOAD_FAILED");
  }
}

/** { action: "read" } marks the chat read for the workspace (TENH only; Telegram is not told). */
export async function POST(request: NextRequest, context: Context) {
  const { chatRowId } = await context.params;
  let body: { action?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400, "INVALID_REQUEST");
  }
  if (body.action !== "read") return jsonError("Unknown action.", 400, "INVALID_ACTION");
  try {
    const result = await access(chatRowId, true);
    if ("response" in result) return result.response;
    const { data, error } = await supabaseAdmin.rpc("tgp_mark_chat_read", {
      p_chat_row: result.chat.id,
      p_business: result.auth.member.business_id,
      p_user: result.auth.user.id,
    });
    if (error || data !== true) return jsonError("Unable to mark the chat read.", 409, "READ_FAILED");
    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Unable to mark the chat read.", 500, "READ_FAILED");
  }
}
