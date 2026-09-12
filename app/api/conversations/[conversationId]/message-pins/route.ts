import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getMessageActions, getMessagePin, isMessagePinned } from "@/lib/inbox/message-actions";
import { mutateMessageMetadata, MessageMutationError } from "@/lib/inbox/mutate-message-metadata";
import type { InboxMessage } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
const fail = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

export async function GET(_request: NextRequest, context: Context) {
  const { conversationId } = await context.params;
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return fail(access.error, access.status);
  const { data, error } = await supabaseAdmin.from("messages").select("*")
    .eq("business_id", access.businessId).eq("conversation_id", conversationId)
    .eq("raw_payload->tenh_message_pin->>pinned", "true")
    .order("created_at", { ascending: false }).limit(101);
  if (error) return fail("Unable to load pinned messages.", 500);
  const pins = ((data ?? []) as InboxMessage[]).filter(isMessagePinned).sort((a, b) =>
    String(getMessagePin(b).updated_at ?? "").localeCompare(String(getMessagePin(a).updated_at ?? "")));
  return NextResponse.json({ success: true, pins: pins.slice(0, 100), truncated: pins.length > 100 },
    { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: Context) {
  const { conversationId } = await context.params;
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return fail(access.error, access.status);
  if (!(await memberHasPermission(access.member, "conversations", "manage"))) {
    return fail("You do not have permission to pin messages in this workspace.", 403);
  }
  let body: { messageId?: unknown; pinned?: unknown };
  try { body = await request.json(); } catch { return fail("Invalid JSON request.", 400); }
  if (!body || typeof body.messageId !== "string" || !body.messageId.trim() || typeof body.pinned !== "boolean") {
    return fail("messageId and pinned (true or false) are required.", 400);
  }
  const { data: conversation, error } = await supabaseAdmin.from("conversations").select("platform")
    .eq("id", conversationId).eq("business_id", access.businessId).maybeSingle();
  if (error || !conversation) return fail("Unable to verify the conversation channel.", 500);
  const pinned = body.pinned;
  try {
    const message = await mutateMessageMetadata(supabaseAdmin, {
      businessId: access.businessId, conversationId, messageId: body.messageId.trim(),
    }, (current) => {
      // Unpin is also allowed for a legacy/deleted message, so no stale pin is trapped.
      if (pinned && !getMessageActions(current, conversation.platform).pin) {
        throw new MessageMutationError("This message cannot be pinned for this channel.", 400);
      }
      return { raw_payload: { ...(current.raw_payload ?? {}), tenh_message_pin: {
        pinned, updated_at: new Date().toISOString(), pinned_by_member_id: access.member.id,
        pinned_by_name: access.member.full_name?.trim() || "TENH team member",
      } } };
    });
    return NextResponse.json({ success: true, message });
  } catch (error) {
    return fail(error instanceof MessageMutationError ? error.message : "Unable to save the pinned message.",
      error instanceof MessageMutationError ? error.status : 500);
  }
}
