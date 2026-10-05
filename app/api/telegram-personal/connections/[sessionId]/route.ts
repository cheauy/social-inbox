import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PersonalTeamAccess } from "@/lib/telegram-personal/access";
import { actorFor, featureGate, jsonError, loadSession, mapTgpCode, toPublicConnection } from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

const TEAM_ACCESS: PersonalTeamAccess[] = ["holder_only", "owners", "all_inbox_members", "selected_members"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(sessionId: string) {
  const auth = await getCurrentMember(true);
  if (!auth.success) return { response: jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED") };
  const gated = featureGate(auth.member);
  if (gated) return { response: gated };
  const session = await loadSession(auth.member.business_id, sessionId);
  if (!session) return { response: jsonError("Telegram Personal connection not found.", 404, "NOT_FOUND") };
  return { auth, session };
}

async function requestAction(
  input: { sessionId: string; businessId: string; userId: string; memberId: string },
  kind: "pause" | "resume" | "logout",
  clientRequestId: unknown,
) {
  const { data, error } = await supabaseAdmin.rpc("tgp_request_action", {
    p_session: input.sessionId,
    p_business: input.businessId,
    p_user: input.userId,
    p_member: input.memberId,
    p_kind: kind,
    p_client_request_id: typeof clientRequestId === "string" && UUID.test(clientRequestId) ? clientRequestId : randomUUID(),
  });
  if (error) return mapTgpCode("REQUEST_FAILED");
  const code = String(data);
  if (code === "OK" || code === "DUPLICATE") return null;
  return mapTgpCode(code);
}

/** Pause, resume, remove imported data, or change who on the team may see this account's shared chats. */
export async function PATCH(request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const loaded = await load(sessionId);
  if ("response" in loaded) return loaded.response;
  const { auth, session } = loaded;

  let body: { action?: unknown; clientRequestId?: unknown; mode?: unknown; memberIds?: unknown; confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400, "INVALID_REQUEST");
  }
  const ids = { sessionId: session.id, businessId: auth.member.business_id, userId: auth.user.id, memberId: auth.member.id };

  if (body.action === "pause" || body.action === "resume") {
    const failure = await requestAction(ids, body.action, body.clientRequestId);
    if (failure) return failure;
  } else if (body.action === "remove_data") {
    // Deletes every chat and message this account imported into TENH. Telegram is not touched.
    if ((body as { confirm?: unknown }).confirm !== "REMOVE_DATA") return jsonError("Confirm first.", 400, "CONFIRMATION_REQUIRED");
    const { data, error } = await supabaseAdmin.rpc("tgp_remove_imported_data", {
      p_session: session.id,
      p_business: auth.member.business_id,
      p_user: auth.user.id,
    });
    if (error) return mapTgpCode("REQUEST_FAILED");
    if (data !== "OK") return mapTgpCode(String(data));
  } else if (body.action === "team_access") {
    const mode = TEAM_ACCESS.find((value) => value === body.mode);
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [];
    if (!mode) return jsonError("Choose who can see this account.", 400, "INVALID_MODE");
    const { data, error } = await supabaseAdmin.rpc("tgp_set_team_access", {
      p_session: session.id,
      p_business: auth.member.business_id,
      p_user: auth.user.id,
      p_mode: mode,
      p_member_ids: mode === "selected_members" ? memberIds : null,
    });
    if (error) return mapTgpCode("REQUEST_FAILED");
    if (data !== "OK") return mapTgpCode(String(data));
  } else {
    return jsonError("Unknown action.", 400, "INVALID_ACTION");
  }

  const updated = await loadSession(auth.member.business_id, session.id);
  return NextResponse.json({ success: true, connection: updated ? toPublicConnection(updated, actorFor(auth.member, auth.user.id)) : null });
}

/**
 * Disconnect = sign out at Telegram (revokes this device) and remove TENH's
 * local session data. TENH conversation history is kept. Requires an explicit
 * confirmation value from the confirmation dialog.
 */
export async function DELETE(request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const loaded = await load(sessionId);
  if ("response" in loaded) return loaded.response;
  const { auth, session } = loaded;

  let body: { confirm?: unknown; clientRequestId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* handled below */
  }
  if (body.confirm !== "SIGN_OUT") return jsonError("Confirm the sign-out first.", 400, "CONFIRMATION_REQUIRED");

  const failure = await requestAction(
    { sessionId: session.id, businessId: auth.member.business_id, userId: auth.user.id, memberId: auth.member.id },
    "logout",
    body.clientRequestId,
  );
  if (failure) return failure;
  return NextResponse.json({ success: true, status: "disconnect_pending" }, { status: 202 });
}
