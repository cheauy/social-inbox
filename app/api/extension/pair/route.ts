import { NextResponse } from "next/server";

import {
  generateDeviceToken,
  hashSecret,
  recordExtensionEvent,
} from "@/lib/extension/device-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 120;

function clean(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_TEXT)
    : fallback;
}

/*
 * The exchange: a five-minute code becomes a browser that TENH knows.
 *
 * Deliberately unauthenticated in the TENH sense -- the extension has no
 * session and is never given one. The code is the whole proof, it is single
 * use, and what comes back is a token that can do three things: say hello,
 * report what a Facebook tab looks like, and be revoked.
 *
 * Pairing the same browser twice replaces its token rather than adding a
 * second row, so re-pairing after a reinstall leaves one device in the list,
 * not a graveyard.
 */
export async function POST(request: Request) {
  let body: {
    code?: unknown;
    deviceName?: unknown;
    browserInstallationId?: unknown;
    extensionVersion?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  const code = clean(body.code).toUpperCase();
  const installationId = clean(body.browserInstallationId);

  if (!code || !installationId) {
    return NextResponse.json(
      { success: false, error: "A pairing code is required." },
      { status: 400 },
    );
  }

  const { data: pairing } = await supabaseAdmin
    .from("extension_pair_codes")
    .select("id,business_id,member_id,user_id,expires_at,used_at")
    .eq("code_hash", hashSecret(code))
    .maybeSingle();

  if (!pairing || pairing.used_at) {
    return NextResponse.json(
      { success: false, error: "That pairing code is not valid." },
      { status: 400 },
    );
  }

  if (new Date(pairing.expires_at).getTime() <= Date.now()) {
    return NextResponse.json(
      {
        success: false,
        error: "That pairing code has expired. Start again in TENH.",
      },
      { status: 400 },
    );
  }

  /* The member has to still be here. A code minted an hour before somebody
     was removed must not outlive their membership. */
  const { data: member } = await supabaseAdmin
    .from("team_members")
    .select("id,is_active,full_name")
    .eq("id", pairing.member_id)
    .eq("business_id", pairing.business_id)
    .maybeSingle();

  if (!member || member.is_active === false) {
    return NextResponse.json(
      { success: false, error: "That TENH account is no longer active here." },
      { status: 403 },
    );
  }

  const token = generateDeviceToken();
  const now = new Date().toISOString();

  const { data: device, error } = await supabaseAdmin
    .from("extension_devices")
    .upsert(
      {
        business_id: pairing.business_id,
        member_id: pairing.member_id,
        user_id: pairing.user_id,
        device_name: clean(body.deviceName, "Chrome browser"),
        browser_installation_id: installationId,
        extension_version: clean(body.extensionVersion) || null,
        token_hash: hashSecret(token),
        status: "active",
        paired_at: now,
        last_seen_at: now,
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: "business_id,member_id,browser_installation_id" },
    )
    .select("id,device_name")
    .single();

  if (error || !device) {
    return NextResponse.json(
      { success: false, error: "Unable to pair this browser." },
      { status: 500 },
    );
  }

  await supabaseAdmin
    .from("extension_pair_codes")
    .update({ used_at: now })
    .eq("id", pairing.id);

  void recordExtensionEvent({
    businessId: pairing.business_id,
    deviceId: device.id,
    memberId: pairing.member_id,
    userId: pairing.user_id,
    eventType: "extension_connected",
    status: "ok",
    metadata: { deviceName: device.device_name },
  });

  return NextResponse.json({
    success: true,
    /* Shown to the extension once. TENH keeps only the hash. */
    token,
    device: {
      id: device.id,
      name: device.device_name,
      memberName: member.full_name,
    },
  });
}
