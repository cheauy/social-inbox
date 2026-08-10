import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    reminderId: string;
  }>;
};

type PatchBody = {
  action?: "complete" | "snooze";
  remindAt?: string;
};

async function loadReminder(
  reminderId: string,
  businessId: string,
) {
  return supabaseAdmin
    .from("conversation_reminders")
    .select(`
      id,
      business_id,
      assigned_to,
      created_by,
      status,
      remind_at
    `)
    .eq("id", reminderId)
    .eq("business_id", businessId)
    .maybeSingle();
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
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

  const currentMember = authResult.member;
  const { reminderId } = await context.params;

  const {
    data: reminder,
    error: loadError,
  } = await loadReminder(
    reminderId,
    currentMember.business_id,
  );

  if (loadError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load reminder.",
        details: loadError.message,
      },
      { status: 500 },
    );
  }

  if (!reminder) {
    return NextResponse.json(
      {
        success: false,
        error: "Reminder was not found.",
      },
      { status: 404 },
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

  if (body.action === "complete") {
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("conversation_reminders")
      .update({
        status: "completed",
        completed_at: now,
        completed_by: currentMember.id,
        updated_at: now,
      })
      .eq("id", reminderId)
      .eq("business_id", currentMember.business_id)
      .select("id, status, completed_at")
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to complete reminder.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      reminder: data,
    });
  }

  if (body.action === "snooze") {
    const nextDate = new Date(
      body.remindAt ?? "",
    );

    if (
      !Number.isFinite(nextDate.getTime()) ||
      nextDate.getTime() <= Date.now()
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Snooze time must be in the future.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("conversation_reminders")
      .update({
        remind_at: nextDate.toISOString(),
        status: "open",
        completed_at: null,
        completed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reminderId)
      .eq("business_id", currentMember.business_id)
      .select("id, status, remind_at")
      .single();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to snooze reminder.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      reminder: data,
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: "Unsupported reminder action.",
    },
    { status: 400 },
  );
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
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

  const currentMember = authResult.member;
  const { reminderId } = await context.params;

  const { data, error } = await supabaseAdmin
    .from("conversation_reminders")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reminderId)
    .eq("business_id", currentMember.business_id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete reminder.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: "Reminder was not found.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
  });
}
