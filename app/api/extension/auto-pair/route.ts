import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
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
 * Pairing without a code, for a browser that is already signed in to TENH.
 *
 * Typing a code proves two things: that the person holding the browser is the
 * person holding the TENH account, and that they meant to connect this
 * browser. When the request arrives from TENH's own page with that person's
 * session on it, both are already proven -- so asking for a code again is
 * ceremony, and ceremony repeated daily is how people end up not using a
 * feature at all.
 *
 * The rules that matter are unchanged. The token is minted server-side and
 * returned once. It is bound to one member, in one workspace, with the same
 * unique key the code path uses -- so a browser that pairs itself twice is one
 * row, not two. And every later request re-checks membership and subscription,
 * which is what makes "remove somebody from the team" still stop their
 * browser.
 *
 * The one thing this route must never do is answer a cross-site request. It is
 * called by the extension's content script on app.tenhchat.com, which is
 * same-origin; a page on another domain gets nothing, session cookie or not.
 */
function isSameOrigin(request: Request) {
  const site = request.headers.get("sec-fetch-site");

  /* Chrome sets this on every fetch. "same-origin" is TENH's own page; "none"
     is a direct navigation, which cannot carry a JSON body anyway. */
  if (site && site !== "same-origin") return false;

  const origin = request.headers.get("origin");

  if (!origin) return true;

  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { success: false, error: "This request did not come from TENH." },
      { status: 403 },
    );
  }

  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const member = authResult.member;

  let body: {
    browserInstallationId?: unknown;
    deviceName?: unknown;
    extensionVersion?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const installationId = clean(body.browserInstallationId);

  if (!installationId) {
    return NextResponse.json(
      { success: false, error: "This browser did not identify itself." },
      { status: 400 },
    );
  }

  const token = generateDeviceToken();
  const now = new Date().toISOString();

  const { data: device, error } = await supabaseAdmin
    .from("extension_devices")
    .upsert(
      {
        business_id: member.business_id,
        member_id: member.id,
        user_id: member.user_id,
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
      { success: false, error: "Unable to connect this browser." },
      { status: 500 },
    );
  }

  void recordExtensionEvent({
    businessId: member.business_id,
    deviceId: device.id,
    memberId: member.id,
    userId: member.user_id,
    eventType: "extension_connected",
    status: "ok",
    metadata: { deviceName: device.device_name, method: "automatic" },
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
