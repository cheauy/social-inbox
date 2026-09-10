import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { canManageTeamChat } from "@/lib/team/team-chat-server";
import {
  authenticateDevice,
  recordExtensionEvent,
} from "@/lib/extension/device-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Revoking a browser, from either end.
 *
 * A person can always unpair their own browser -- with a session from TENH, or
 * from the extension itself with its own token, which is what "Disconnect" in
 * the popup does when somebody is handing the laptop back.
 *
 * An owner or admin can revoke anybody's, because a laptop that has left the
 * building is exactly the case this has to cover, and the person holding it is
 * not going to press the button.
 */
export async function POST(request: Request) {
  let body: { deviceId?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const now = new Date().toISOString();
  const revoke = async (id: string, businessId: string, actor: {
    memberId: string | null;
    userId: string | null;
  }) => {
    await supabaseAdmin
      .from("extension_devices")
      .update({ status: "revoked", revoked_at: now, updated_at: now })
      .eq("id", id)
      .eq("business_id", businessId);

    void recordExtensionEvent({
      businessId,
      deviceId: id,
      memberId: actor.memberId,
      userId: actor.userId,
      eventType: "extension_disconnected",
      status: "ok",
    });
  };

  /* The extension unpairing itself: its own token, its own row, nothing else. */
  if (request.headers.get("authorization")) {
    const auth = await authenticateDevice(request);

    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: auth.status },
      );
    }

    await revoke(auth.device.id, auth.device.business_id, {
      memberId: auth.device.member_id,
      userId: auth.device.user_id,
    });

    return NextResponse.json({ success: true });
  }

  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const member = authResult.member;
  const deviceId =
    typeof body.deviceId === "string" ? body.deviceId.trim() : "";

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "Choose a browser to disconnect." },
      { status: 400 },
    );
  }

  const { data: device } = await supabaseAdmin
    .from("extension_devices")
    .select("id,business_id,member_id")
    .eq("id", deviceId)
    .eq("business_id", member.business_id)
    .maybeSingle();

  if (!device) {
    return NextResponse.json(
      { success: false, error: "That browser is not paired with this workspace." },
      { status: 404 },
    );
  }

  if (device.member_id !== member.id && !canManageTeamChat(member.role)) {
    return NextResponse.json(
      {
        success: false,
        error: "Only an owner or admin can disconnect somebody else's browser.",
      },
      { status: 403 },
    );
  }

  await revoke(device.id, member.business_id, {
    memberId: member.id,
    userId: member.user_id,
  });

  return NextResponse.json({ success: true });
}
