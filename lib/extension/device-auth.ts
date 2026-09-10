import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { businessSubscriptionIsOperational } from "@/lib/subscription/is-operational-subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * The credential a paired browser carries, and how far it gets.
 *
 * A TENH Companion device is not a user. It cannot read conversations, send
 * messages, or change anything: it can say that it is alive, say what the
 * Facebook tab in front of it looks like, and be revoked. Everything it
 * reports is stored as an observation for a person to read.
 *
 * The token is random, stored only as a hash, and checked against the member
 * row on every request -- so an agent who is removed from a workspace, or
 * whose membership is deactivated, loses the browser at the next call rather
 * than at the next deploy. The workspace's subscription is checked with it,
 * for the same reason the Inbox checks it: an expired workspace stops
 * everywhere, not everywhere except the browser somebody left open.
 */

export const PAIR_CODE_TTL_MS = 5 * 60_000;

/* Long enough that guessing is pointless, short enough to type if it ever has
   to be. Digits and uppercase letters that cannot be confused for each other. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePairCode() {
  const bytes = randomBytes(10);
  let code = "";

  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }

  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function generateDeviceToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

/** Constant-time compare, so a wrong token cannot be found one letter at a time. */
export function secretsMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
}

export type ExtensionDevice = {
  id: string;
  business_id: string;
  member_id: string;
  user_id: string;
  device_name: string;
  extension_version: string | null;
  status: string;
};

/* The member behind the browser, so a route can apply the same permission
   checks the website applies to that person. */
export type ExtensionDeviceMember = {
  id: string;
  role: string;
  full_name: string | null;
};

type DeviceAuthResult =
  | {
      success: true;
      device: ExtensionDevice;
      member: ExtensionDeviceMember;
    }
  | { success: false; status: number; error: string };

/**
 * Resolve the device behind an Authorization header, or say why not.
 *
 * Three things have to hold, every time: the token matches a device, the
 * device has not been revoked, and the member it belongs to is still an active
 * member of that workspace. The third is the one that matters -- it is what
 * makes "remove somebody from the team" also mean "their browser stops".
 */
export async function authenticateDevice(
  request: Request,
): Promise<DeviceAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    return { success: false, status: 401, error: "A device token is required." };
  }

  const { data: device, error } = await supabaseAdmin
    .from("extension_devices")
    .select(
      "id,business_id,member_id,user_id,device_name,extension_version,status",
    )
    .eq("token_hash", hashSecret(token))
    .maybeSingle();

  if (error) {
    return {
      success: false,
      status: 500,
      error: "Unable to verify this browser.",
    };
  }

  if (!device || device.status !== "active") {
    return {
      success: false,
      status: 401,
      error: "This browser is no longer paired with TENH.",
    };
  }

  const { data: member } = await supabaseAdmin
    .from("team_members")
    .select("id,is_active,role,full_name")
    .eq("id", device.member_id)
    .eq("business_id", device.business_id)
    .maybeSingle();

  if (!member || member.is_active === false) {
    /*
     * The person is gone from this workspace, so the browser goes with them.
     * Revoked rather than merely refused: a member who is re-invited later
     * should pair again deliberately, not have an old browser wake up.
     */
    await supabaseAdmin
      .from("extension_devices")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", device.id);

    return {
      success: false,
      status: 403,
      error: "This browser's TENH access has been withdrawn.",
    };
  }

  if (!(await businessSubscriptionIsOperational(device.business_id))) {
    /*
     * Not revoked. An expired subscription is a bill, not a betrayal: the
     * browser stays paired and starts working again the moment the workspace
     * does.
     */
    return {
      success: false,
      status: 409,
      error: "This TENH subscription is not active.",
    };
  }

  return {
    success: true,
    device: device as ExtensionDevice,
    member: {
      id: member.id as string,
      role: (member.role as string | null) ?? "member",
      full_name: (member.full_name as string | null) ?? null,
    },
  };
}

/** Write one observation. Never allowed to fail a request. */
export async function recordExtensionEvent(entry: {
  businessId: string;
  deviceId?: string | null;
  memberId?: string | null;
  userId?: string | null;
  socialAccountId?: string | null;
  conversationId?: string | null;
  eventType: string;
  status?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await supabaseAdmin.from("extension_events").insert({
      business_id: entry.businessId,
      device_id: entry.deviceId ?? null,
      member_id: entry.memberId ?? null,
      user_id: entry.userId ?? null,
      social_account_id: entry.socialAccountId ?? null,
      conversation_id: entry.conversationId ?? null,
      event_type: entry.eventType,
      status: entry.status ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    console.error(
      "[TENH Companion] Unable to record an extension event:",
      error instanceof Error ? error.message : error,
    );
  }
}
