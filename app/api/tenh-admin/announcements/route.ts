import { NextResponse } from "next/server";

import {
  getTenhAdminMutationUser,
  getTenhAdminUser,
} from "@/lib/admin/tenh-admin-auth";
import { logTenhAdminAction } from "@/lib/admin/log-tenh-admin-action";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_TONES = new Set([
  "info",
  "update",
  "maintenance",
  "important",
]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(
  body: unknown,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

function normalizeLinkUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return trimmed.slice(0, 500);
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export async function GET() {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return noStoreJson(
      { success: false, error: admin.error },
      { status: admin.status },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("tenh_system_announcements")
    .select(`
      id,
      title,
      message,
      tone,
      link_label,
      link_url,
      is_active,
      starts_at,
      ends_at,
      created_by_email,
      created_at,
      updated_at
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load update alerts.",
        details: error.message,
        hint:
          "Run supabase/09-v3-8-8-2-system-announcements.sql first.",
      },
      { status: 500 },
    );
  }

  return noStoreJson({
    success: true,
    announcements: data ?? [],
  });
}

export async function POST(request: Request) {
  const admin = await getTenhAdminMutationUser(request);

  if (!admin.success) {
    return noStoreJson(
      { success: false, error: admin.error },
      { status: admin.status },
    );
  }

  let body: {
    action?: unknown;
    announcementId?: unknown;
    title?: unknown;
    message?: unknown;
    tone?: unknown;
    linkLabel?: unknown;
    linkUrl?: unknown;
    endsAt?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return noStoreJson(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const action = clean(body.action).toLowerCase();

  if (action === "end") {
    const announcementId = clean(body.announcementId);

    if (!announcementId) {
      return noStoreJson(
        {
          success: false,
          error: "announcementId is required.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("tenh_system_announcements")
      .update({
        is_active: false,
      })
      .eq("id", announcementId)
      .select("id,is_active,title")
      .maybeSingle();

    if (error) {
      return noStoreJson(
        {
          success: false,
          error: "Unable to end this alert.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    if (!data) {
      return noStoreJson(
        {
          success: false,
          error: "Alert was not found.",
        },
        { status: 404 },
      );
    }

    await logTenhAdminAction({
      user: admin.user,
      action: "announcement_ended",
      resourceType: "system_announcement",
      resourceId: announcementId,
      metadata: {
        title: data.title,
      },
    });

    return noStoreJson({
      success: true,
      announcement: {
        id: data.id,
        is_active: data.is_active,
      },
    });
  }

  if (action !== "create") {
    return noStoreJson(
      {
        success: false,
        error: "Unsupported announcement action.",
      },
      { status: 400 },
    );
  }

  const title = clean(body.title).slice(0, 120);
  const message = clean(body.message).slice(0, 1500);
  const requestedTone = clean(body.tone).toLowerCase();
  const tone = VALID_TONES.has(requestedTone)
    ? requestedTone
    : "update";
  const linkLabel = clean(body.linkLabel).slice(0, 40);
  const rawLinkUrl = clean(body.linkUrl);
  const linkUrl = normalizeLinkUrl(rawLinkUrl);
  const rawEndsAt = clean(body.endsAt);

  if (!title || !message) {
    return noStoreJson(
      {
        success: false,
        error: "Title and message are required.",
      },
      { status: 400 },
    );
  }

  if (rawLinkUrl && !linkUrl) {
    return noStoreJson(
      {
        success: false,
        error: "Enter a valid relative, http://, or https:// link.",
      },
      { status: 400 },
    );
  }

  let endsAt: string | null = null;

  if (rawEndsAt) {
    const parsed = new Date(rawEndsAt);

    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.getTime() <= Date.now()
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Alert end time must be in the future.",
        },
        { status: 400 },
      );
    }

    endsAt = parsed.toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("tenh_system_announcements")
    .insert({
      title,
      message,
      tone,
      link_label: linkUrl ? linkLabel || "Learn more" : null,
      link_url: linkUrl,
      is_active: true,
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      created_by_user_id: admin.user.id,
      created_by_email: admin.user.email ?? null,
    })
    .select(`
      id,
      title,
      message,
      tone,
      link_label,
      link_url,
      is_active,
      starts_at,
      ends_at,
      created_by_email,
      created_at,
      updated_at
    `)
    .single();

  if (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to publish this update alert.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  await logTenhAdminAction({
    user: admin.user,
    action: "announcement_created",
    resourceType: "system_announcement",
    resourceId: data.id,
    metadata: {
      tone,
      title,
      hasLink: Boolean(linkUrl),
      endsAt,
    },
  });

  return noStoreJson({
    success: true,
    announcement: data,
  });
}
