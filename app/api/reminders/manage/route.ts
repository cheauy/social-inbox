import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

const OPERATIONAL_STATUSES = new Set(["active", "trialing"]);

type MemberRow = {
  id: string;
  business_id: string;
};

type SubscriptionRow = {
  business_id: string;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

type ReminderView = "pending" | "sent" | "cancelled";

type ReminderRow = {
  id: string;
  business_id: string;
  conversation_id: string;
  contact_id: string;
  note: string;
  remind_at: string;
  status: "open" | "completed" | "cancelled";
  assigned_to: string;
  created_by: string;
  created_at: string;
  updated_at: string | null;
  contact:
    | {
        id: string;
        full_name: string | null;
        profile_picture_url: string | null;
      }
    | Array<{
        id: string;
        full_name: string | null;
        profile_picture_url: string | null;
      }>
    | null;
  assigned_member:
    | {
        id: string;
        full_name: string;
        role: string;
        profile_picture_url: string | null;
      }
    | Array<{
        id: string;
        full_name: string;
        role: string;
        profile_picture_url: string | null;
      }>
    | null;
};

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperational(subscription: SubscriptionRow | null) {
  if (!subscription) return true;
  if (!OPERATIONAL_STATUSES.has(subscription.status)) return false;

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

function singleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

async function loadReminderScope() {
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

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from("team_members")
    .select("id,business_id")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipError) {
    return {
      success: false as const,
      status: 500,
      error: "Unable to load reminder access.",
    };
  }

  const memberRows = (memberships ?? []) as MemberRow[];
  const businessIds = [...new Set(memberRows.map((row) => row.business_id))];

  if (businessIds.length === 0) {
    return {
      success: true as const,
      businessIds: [] as string[],
    };
  }

  const { data: subscriptions, error: subscriptionError } = await supabaseAdmin
    .from("business_subscriptions")
    .select("business_id,status,current_period_end,trial_ends_at,created_at")
    .in("business_id", businessIds)
    .order("created_at", { ascending: false });

  if (subscriptionError) {
    return {
      success: false as const,
      status: 500,
      error: "Unable to verify reminder subscriptions.",
    };
  }

  const latest = new Map<string, SubscriptionRow>();
  for (const row of (subscriptions ?? []) as SubscriptionRow[]) {
    if (!latest.has(row.business_id)) {
      latest.set(row.business_id, row);
    }
  }

  return {
    success: true as const,
    businessIds: businessIds.filter((businessId) =>
      isOperational(latest.get(businessId) ?? null),
    ),
  };
}

function parseView(value: string | null): ReminderView {
  if (value === "sent" || value === "cancelled") return value;
  return "pending";
}

function reminderMatchesView(
  reminder: ReminderRow,
  view: ReminderView,
  nowMs: number,
) {
  const remindAtMs = Date.parse(reminder.remind_at);

  if (view === "cancelled") {
    return reminder.status === "cancelled";
  }

  if (view === "sent") {
    return (
      reminder.status === "completed" ||
      (reminder.status === "open" &&
        Number.isFinite(remindAtMs) &&
        remindAtMs <= nowMs)
    );
  }

  return (
    reminder.status === "open" &&
    Number.isFinite(remindAtMs) &&
    remindAtMs > nowMs
  );
}

export async function GET(request: NextRequest) {
  const scope = await loadReminderScope();

  if (!scope.success) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status, headers: NO_STORE_HEADERS },
    );
  }

  if (scope.businessIds.length === 0) {
    return NextResponse.json(
      {
        success: true,
        view: "pending",
        counts: { pending: 0, sent: 0, cancelled: 0 },
        reminders: [],
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const view = parseView(url.searchParams.get("view"));
  const conversationId = url.searchParams.get("conversationId")?.trim() ?? "";

  let query = supabaseAdmin
    .from("conversation_reminders")
    .select(`
      id,
      business_id,
      conversation_id,
      contact_id,
      note,
      remind_at,
      status,
      assigned_to,
      created_by,
      created_at,
      updated_at,
      contact:contacts (
        id,
        full_name,
        profile_picture_url
      ),
      assigned_member:team_members!conversation_reminders_assigned_to_fkey (
        id,
        full_name,
        role,
        profile_picture_url
      )
    `)
    .in("business_id", scope.businessIds)
    .order("remind_at", { ascending: true })
    .limit(500);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const [{ data: reminders, error: reminderError }, { data: businesses, error: businessError }] =
    await Promise.all([
      query,
      supabaseAdmin
        .from("businesses")
        .select("id,name")
        .in("id", scope.businessIds),
    ]);

  if (reminderError || businessError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load reminders.",
        details: reminderError?.message ?? businessError?.message,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const workspaceNames = new Map(
    (businesses ?? []).map((row) => [
      row.id as string,
      (row.name as string | null) ?? "Workspace",
    ]),
  );
  const nowMs = Date.now();
  const rows = (reminders ?? []) as unknown as ReminderRow[];

  const counts = rows.reduce(
    (result, reminder) => {
      if (reminderMatchesView(reminder, "pending", nowMs)) result.pending += 1;
      if (reminderMatchesView(reminder, "sent", nowMs)) result.sent += 1;
      if (reminderMatchesView(reminder, "cancelled", nowMs)) result.cancelled += 1;
      return result;
    },
    { pending: 0, sent: 0, cancelled: 0 },
  );

  const selectedRows = rows
    .filter((reminder) => reminderMatchesView(reminder, view, nowMs))
    .sort((a, b) => {
      const left = Date.parse(a.remind_at);
      const right = Date.parse(b.remind_at);
      return view === "pending" ? left - right : right - left;
    })
    .map((reminder) => ({
      ...reminder,
      contact: singleRelation(reminder.contact),
      assigned_member: singleRelation(reminder.assigned_member),
      workspace: {
        id: reminder.business_id,
        name: workspaceNames.get(reminder.business_id) ?? "Workspace",
      },
    }));

  return NextResponse.json(
    {
      success: true,
      view,
      counts,
      reminders: selectedRows,
    },
    { headers: NO_STORE_HEADERS },
  );
}
