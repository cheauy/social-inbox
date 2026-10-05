import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { featureGate, jsonError, loadSession } from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

/** Chat sharing is managed by the account holder only; everyone else gets 404. */
async function holder(sessionId: string, strict: boolean) {
  const auth = await getCurrentMember(strict);
  if (!auth.success) return { response: jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED") };
  const gated = featureGate(auth.member);
  if (gated) return { response: gated };
  const session = await loadSession(auth.member.business_id, sessionId);
  if (!session || session.holder_user_id !== auth.user.id) return { response: jsonError("Not found.", 404, "NOT_FOUND") };
  return { auth, session };
}

/**
 * Without ?commandId: the chats this account shares + the count of waiting
 * (unshared) chats. With ?commandId: the state of a chat-list request.
 */
export async function GET(request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const result = await holder(sessionId, false);
  if ("response" in result) return result.response;
  const { auth, session } = result;

  const commandId = request.nextUrl.searchParams.get("commandId");
  if (commandId) {
    if (!UUID.test(commandId)) return jsonError("Invalid request.", 400, "INVALID_REQUEST");
    const { data, error } = await supabaseAdmin.rpc("tgp_read_chat_list", {
      p_command: commandId, p_session: session.id, p_business: auth.member.business_id, p_user: auth.user.id,
    });
    if (error) return jsonError("Unable to load your Telegram chats.", 500, "LOAD_FAILED");
    return NextResponse.json({ success: true, ...(data as object) }, { headers: NO_STORE });
  }

  if (!session.social_account_id) return NextResponse.json({ success: true, shared: [], waitingCount: 0 }, { headers: NO_STORE });
  const [chats, waiting] = await Promise.all([
    supabaseAdmin
      .from("telegram_personal_chats")
      .select("id,chat_id,title,username,shared_at,last_message_at,unread_count,history_import")
      .eq("business_id", auth.member.business_id)
      .eq("social_account_id", session.social_account_id)
      .is("unshared_at", null)
      .order("title", { ascending: true }),
    supabaseAdmin
      .from("telegram_personal_unshared_activity")
      .select("chat_hash", { count: "exact", head: true })
      .eq("social_account_id", session.social_account_id),
  ]);
  if (chats.error || waiting.error) return jsonError("Unable to load shared chats.", 500, "LOAD_FAILED");
  // Read separately: before the automatic-sharing SQL is installed the column does not exist.
  const auto = await supabaseAdmin.from("telegram_personal_sessions").select("auto_share").eq("id", session.id).maybeSingle();
  const autoShare = !auto.error && (auto.data as { auto_share?: boolean } | null)?.auto_share === true;
  return NextResponse.json(
    {
      success: true,
      shared: (chats.data ?? []).map((chat) => ({
        id: chat.id, chatId: chat.chat_id, title: chat.title, username: chat.username,
        sharedAt: chat.shared_at, lastMessageAt: chat.last_message_at, unread: chat.unread_count, history: chat.history_import,
      })),
      waitingCount: waiting.count ?? 0,
      autoShare,
      autoShareAvailable: !auto.error,
    },
    { headers: NO_STORE },
  );
}

/**
 * { action: "list" }                         ask the worker for recent one-to-one chats
 * { action: "share", chatId, history }       share one listed chat (history: none | last_50)
 * { action: "dismiss_waiting" }              clear the waiting-chats count
 * { action: "auto_share", enabled }         share every one-to-one chat automatically (new messages only)
 */
export async function POST(request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const result = await holder(sessionId, true);
  if ("response" in result) return result.response;
  const { auth, session } = result;

  let body: { action?: unknown; chatId?: unknown; history?: unknown; enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400, "INVALID_REQUEST");
  }
  const ids = { p_session: session.id, p_business: auth.member.business_id, p_user: auth.user.id };

  if (body.action === "list") {
    const { data, error } = await supabaseAdmin.rpc("tgp_request_chat_list", { ...ids, p_member: auth.member.id });
    if (error) return jsonError("Unable to request your Telegram chats.", 500, "REQUEST_FAILED");
    if (!data) return jsonError("Connect the account first.", 409, "NOT_CONNECTED");
    return NextResponse.json({ success: true, commandId: data }, { status: 202 });
  }

  if (body.action === "share") {
    const chatId = typeof body.chatId === "string" && /^-?[0-9]{1,20}$/.test(body.chatId) ? body.chatId : null;
    const history = body.history === "last_50" ? "last_50" : body.history === "none" ? "none" : null;
    if (!chatId || !history) return jsonError("Choose a chat and a history option.", 400, "INVALID_REQUEST");
    const { data, error } = await supabaseAdmin.rpc("tgp_share_chat", { ...ids, p_member: auth.member.id, p_chat_id: chatId, p_history: history });
    if (error) return jsonError("Unable to share this chat.", 500, "REQUEST_FAILED");
    const outcome = data as { ok?: boolean; code?: string; chat_row_id?: string };
    if (!outcome?.ok) {
      return outcome?.code === "CHAT_NOT_LISTED"
        ? jsonError("This chat list expired. Load your chats again.", 409, "CHAT_NOT_LISTED")
        : jsonError("You cannot share chats for this account.", 403, outcome?.code ?? "FORBIDDEN");
    }
    return NextResponse.json({ success: true, chatRowId: outcome.chat_row_id });
  }

  if (body.action === "auto_share") {
    if (typeof body.enabled !== "boolean") return jsonError("Invalid request.", 400, "INVALID_REQUEST");
    const { data, error } = await supabaseAdmin.rpc("tgp_set_auto_share", { ...ids, p_enabled: body.enabled });
    if (error) {
      return error.code === "42883" || error.code === "PGRST202"
        ? jsonError("Automatic sharing is not installed yet.", 409, "NOT_INSTALLED")
        : jsonError("Unable to change automatic sharing.", 500, "REQUEST_FAILED");
    }
    if (data !== "OK") return jsonError("Connect the account first.", 409, "NOT_CONNECTED");
    return NextResponse.json({ success: true, autoShare: body.enabled });
  }

  if (body.action === "dismiss_waiting") {
    const { error } = await supabaseAdmin.rpc("tgp_dismiss_unshared", ids);
    if (error) return jsonError("Request failed.", 500, "REQUEST_FAILED");
    return NextResponse.json({ success: true });
  }

  return jsonError("Unknown action.", 400, "INVALID_ACTION");
}
