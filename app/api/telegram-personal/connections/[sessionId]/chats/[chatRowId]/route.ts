import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { featureGate, jsonError, loadSession } from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string; chatRowId: string }> };

/**
 * Stop sharing a chat (holder only). Body: { confirm: "UNSHARE", deleteHistory: boolean }.
 * With deleteHistory the chat and its messages are removed from TENH; Telegram is not touched.
 */
export async function DELETE(request: NextRequest, context: Context) {
  const { sessionId, chatRowId } = await context.params;
  const auth = await getCurrentMember(true);
  if (!auth.success) return jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED");
  const gated = featureGate(auth.member);
  if (gated) return gated;
  const session = await loadSession(auth.member.business_id, sessionId);
  if (!session || session.holder_user_id !== auth.user.id) return jsonError("Not found.", 404, "NOT_FOUND");
  if (!/^[0-9a-f-]{36}$/i.test(chatRowId)) return jsonError("Not found.", 404, "NOT_FOUND");

  let body: { confirm?: unknown; deleteHistory?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  if (body.confirm !== "UNSHARE") return jsonError("Confirm first.", 400, "CONFIRMATION_REQUIRED");

  const { data, error } = await supabaseAdmin.rpc("tgp_unshare_chat", {
    p_chat_row: chatRowId,
    p_business: auth.member.business_id,
    p_user: auth.user.id,
    p_delete_history: body.deleteHistory === true,
  });
  if (error) return jsonError("Request failed.", 500, "REQUEST_FAILED");
  if (data === "NOT_FOUND") return jsonError("Not found.", 404, "NOT_FOUND");
  if (data !== "OK") return jsonError("Only the account holder can stop sharing.", 403, "FORBIDDEN");
  return NextResponse.json({ success: true });
}
