import "server-only";

import { NextResponse } from "next/server";
import QRCode from "qrcode";

import type { AuthenticatedMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canDisconnect,
  canPause,
  canResume,
  canSeeIdentityDetails,
  canSetTeamAccess,
  canUseLogin,
  type PersonalActor,
  type PersonalTeamAccess,
} from "@/lib/telegram-personal/access";
import { isTelegramPersonalEnabled } from "@/lib/telegram-personal/feature-flag";

export const OPEN_LOGIN_STATUSES = ["connecting", "waiting_phone", "waiting_qr", "waiting_code", "waiting_password"];

// Never select db_key_wrapped, lease fields or telegram_user_id for the browser.
export const SESSION_PUBLIC_SELECT =
  "id,business_id,social_account_id,holder_user_id,login_method,status,team_access,display_name,username,phone_masked,last_error_code,connected_at,ended_at,created_at,updated_at";

export type PersonalSessionRow = {
  id: string;
  business_id: string;
  social_account_id: string | null;
  holder_user_id: string;
  login_method: "qr" | "phone";
  status: string;
  team_access: PersonalTeamAccess;
  display_name: string | null;
  username: string | null;
  phone_masked: string | null;
  last_error_code: string | null;
  connected_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export function jsonError(error: string, status: number, code: string) {
  return NextResponse.json({ success: false, error, code }, { status });
}

/** 404 rather than 403 so a disabled feature does not reveal itself. */
export function featureGate(member: AuthenticatedMember) {
  return isTelegramPersonalEnabled(process.env, member.business_id)
    ? null
    : jsonError("Not found.", 404, "NOT_FOUND");
}

export function actorFor(member: AuthenticatedMember, userId: string): PersonalActor {
  return { userId, memberId: member.id, role: member.role };
}

export function toPublicConnection(row: PersonalSessionRow, actor: PersonalActor) {
  const ref = { holderUserId: row.holder_user_id, teamAccess: row.team_access };
  const details = canSeeIdentityDetails(actor, ref);
  return {
    id: row.id,
    kind: "telegram_personal" as const,
    status: row.status,
    loginMethod: row.login_method,
    displayName: row.display_name,
    username: details ? row.username : null,
    phoneMasked: details ? row.phone_masked : null,
    teamAccess: row.team_access,
    lastErrorCode: row.last_error_code,
    connectedAt: row.connected_at,
    endedAt: row.ended_at,
    isHolder: actor.userId === row.holder_user_id,
    can: {
      useLogin: canUseLogin(actor, ref) && OPEN_LOGIN_STATUSES.includes(row.status),
      pause: canPause(actor, ref) && (row.status === "connected" || row.status === "reconnecting"),
      resume: canResume(actor, ref) && row.status === "paused",
      disconnect: canDisconnect(actor, ref) && ["connected", "reconnecting", "pausing", "paused"].includes(row.status),
      setTeamAccess: canSetTeamAccess(actor, ref),
      // D1: the holder chooses shared chats while connected; holder or any owner may remove imported data.
      manageChats: actor.userId === row.holder_user_id && (row.status === "connected" || row.status === "reconnecting"),
      removeData: Boolean(row.social_account_id) && canDisconnect(actor, ref),
    },
  };
}

const TERMINAL_STATUSES = ["cancelled", "expired", "failed", "revoked", "disconnected"];

/**
 * Ended sessions stay visible for 24h so the owner can see what happened
 * (expired, ended in Telegram...), but only until a newer session exists for
 * the same Telegram account, or for the same holder when the ended attempt
 * never reached an identity. Rows must be ordered newest first.
 */
export function selectVisibleSessions<T extends { holder_user_id: string; status: string; telegram_user_id?: string | null }>(rows: T[]) {
  const seenAccounts = new Set<string>();
  const seenHolders = new Set<string>();
  const visible: T[] = [];
  for (const row of rows) {
    const ended = TERMINAL_STATUSES.includes(row.status);
    const account = row.telegram_user_id ?? null;
    const superseded = ended && (account ? seenAccounts.has(account) : seenHolders.has(row.holder_user_id));
    if (!superseded) visible.push(row);
    if (account) seenAccounts.add(account);
    seenHolders.add(row.holder_user_id);
  }
  return visible;
}

export async function loadVisibleSessions(businessId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("telegram_personal_sessions")
    // telegram_user_id is read only to group sessions; toPublicConnection never returns it.
    .select(`${SESSION_PUBLIC_SELECT},telegram_user_id`)
    .eq("business_id", businessId)
    .or(`ended_at.is.null,ended_at.gt.${since}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return selectVisibleSessions((data ?? []) as unknown as Array<PersonalSessionRow & { telegram_user_id: string | null }>);
}

export async function loadSession(businessId: string, sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const { data, error } = await supabaseAdmin
    .from("telegram_personal_sessions")
    .select(SESSION_PUBLIC_SELECT)
    .eq("id", sessionId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as PersonalSessionRow | null;
}

export async function qrDataUrl(link: string) {
  return QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 280 });
}

/** Maps tgp_* errors/results to HTTP responses. Codes only; no database text leaks. */
export function mapTgpCode(code: string) {
  switch (code) {
    case "NOT_OWNER":
      return jsonError("Only a workspace Owner can connect a Telegram Personal account.", 403, "NOT_OWNER");
    case "FORBIDDEN":
      return jsonError("You do not have permission for this Telegram Personal account.", 403, "FORBIDDEN");
    case "NOT_FOUND":
      return jsonError("Telegram Personal connection not found.", 404, "NOT_FOUND");
    case "LOGIN_ALREADY_OPEN":
      return jsonError("You already have a Telegram sign-in in progress.", 409, "LOGIN_ALREADY_OPEN");
    case "TOO_MANY_LOGINS":
      return jsonError("Too many Telegram sign-ins are in progress in this workspace. Finish or cancel one first.", 429, "TOO_MANY_LOGINS");
    case "CHANNEL_LIMIT_REACHED":
      return jsonError("Channel limit reached. Disable another channel or upgrade the plan.", 409, "CHANNEL_LIMIT_REACHED");
    case "SUBSCRIPTION_LOCKED":
      return jsonError("This TENH subscription is expired or inactive.", 409, "SUBSCRIPTION_LOCKED");
    case "INVALID_STATE":
      return jsonError("This action is not available in the connection's current state.", 409, "INVALID_STATE");
    case "TRIAL_NOT_ALLOWED":
      return jsonError("This channel cannot be activated on this workspace's free trial.", 409, "TRIAL_NOT_ALLOWED");
    case "CHANNEL_ACTIVATION_REFUSED":
      return jsonError("This workspace's channel rules did not allow activating the account.", 409, "CHANNEL_ACTIVATION_REFUSED");
    case "INVALID_MEMBER":
      return jsonError("Choose active members of this workspace.", 400, "INVALID_MEMBER");
    default:
      return jsonError("Telegram Personal request failed.", 500, "REQUEST_FAILED");
  }
}

export function tgpCodeFromError(message: string | undefined) {
  const match = /TGP_([A-Z_]+)/.exec(message ?? "");
  return match ? match[1] : "REQUEST_FAILED";
}
