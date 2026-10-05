import { NextRequest, NextResponse } from "next/server";

import { memberHasPermission } from "@/lib/auth/require-permission";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { featureGate, jsonError } from "@/lib/telegram-personal/server";
import { PERSONAL_PLATFORM } from "@/lib/telegram-personal/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Replies from TENH through a Telegram Personal account (D2).
 *
 * Only the account holder may reply; teammates who can see the chat read only.
 * Every send carries a client request id: the queue accepts each id once, so a
 * repeated request can never send twice. The worker reports the outcome; when
 * Telegram does not confirm it the send becomes "uncertain" and is never
 * retried automatically. The holder checks Telegram and decides.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_TEXT = 4096;
const WAIT_MS = 12_000;
const POLL_MS = 600;

type SendState = { state: string; code?: string | null; message_id?: string | null };

async function authorize(conversationId: string | null) {
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
async function replyStatus(conversationId: string, socialAccountId: string | null, userId: string) {
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

async function readState(conversationId: string, businessId: string, userId: string, clientRequestId: string) {
  const { data, error } = await supabaseAdmin.rpc("tgp_send_state", {
    p_conversation: conversationId, p_business: businessId, p_user: userId, p_client_request_id: clientRequestId,
  });
  if (error) throw new Error("Unable to read the send state.");
  return (data ?? { state: "not_found" }) as SendState;
}

/** Turns the queue state into what the composer shows. */
function present(raw: SendState) {
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

/**
 * ?conversationId=...                       whether this member may reply
 * ?conversationId=...&clientRequestId=...   the outcome of one send
 */
export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  const result = await authorize(conversationId);
  if ("response" in result) return result.response;
  const { access } = result;

  try {
    const clientRequestId = request.nextUrl.searchParams.get("clientRequestId");
    if (clientRequestId) {
      if (!UUID.test(clientRequestId)) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
      const state = await readState(access.conversation.id, access.conversation.business_id, access.user.id, clientRequestId);
      return NextResponse.json({ success: true, ...present(state) }, { headers: NO_STORE });
    }
    const allowed = await memberHasPermission(access.member, "conversations", "manage");
    const status = allowed
      ? await replyStatus(access.conversation.id, access.conversation.social_account_id, access.user.id)
      : { canReply: false, reason: "NO_PERMISSION" };
    return NextResponse.json({ success: true, ...status }, { headers: NO_STORE });
  } catch {
    return jsonError("Unable to load Telegram Personal reply status.", 500, "LOAD_FAILED");
  }
}

const ENQUEUE_ERRORS: Record<string, [string, number]> = {
  INVALID_TEXT: ["Write a message of up to 4,096 characters.", 400],
  NOT_FOUND: ["Conversation was not found.", 404],
  HOLDER_ONLY: ["Only the person who connected this Telegram account can reply from TENH.", 403],
  NOT_CONNECTED: ["This Telegram account is not connected right now.", 409],
  CHAT_NOT_SHARED: ["This chat is no longer shared into TENH.", 409],
  RATE_LIMITED: ["You are sending too fast. Wait a moment and send again.", 429],
};

/** { conversationId, clientRequestId, text } */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 32_768) return jsonError("Request too large.", 413, "INVALID_REQUEST");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError("Invalid JSON request.", 400, "INVALID_REQUEST");
  }

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  const result = await authorize(conversationId);
  if ("response" in result) return result.response;
  const { access } = result;

  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!UUID.test(clientRequestId)) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
  if (!text.trim() || text.length > MAX_TEXT) return jsonError(ENQUEUE_ERRORS.INVALID_TEXT[0], 400, "INVALID_TEXT");
  if (!(await memberHasPermission(access.member, "conversations", "manage"))) {
    return jsonError("You do not have permission to reply in this workspace.", 403, "NO_PERMISSION");
  }

  const { data, error } = await supabaseAdmin.rpc("tgp_enqueue_send", {
    p_conversation: access.conversation.id,
    p_business: access.conversation.business_id,
    p_user: access.user.id,
    p_member: access.member.id,
    p_client_request_id: clientRequestId,
    p_text: text,
  });
  if (error) {
    // Nothing was queued (the call failed as a whole), so nothing can have been sent.
    console.error("[TENH Telegram Personal] enqueue failed:", error.code ?? "unknown");
    return jsonError("Unable to queue the message. Nothing was sent.", 500, "ENQUEUE_FAILED");
  }
  const queued = (data ?? {}) as { ok?: boolean; code?: string };
  if (!queued.ok) {
    const code = queued.code ?? "REQUEST_FAILED";
    const [message, status] = ENQUEUE_ERRORS[code] ?? ["Unable to send the message.", 500];
    return jsonError(message, status, code);
  }

  // Wait briefly for the worker's outcome; afterwards the composer keeps polling GET.
  const deadline = Date.now() + WAIT_MS;
  let state: ReturnType<typeof present> = { state: "pending" };
  try {
    while (Date.now() < deadline) {
      state = present(await readState(access.conversation.id, access.conversation.business_id, access.user.id, clientRequestId));
      if (state.state !== "pending" && state.state !== "not_found") break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch {
    state = { state: "pending" };
  }
  if (state.state === "not_found") state = { state: "pending" };
  return NextResponse.json({ success: true, clientRequestId, ...state }, { status: state.state === "pending" ? 202 : 200, headers: NO_STORE });
}
