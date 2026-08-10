import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const requestedLimit = Number(
    request.nextUrl.searchParams.get("limit") ?? "20",
  );
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 50)
    : 20;

  const currentMember = authResult.member;

  const [{ data, error }, { count, error: countError }] =
    await Promise.all([
      supabaseAdmin
        .from("team_notifications")
        .select(`
          id,
          business_id,
          recipient_member_id,
          actor_member_id,
          notification_type,
          title,
          body,
          link,
          room_id,
          conversation_id,
          contact_id,
          is_read,
          read_at,
          created_at,
          actor:team_members!team_notifications_actor_member_id_fkey (
            id,
            full_name,
            profile_picture_url
          )
        `)
        .eq("business_id", currentMember.business_id)
        .eq("recipient_member_id", currentMember.id)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("team_notifications")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("business_id", currentMember.business_id)
        .eq("recipient_member_id", currentMember.id)
        .eq("is_read", false),
    ]);

  if (error || countError) {
    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ??
          countError?.message ??
          "Unable to load team notifications.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    notifications: data ?? [],
    unreadCount: count ?? 0,
    currentMemberId: currentMember.id,
    businessId: currentMember.business_id,
  });
}

export async function PATCH(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  let body: {
    notificationId?: string;
    markAllRead?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const currentMember = authResult.member;
  const now = new Date().toISOString();

  let query = supabaseAdmin
    .from("team_notifications")
    .update({
      is_read: true,
      read_at: now,
    })
    .eq("business_id", currentMember.business_id)
    .eq("recipient_member_id", currentMember.id);

  if (!body.markAllRead) {
    const notificationId = body.notificationId?.trim();

    if (!notificationId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "notificationId is required unless markAllRead is true.",
        },
        { status: 400 },
      );
    }

    query = query.eq("id", notificationId);
  } else {
    query = query.eq("is_read", false);
  }

  const { error } = await query;

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to mark notification as read.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
