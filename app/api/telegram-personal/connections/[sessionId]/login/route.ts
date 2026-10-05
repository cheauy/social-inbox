import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canUseLogin } from "@/lib/telegram-personal/access";
import { telegramPersonalSealPublicKey } from "@/lib/telegram-personal/feature-flag";
import { sealTelegramPersonalInput, type TelegramPersonalInputKind } from "@/lib/telegram-personal/seal";
import {
  actorFor,
  featureGate,
  jsonError,
  loadSession,
  OPEN_LOGIN_STATUSES,
  qrDataUrl,
} from "@/lib/telegram-personal/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ sessionId: string }> };

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

/**
 * Loads the session for its holder only. Everyone else gets 404 so QR links,
 * hints and even the existence of another owner's sign-in are not revealed.
 */
async function holderSession(sessionId: string, strict: boolean) {
  const auth = await getCurrentMember(strict);
  if (!auth.success) return { response: jsonError(auth.error, auth.status, auth.code ?? "UNAUTHORIZED") };
  const gated = featureGate(auth.member);
  if (gated) return { response: gated };
  const session = await loadSession(auth.member.business_id, sessionId);
  const actor = actorFor(auth.member, auth.user.id);
  if (!session || !canUseLogin(actor, { holderUserId: session.holder_user_id, teamAccess: session.team_access })) {
    return { response: jsonError("Not found.", 404, "NOT_FOUND") };
  }
  return { auth, session };
}

export async function GET(_request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const result = await holderSession(sessionId, false);
  if ("response" in result) return result.response;
  const { session } = result;

  let qr: string | null = null;
  let passwordHint: string | null = null;
  let deadlineAt: string | null = null;
  let loginError: string | null = null;

  if (OPEN_LOGIN_STATUSES.includes(session.status)) {
    const { data } = await supabaseAdmin
      .from("telegram_personal_logins")
      .select("qr_link,password_hint,error_code,deadline_at")
      .eq("session_id", session.id)
      .maybeSingle();
    if (data) {
      deadlineAt = data.deadline_at;
      loginError = data.error_code;
      passwordHint = session.status === "waiting_password" ? data.password_hint : null;
      if (session.status === "waiting_qr" && typeof data.qr_link === "string" && data.qr_link.startsWith("tg://login?token=")) {
        qr = await qrDataUrl(data.qr_link);
      }
    }
  }

  return NextResponse.json(
    {
      success: true,
      status: session.status,
      method: session.login_method,
      qr,
      passwordHint,
      deadlineAt,
      errorCode: loginError ?? session.last_error_code,
      identity: session.status === "connected" ? { displayName: session.display_name, username: session.username, phoneMasked: session.phone_masked } : null,
    },
    { headers: NO_STORE },
  );
}

function validateInput(kind: TelegramPersonalInputKind, value: string) {
  if (kind === "phone") return /^\+?[0-9][0-9 ]{6,19}$/.test(value);
  if (kind === "code") return /^[0-9]{4,8}$/.test(value);
  return value.length >= 1 && value.length <= 256;
}

/** Phone number, login code or 2FA password. Sealed immediately; never logged or echoed. */
export async function POST(request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const result = await holderSession(sessionId, true);
  if ("response" in result) return result.response;
  const { auth, session } = result;

  const publicKey = telegramPersonalSealPublicKey(process.env);
  if (!publicKey) return jsonError("Telegram Personal is not configured on this server yet.", 503, "NOT_CONFIGURED");

  let body: { kind?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400, "INVALID_REQUEST");
  }
  const kind = body.kind === "phone" || body.kind === "code" || body.kind === "password" ? body.kind : null;
  const value = typeof body.value === "string" ? (kind === "password" ? body.value : body.value.trim()) : "";
  if (!kind || !validateInput(kind, value)) return jsonError("Check the value and try again.", 400, "INVALID_INPUT");

  const sealed = sealTelegramPersonalInput(publicKey, session.id, kind, value);
  const { data, error } = await supabaseAdmin.rpc("tgp_submit_login_input", {
    p_session: session.id,
    p_business: auth.member.business_id,
    p_user: auth.user.id,
    p_kind: kind,
    p_sealed: sealed,
  });
  if (error) return jsonError("Telegram Personal request failed.", 500, "REQUEST_FAILED");
  if (data !== true) return jsonError("Telegram is not waiting for this step anymore. Refresh the sign-in.", 409, "LOGIN_STEP_MISMATCH");
  return NextResponse.json({ success: true }, { status: 202, headers: NO_STORE });
}

/** Cancels the holder's open sign-in. Takes effect immediately. */
export async function DELETE(_request: NextRequest, context: Context) {
  const { sessionId } = await context.params;
  const result = await holderSession(sessionId, true);
  if ("response" in result) return result.response;
  const { auth, session } = result;

  const { data, error } = await supabaseAdmin.rpc("tgp_cancel_login", {
    p_session: session.id,
    p_business: auth.member.business_id,
    p_user: auth.user.id,
  });
  if (error) return jsonError("Telegram Personal request failed.", 500, "REQUEST_FAILED");
  return NextResponse.json({ success: true, cancelled: data === true });
}
