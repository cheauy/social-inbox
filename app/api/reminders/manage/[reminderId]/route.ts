import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    reminderId: string;
  }>;
};

type PatchBody = {
  note?: unknown;
  remindAt?: unknown;
};

type SubscriptionRow = {
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperational(subscription: SubscriptionRow | null) {
  if (!subscription) return true;
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

async function authorizeReminder(reminderId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false as const,
      status: 401,
      error: "Unauthorized.",
    };
  }

  const { data: reminder, error: reminderError } = await supabaseAdmin
    .from("conversation_reminders")
    .select("id,business_id,conversation_id,contact_id,note,remind_at,status")
    .eq("id", reminderId)
    .maybeSingle();

  if (reminderError) {
    return {
      success: false as const,
      status: 500,
      error: "Unable to load reminder.",
    };
  }

  if (!reminder) {
    return {
      success: false as const,
      status: 404,
      error: "Reminder was not found.",
    };
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("business_id", reminder.business_id)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError) {
    return {
      success: false as const,
      status: 500,
      error: "Unable to verify reminder access.",
    };
  }

  if (!membership) {
    return {
      success: false as const,
      status: 403,
      error: "You no longer have access to this reminder workspace.",
    };
  }

  const { data: subscriptions, error: subscriptionError } = await supabaseAdmin
    .from("business_subscriptions")
    .select("status,current_period_end,trial_ends_at,created_at")
    .eq("business_id", reminder.business_id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (subscriptionError) {
    return {
      success: false as const,
      status: 500,
      error: "Unable to verify reminder subscription.",
    };
  }

  const latest = ((subscriptions ?? [])[0] ?? null) as SubscriptionRow | null;
  if (!isOperational(latest)) {
    return {
      success: false as const,
      status: 403,
      error: "This workspace is expired or inactive.",
    };
  }

  return {
    success: true as const,
    reminder,
  };
}

function isPendingReminder(reminder: {
  status: string;
  remind_at: string;
}) {
  const remindAtMs = Date.parse(reminder.remind_at);
  return (
    reminder.status === "open" &&
    Number.isFinite(remindAtMs) &&
    remindAtMs > Date.now()
  );
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const { reminderId } = await context.params;
  const auth = await authorizeReminder(reminderId);

  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  if (!isPendingReminder(auth.reminder)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This reminder has already triggered or is no longer pending. Create a new reminder instead.",
      },
      { status: 409 },
    );
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  const remindAt = typeof body.remindAt === "string" ? body.remindAt.trim() : "";

  if (!note || !remindAt) {
    return NextResponse.json(
      {
        success: false,
        error: "Reminder note and time are required.",
      },
      { status: 400 },
    );
  }

  if (note.length > 2000) {
    return NextResponse.json(
      { success: false, error: "Reminder cannot exceed 2,000 characters." },
      { status: 400 },
    );
  }

  const date = new Date(remindAt);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
    return NextResponse.json(
      { success: false, error: "Reminder time must be in the future." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("conversation_reminders")
    .update({
      note,
      remind_at: date.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", reminderId)
    .eq("status", "open")
    .select("id,note,remind_at,status,updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to update reminder.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: "Reminder changed before the update could be saved. Refresh and try again.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    reminder: data,
  });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const { reminderId } = await context.params;
  const auth = await authorizeReminder(reminderId);

  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  if (!isPendingReminder(auth.reminder)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This reminder has already triggered or is no longer pending, so it cannot be cancelled.",
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("conversation_reminders")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reminderId)
    .eq("status", "open")
    .select("id,status")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to cancel reminder.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: "Reminder changed before it could be cancelled. Refresh and try again.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true });
}
