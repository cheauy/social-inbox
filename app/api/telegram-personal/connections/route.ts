import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission, permissionDenied } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canStartPersonalLogin } from "@/lib/telegram-personal/access";
import { telegramPersonalSealPublicKey } from "@/lib/telegram-personal/feature-flag";
import {
  actorFor,
  featureGate,
  jsonError,
  loadVisibleSessions,
  mapTgpCode,
  OPEN_LOGIN_STATUSES,
  tgpCodeFromError,
  toPublicConnection,
} from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getCurrentMember();
  if (!auth.success) return jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED");
  const gated = featureGate(auth.member);
  if (gated) return gated;

  try {
    const actor = actorFor(auth.member, auth.user.id);
    const rows = await loadVisibleSessions(auth.member.business_id);
    return NextResponse.json({
      success: true,
      enabled: true,
      configured: telegramPersonalSealPublicKey(process.env) !== null,
      canConnect: canStartPersonalLogin(actor),
      connections: rows.map((row) => toPublicConnection(row, actor)),
    });
  } catch (error) {
    console.error("[TENH Telegram Personal] Unable to load connections:", error instanceof Error ? error.message : "unknown");
    return jsonError("Unable to load Telegram Personal connections.", 500, "LOAD_FAILED");
  }
}

/** Starts a self-service sign-in for the calling Owner's own Telegram account. */
export async function POST(request: NextRequest) {
  const auth = await getCurrentMember(true);
  if (!auth.success) return jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED");
  const gated = featureGate(auth.member);
  if (gated) return gated;

  const actor = actorFor(auth.member, auth.user.id);
  if (!canStartPersonalLogin(actor) || !(await memberHasPermission(auth.member, "channels", "manage"))) {
    return permissionDenied("Only a workspace Owner can connect a Telegram Personal account.");
  }
  if (!telegramPersonalSealPublicKey(process.env)) {
    return jsonError("Telegram Personal is not configured on this server yet.", 503, "NOT_CONFIGURED");
  }

  let body: { method?: unknown; acceptDisclosure?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400, "INVALID_REQUEST");
  }
  const method = body.method === "phone" ? "phone" : body.method === "qr" ? "qr" : null;
  if (!method) return jsonError("Choose QR code or phone number sign-in.", 400, "INVALID_METHOD");
  if (body.acceptDisclosure !== true) {
    return jsonError("Review and accept how TENH uses your Telegram account first.", 400, "DISCLOSURE_REQUIRED");
  }

  const { data, error } = await supabaseAdmin.rpc("tgp_begin_login", {
    p_business: auth.member.business_id,
    p_user: auth.user.id,
    p_member: auth.member.id,
    p_method: method,
  });

  if (error) {
    const code = tgpCodeFromError(error.message);
    if (code === "LOGIN_ALREADY_OPEN") {
      // Resume the caller's own open sign-in instead of creating a second one.
      const { data: open } = await supabaseAdmin
        .from("telegram_personal_sessions")
        .select("id")
        .eq("business_id", auth.member.business_id)
        .eq("holder_user_id", auth.user.id)
        .in("status", OPEN_LOGIN_STATUSES)
        .limit(1)
        .maybeSingle();
      if (open?.id) return NextResponse.json({ success: true, sessionId: open.id, resumed: true });
    }
    if (code === "REQUEST_FAILED") {
      console.error("[TENH Telegram Personal] begin_login failed:", error.code ?? "unknown");
    }
    return mapTgpCode(code);
  }

  return NextResponse.json({ success: true, sessionId: data as string, resumed: false }, { status: 201 });
}
