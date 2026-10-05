import "server-only";

import { NextResponse } from "next/server";

import { memberHasPermission } from "@/lib/auth/require-permission";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { getDeletedMessageText } from "@/lib/inbox/message-actions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isTelegramPersonalSendEnabled } from "@/lib/telegram-personal/feature-flag";
import { featureGate } from "@/lib/telegram-personal/server";
import { PERSONAL_PLATFORM } from "@/lib/telegram-personal/visibility";

/*
 * Edit, delete and typing for Telegram Personal chats, reached through the same
 * routes the Telegram Bot chat uses (/api/telegram/messages/[id], /api/telegram/typing),
 * so the chat screen is identical. Holder only (enforced in SQL); the worker does
 * the real edit/delete in Telegram and reports back.
 */

const WAIT_MS = 12_000;
const POLL_MS = 500;

const ERRORS: Record<string, [string, number]> = {
  HOLDER_ONLY: ["Only the person who connected this Telegram account can edit or delete messages from TENH.", 403],
  NOT_CONNECTED: ["This Telegram account is not connected right now.", 409],
  CHAT_NOT_SHARED: ["This chat is no longer shared into TENH.", 409],
  NOT_EDITABLE: ["Only your own text messages can be edited.", 400],
  INVALID_TEXT: ["Edited message text is required (up to 4,096 characters).", 400],
  MESSAGE_NOT_FOUND: ["Telegram message was not found.", 404],
  NOT_FOUND: ["Telegram message was not found.", 404],
};

const fail = (error: string, status: number, code?: string) => NextResponse.json({ success: false, error, ...(code ? { code } : {}) }, { status });

/** The message row if it is a Telegram Personal message, else null (the Bot route handles it). */
export async function loadPersonalMessage(messageId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return null;
  const { data } = await supabaseAdmin
    .from("messages")
    .select("id,conversation_id,platform_message_id,message_text,raw_payload,platform_created_at,created_at")
    .eq("id", messageId)
    .like("platform_message_id", "tgp:%")
    .maybeSingle();
  return data as { id: string; conversation_id: string; platform_message_id: string; message_text: string | null; raw_payload: Record<string, unknown> | null } | null;
}

async function authorize(conversationId: string) {
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return { response: fail(access.error, access.status) };
  if (access.conversation.platform !== PERSONAL_PLATFORM) return { response: fail("Telegram message was not found.", 404) };
  const gated = featureGate(access.member);
  if (gated) return { response: gated };
  if (!isTelegramPersonalSendEnabled(process.env, access.conversation.business_id)) {
    return { response: fail("Replying from TENH is not switched on for Telegram Personal yet.", 403, "SEND_DISABLED") };
  }
  if (!(await memberHasPermission(access.member, "conversations", "manage"))) {
    return { response: fail("You do not have permission to reply in this workspace.", 403) };
  }
  return { access };
}

async function enqueue(access: Extract<Awaited<ReturnType<typeof authorize>>, { access: unknown }>["access"], action: "edit" | "delete" | "typing", messageId: string | null, text: string | null) {
  const { data, error } = await supabaseAdmin.rpc("tgp_enqueue_action", {
    p_conversation: access.conversation.id,
    p_business: access.conversation.business_id,
    p_user: access.user.id,
    p_member: access.member.id,
    p_action: action,
    p_message: messageId,
    p_text: text,
  });
  if (error) {
    return { response: error.code === "42883" || error.code === "PGRST202"
      ? fail("Editing and deleting needs the latest Telegram Personal database update.", 409, "NOT_INSTALLED")
      : fail("Unable to reach the Telegram Personal queue. Nothing was changed.", 500) };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; command_id?: string; skipped?: boolean };
  if (!result.ok) {
    if (result.code === "ALREADY_DELETED") return { alreadyDeleted: true as const };
    const [message, status] = ERRORS[result.code ?? ""] ?? ["Unable to change the Telegram message.", 500];
    return { response: fail(message, status, result.code) };
  }
  return { commandId: result.command_id ?? null };
}

async function waitForOutcome(commandId: string, businessId: string, userId: string) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const { data } = await supabaseAdmin.rpc("tgp_action_state", { p_command: commandId, p_business: businessId, p_user: userId });
    const state = (data ?? {}) as { state?: string; code?: string };
    if (state.state === "done") return { ok: true as const };
    if (state.state === "failed") return { ok: false as const, code: state.code ?? "ACTION_FAILED" };
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return { ok: false as const, code: "PENDING" };
}

async function reload(messageId: string) {
  const { data } = await supabaseAdmin.from("messages").select("id,message_text,raw_payload").eq("id", messageId).maybeSingle();
  return data as { id: string; message_text: string | null; raw_payload: Record<string, unknown> | null } | null;
}

export async function editPersonalMessage(message: NonNullable<Awaited<ReturnType<typeof loadPersonalMessage>>>, text: string) {
  const auth = await authorize(message.conversation_id);
  if ("response" in auth) return auth.response;
  const queued = await enqueue(auth.access, "edit", message.id, text);
  if ("response" in queued) return queued.response;
  if ("alreadyDeleted" in queued) return fail("This message was deleted.", 409);
  const outcome = await waitForOutcome(queued.commandId as string, auth.access.conversation.business_id, auth.access.user.id);
  if (!outcome.ok) {
    return outcome.code === "PENDING"
      ? fail("Telegram has not confirmed the edit yet. Check the chat in Telegram before trying again.", 504, "PENDING")
      : fail(`Telegram did not accept the edit. (${outcome.code})`, 502, outcome.code);
  }
  const updated = await reload(message.id);
  const edit = (updated?.raw_payload?.tenh_edit ?? {}) as { edited_at?: string };
  return NextResponse.json({ success: true, messageId: message.id, messageText: updated?.message_text ?? text, editedAt: edit.edited_at ?? new Date().toISOString() });
}

export async function deletePersonalMessage(message: NonNullable<Awaited<ReturnType<typeof loadPersonalMessage>>>) {
  const auth = await authorize(message.conversation_id);
  if ("response" in auth) return auth.response;
  const queued = await enqueue(auth.access, "delete", message.id, null);
  if ("response" in queued) return queued.response;
  if (!("alreadyDeleted" in queued)) {
    const outcome = await waitForOutcome(queued.commandId as string, auth.access.conversation.business_id, auth.access.user.id);
    if (!outcome.ok) {
      return outcome.code === "PENDING"
        ? fail("Telegram has not confirmed the delete yet. Check the chat in Telegram.", 504, "PENDING")
        : fail(`Telegram did not delete the message. (${outcome.code})`, 502, outcome.code);
    }
  }
  const updated = await reload(message.id);
  const deleted = (updated?.raw_payload?.tenh_deleted ?? { source: "tenh", deleted_at: new Date().toISOString() }) as Record<string, unknown>;
  return NextResponse.json({
    success: true,
    messageId: message.id,
    deletedAt: deleted.deleted_at,
    deleted,
    messageText: getDeletedMessageText({ raw_payload: { tenh_deleted: deleted }, message_text: null }),
    alreadyDeleted: "alreadyDeleted" in queued,
  });
}

/** "typing…" in Telegram while the holder types in TENH. Best effort; never an error for the UI. */
export async function personalTyping(conversationId: string) {
  const auth = await authorize(conversationId);
  if ("response" in auth) return NextResponse.json({ success: false }, { status: 200 });
  await enqueue(auth.access, "typing", null, null);
  return NextResponse.json({ success: true });
}
