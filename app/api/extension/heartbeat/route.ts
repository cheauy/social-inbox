import { NextResponse } from "next/server";

import {
  authenticateDevice,
  recordExtensionEvent,
} from "@/lib/extension/device-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT = 300;

function clean(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_TEXT)
    : null;
}

/*
 * What a paired browser is looking at, as it sees it.
 *
 * Everything here is an observation, and the wording in TENH says so: a
 * composer this reports as available is a composer the extension found in a
 * Facebook tab a moment ago, not a promise that a message will send. Nothing
 * in the Inbox, the send routes or the webhooks reads any of it.
 *
 * The URL is stored with its query string removed. A Facebook URL can carry
 * ids and referral parameters, and none of that is needed to say "this browser
 * is on Business Suite".
 */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request);

  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: {
    facebookConnected?: unknown;
    pageId?: unknown;
    pageName?: unknown;
    url?: unknown;
    composerState?: unknown;
    extensionVersion?: unknown;
    event?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const device = auth.device;
  const now = new Date().toISOString();

  const rawUrl = clean(body.url);
  let url: string | null = null;

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      url = `${parsed.origin}${parsed.pathname}`;
    } catch {
      url = null;
    }
  }

  const composerState = clean(body.composerState);

  const { error } = await supabaseAdmin
    .from("extension_devices")
    .update({
      last_seen_at: now,
      updated_at: now,
      facebook_connected: body.facebookConnected === true,
      current_page_id: clean(body.pageId),
      current_page_name: clean(body.pageName),
      current_url: url,
      composer_state:
        composerState === "available" ||
        composerState === "unavailable" ||
        composerState === "unknown"
          ? composerState
          : "unknown",
      extension_version: clean(body.extensionVersion) ?? device.extension_version,
    })
    .eq("id", device.id);

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to record this heartbeat." },
      { status: 500 },
    );
  }

  /*
   * Only a named change is written to the log. A heartbeat every half minute
   * is not an event; "this browser lost Facebook" is.
   */
  const event = clean(body.event);

  if (event) {
    void recordExtensionEvent({
      businessId: device.business_id,
      deviceId: device.id,
      memberId: device.member_id,
      userId: device.user_id,
      eventType: event,
      status: "ok",
      metadata: {
        pageId: clean(body.pageId),
        composerState,
      },
    });
  }

  return NextResponse.json({ success: true, acknowledgedAt: now });
}
