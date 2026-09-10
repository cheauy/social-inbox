import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { canManageTeamChat } from "@/lib/team/team-chat-server";
import { authenticateDevice } from "@/lib/extension/device-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* A browser is called online while its last heartbeat is this fresh. */
const ONLINE_WITHIN_MS = 90_000;

/*
 * The browsers paired to this workspace, and what each last reported.
 *
 * Two callers, one route. A signed-in person gets the list for their
 * workspace -- their own browsers, and everybody's if they own or administer
 * it. A paired extension, carrying its device token, gets only its own row,
 * which is how it finds out it has been revoked.
 */
export async function GET(request: Request) {
  if (request.headers.get("authorization")) {
    const auth = await authenticateDevice(request);

    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: auth.error, paired: false },
        { status: auth.status },
      );
    }

    return NextResponse.json({
      success: true,
      paired: true,
      device: {
        id: auth.device.id,
        name: auth.device.device_name,
      },
    });
  }

  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const member = authResult.member;
  const admin = canManageTeamChat(member.role);

  let query = supabaseAdmin
    .from("extension_devices")
    .select(
      `
      id,
      member_id,
      device_name,
      extension_version,
      status,
      facebook_connected,
      current_page_id,
      current_page_name,
      current_url,
      composer_state,
      paired_at,
      last_seen_at,
      member:team_members!extension_devices_member_id_fkey (
        id,
        full_name,
        email
      )
    `,
    )
    .eq("business_id", member.business_id)
    .eq("status", "active")
    .order("last_seen_at", { ascending: false, nullsFirst: false });

  if (!admin) {
    query = query.eq("member_id", member.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to load paired browsers." },
      { status: 500 },
    );
  }

  const now = Date.now();

  const devices = (data ?? []).map((row) => {
    const owner = Array.isArray(row.member) ? row.member[0] : row.member;
    const lastSeen = row.last_seen_at
      ? new Date(row.last_seen_at).getTime()
      : 0;

    return {
      id: row.id,
      name: row.device_name,
      version: row.extension_version,
      isMine: row.member_id === member.id,
      memberName: owner?.full_name ?? owner?.email ?? "Team member",
      online: lastSeen > 0 && now - lastSeen < ONLINE_WITHIN_MS,
      facebookConnected: row.facebook_connected === true,
      pageId: row.current_page_id,
      pageName: row.current_page_name,
      url: row.current_url,
      composerState: row.composer_state ?? "unknown",
      pairedAt: row.paired_at,
      lastSeenAt: row.last_seen_at,
    };
  });

  return NextResponse.json({
    success: true,
    canManageOthers: admin,
    devices,
  });
}
