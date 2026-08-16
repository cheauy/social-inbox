import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  const now = new Date().toISOString();

  const { data: activeRows, error: announcementError } =
    await supabaseAdmin
      .from("tenh_system_announcements")
      .select(`
        id,
        title,
        message,
        tone,
        link_label,
        link_url,
        starts_at,
        ends_at,
        created_at
      `)
      .eq("is_active", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("created_at", { ascending: false })
      .limit(20);

  if (announcementError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load TENH update alerts.",
        details: announcementError.message,
      },
      { status: 500 },
    );
  }

  const announcementIds = (activeRows ?? []).map((row) => row.id);

  if (announcementIds.length === 0) {
    return NextResponse.json({
      success: true,
      announcement: null,
    });
  }

  const { data: dismissedRows, error: dismissedError } =
    await supabaseAdmin
      .from("tenh_system_announcement_dismissals")
      .select("announcement_id")
      .eq("user_id", authResult.user.id)
      .in("announcement_id", announcementIds);

  if (dismissedError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to check update-alert status.",
        details: dismissedError.message,
      },
      { status: 500 },
    );
  }

  const dismissedIds = new Set(
    (dismissedRows ?? []).map((row) => row.announcement_id),
  );

  const announcement =
    (activeRows ?? []).find((row) => !dismissedIds.has(row.id)) ?? null;

  return NextResponse.json({
    success: true,
    announcement,
  });
}

export async function POST(request: Request) {
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

  let body: {
    action?: unknown;
    announcementId?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
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
  const announcementId =
    typeof body.announcementId === "string"
      ? body.announcementId.trim()
      : "";

  if (action !== "dismiss" || !announcementId) {
    return NextResponse.json(
      {
        success: false,
        error: "A valid dismiss request is required.",
      },
      { status: 400 },
    );
  }

  const { data: announcement, error: announcementError } =
    await supabaseAdmin
      .from("tenh_system_announcements")
      .select("id")
      .eq("id", announcementId)
      .maybeSingle();

  if (announcementError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify this update alert.",
        details: announcementError.message,
      },
      { status: 500 },
    );
  }

  if (!announcement) {
    return NextResponse.json(
      {
        success: false,
        error: "Update alert was not found.",
      },
      { status: 404 },
    );
  }

  const { error } = await supabaseAdmin
    .from("tenh_system_announcement_dismissals")
    .upsert(
      {
        announcement_id: announcementId,
        user_id: authResult.user.id,
        dismissed_at: new Date().toISOString(),
      },
      {
        onConflict: "announcement_id,user_id",
      },
    );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to dismiss this update alert.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
