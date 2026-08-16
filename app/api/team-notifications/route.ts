import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const currentMember = authResult.member;

  const { data, error } = await supabaseAdmin
    .from("team_notifications")
    .select(`
      id,
      notification_type,
      title,
      body,
      link,
      room_id,
      conversation_id,
      contact_id,
      is_read,
      read_at,
      created_at
    `)
    .eq("business_id", currentMember.business_id)
    .eq("recipient_member_id", currentMember.id)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load notifications.",
        details: error.message,
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  return NextResponse.json(
    {
      success: true,
      memberId: currentMember.id,
      businessId: currentMember.business_id,
      notifications: data ?? [],
    },
    {
      headers: NO_STORE_HEADERS,
    },
  );
}

type PatchBody = {
  action?: unknown;
  notificationId?: unknown;
};

export async function PATCH(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      { status: authResult.status },
    );
  }

  let body: PatchBody;

  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const action =
    typeof body.action === "string"
      ? body.action.trim().toLowerCase()
      : "";

  const notificationId =
    typeof body.notificationId === "string"
      ? body.notificationId.trim()
      : "";

  const currentMember = authResult.member;
  const now = new Date().toISOString();

  if (action === "mark_read") {
    if (!notificationId) {
      return NextResponse.json(
        {
          success: false,
          error: "Notification ID is required.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("team_notifications")
      .update({
        is_read: true,
        read_at: now,
      })
      .eq("id", notificationId)
      .eq("business_id", currentMember.business_id)
      .eq("recipient_member_id", currentMember.id)
      .select("id")
      .maybeSingle();

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

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error: "Notification was not found.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  }

  if (action === "mark_all_read") {
    const { error } = await supabaseAdmin
      .from("team_notifications")
      .update({
        is_read: true,
        read_at: now,
      })
      .eq("business_id", currentMember.business_id)
      .eq("recipient_member_id", currentMember.id)
      .eq("is_read", false);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to mark notifications as read.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    {
      success: false,
      error: "Unsupported notification action.",
    },
    { status: 400 },
  );
}
