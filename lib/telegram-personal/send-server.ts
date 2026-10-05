import "server-only";

import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { featureGate, jsonError } from "@/lib/telegram-personal/server";
import { PERSONAL_PLATFORM } from "@/lib/telegram-personal/visibility";

/*
 * Shared by the Telegram Personal send route (text and files). See that route
 * for the safety rules: holder only, one send per request id, no automatic
 * resend of an uncertain outcome.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NO_STORE = { "Cache-Control": "no-store" };
const WAIT_MS = 12_000;
const POLL_MS = 600;

type SendState = { state: string; code?: string | null; message_id?: string | null };
export type PresentedState = { state: string; code?: string; messageId?: string | null };

export async function authorizeSendConversation(conversationId: string | null) {
  if (!conversationId || !UUID.test(conversationId)) {
    return { response: jsonError("Conversation was not found.", 404, "NOT_FOUND") };
  }
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return { response: jsonError(access.error, access.status, "NOT_FOUND") };
  if (access.conversation.platform !== PERSONAL_PLATFORM) {
    return { response: jsonError("Conversation was not found.", 404, "NOT_FOUND") };
  }
  const gated = featureGate(access.member);
  if (gated) return { response: gated };
  return { access };
}

/** Why this member may or may not reply here (shown in the composer). */
export async function replyStatus(conversationId: string, socialAccountId: string | null, userId: string) {
  if (!socialAccountId) return { canReply: false, reason: "NOT_CONNECTED" };
  const [session, chat] = await Promise.all([
    supabaseAdmin
      .from("telegram_personal_sessions")
      .select("holder_user_id,status")
      .eq("social_account_id", socialAccountId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("telegram_personal_chats")
      .select("id")
      .eq("conversation_id", conversationId)
      .is("unshared_at", null)
      .maybeSingle(),
  ]);
  if (session.error || chat.error) throw new Error("Unable to verify Telegram Personal reply access.");
  const row = session.data as { holder_user_id: string; status: string } | null;
  if (!row || row.holder_user_id !== userId) return { canReply: false, reason: "HOLDER_ONLY" };
  if (!["connected", "reconnecting"].includes(row.status)) return { canReply: false, reason: "NOT_CONNECTED" };
  if (!chat.data) return { canReply: false, reason: "CHAT_NOT_SHARED" };
  return { canReply: true, reason: null };
}

export async function readSendState(conversationId: string, businessId: string, userId: string, clientRequestId: string) {
  const { data, error } = await supabaseAdmin.rpc("tgp_send_state", {
    p_conversation: conversationId, p_business: businessId, p_user: userId, p_client_request_id: clientRequestId,
  });
  if (error) throw new Error("Unable to read the send state.");
  return (data ?? { state: "not_found" }) as SendState;
}

/** Turns the queue state into what the composer shows. */
export function presentSendState(raw: SendState): PresentedState {
  switch (raw.state) {
    case "done":
      return { state: "sent", messageId: raw.message_id ?? null };
    case "failed":
      return { state: "failed", code: raw.code ?? "SEND_FAILED" };
    case "uncertain":
      return { state: "uncertain", code: raw.code ?? "OUTCOME_UNKNOWN" };
    case "not_found":
      return { state: "not_found" };
    default:
      return { state: "pending" };
  }
}

export const ENQUEUE_ERRORS: Record<string, [string, number]> = {
  INVALID_TEXT: ["Write a message of up to 4,096 characters.", 400],
  CAPTION_TOO_LONG: ["A caption can be up to 1,024 characters.", 400],
  INVALID_MEDIA: ["This file cannot be sent.", 400],
  REPLY_NOT_FOUND: ["The message you are replying to is no longer available.", 409],
  NOT_FOUND: ["Conversation was not found.", 404],
  HOLDER_ONLY: ["Only the person who connected this Telegram account can reply from TENH.", 403],
  NOT_CONNECTED: ["This Telegram account is not connected right now.", 409],
  CHAT_NOT_SHARED: ["This chat is no longer shared into TENH.", 409],
  RATE_LIMITED: ["You are sending too fast. Wait a moment and send again.", 429],
};

export type EnqueueInput = {
  conversationId: string;
  businessId: string;
  userId: string;
  memberId: string;
  clientRequestId: string;
  text: string;
  media: Record<string, unknown> | null;
  replyTo: string | null;
};

/**
 * Queues the send. Uses the media-capable queue when installed; a plain text
 * send without a quote still works on the earlier SQL.
 */
export async function enqueuePersonalSend(input: EnqueueInput): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: string; failed?: boolean }> {
  const v2 = await supabaseAdmin.rpc("tgp_enqueue_send_v2", {
    p_conversation: input.conversationId,
    p_business: input.businessId,
    p_user: input.userId,
    p_member: input.memberId,
    p_client_request_id: input.clientRequestId,
    p_text: input.text,
    p_media: input.media,
    p_reply_to: input.replyTo,
  });
  let result = v2;
  if (v2.error && (v2.error.code === "42883" || v2.error.code === "PGRST202")) {
    if (input.media || input.replyTo) return { ok: false, code: "NOT_INSTALLED", failed: true };
    result = await supabaseAdmin.rpc("tgp_enqueue_send", {
      p_conversation: input.conversationId,
      p_business: input.businessId,
      p_user: input.userId,
      p_member: input.memberId,
      p_client_request_id: input.clientRequestId,
      p_text: input.text,
    });
  }
  if (result.error) {
    console.error("[TENH Telegram Personal] enqueue failed:", result.error.code ?? "unknown");
    return { ok: false, code: "ENQUEUE_FAILED", failed: true };
  }
  const queued = (result.data ?? {}) as { ok?: boolean; code?: string; duplicate?: boolean };
  return queued.ok ? { ok: true, duplicate: queued.duplicate === true } : { ok: false, code: queued.code ?? "REQUEST_FAILED" };
}

export function enqueueErrorResponse(code: string, failed?: boolean) {
  if (failed) {
    return code === "NOT_INSTALLED"
      ? jsonError("Sending files and quoting needs the latest Telegram Personal database update. Nothing was sent.", 409, code)
      : jsonError("Unable to queue the message. Nothing was sent.", 500, code);
  }
  const [message, status] = ENQUEUE_ERRORS[code] ?? ["Unable to send the message.", 500];
  return jsonError(message, status, code);
}

/** Waits briefly for the worker's outcome; afterwards the composer keeps polling. */
export async function waitForSendOutcome(conversationId: string, businessId: string, userId: string, clientRequestId: string) {
  const deadline = Date.now() + WAIT_MS;
  let state: PresentedState = { state: "pending" };
  try {
    while (Date.now() < deadline) {
      state = presentSendState(await readSendState(conversationId, businessId, userId, clientRequestId));
      if (state.state !== "pending" && state.state !== "not_found") break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch {
    state = { state: "pending" };
  }
  return state.state === "not_found" ? { state: "pending" } : state;
}
