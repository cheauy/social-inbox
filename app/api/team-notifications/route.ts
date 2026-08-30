import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { TENH_ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/get-current-member";

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

type DueReminderRow = {
  id: string;
  business_id: string;
  conversation_id: string;
  contact_id: string | null;
  note: string;
  remind_at: string;
};

type ActiveRecipientRow = {
  id: string;
  business_id: string;
};

function deterministicReminderNotificationId(
  reminderId: string,
  remindAt: string,
  memberId: string,
) {
  const bytes = createHash("sha256")
    .update(`${reminderId}|${remindAt}|${memberId}`)
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function createDueReminderNotifications(businessIds: string[]) {
  if (businessIds.length === 0) return;

  const now = new Date().toISOString();
  const { data: reminders, error: reminderError } = await supabaseAdmin
    .from("conversation_reminders")
    .select("id,business_id,conversation_id,contact_id,note,remind_at")
    .in("business_id", businessIds)
    .eq("status", "open")
    .lte("remind_at", now)
    .order("remind_at", { ascending: true })
    .limit(100);

  if (reminderError) {
    console.error(
      "[TENH reminders] Unable to check due reminders:",
      reminderError.message,
    );
    return;
  }

  const dueReminders = (reminders ?? []) as DueReminderRow[];
  if (dueReminders.length === 0) return;

  const dueBusinessIds = [
    ...new Set(dueReminders.map((reminder) => reminder.business_id)),
  ];
  const { data: recipients, error: recipientError } = await supabaseAdmin
    .from("team_members")
    .select("id,business_id")
    .in("business_id", dueBusinessIds)
    .eq("is_active", true);

  if (recipientError) {
    console.error(
      "[TENH reminders] Unable to load notification recipients:",
      recipientError.message,
    );
    return;
  }

  const recipientsByBusiness = new Map<string, ActiveRecipientRow[]>();
  for (const recipient of (recipients ?? []) as ActiveRecipientRow[]) {
    const rows = recipientsByBusiness.get(recipient.business_id) ?? [];
    rows.push(recipient);
    recipientsByBusiness.set(recipient.business_id, rows);
  }

  const notificationRows = dueReminders.flatMap((reminder) =>
    (recipientsByBusiness.get(reminder.business_id) ?? []).map((recipient) => ({
      id: deterministicReminderNotificationId(
        reminder.id,
        reminder.remind_at,
        recipient.id,
      ),
      business_id: reminder.business_id,
      recipient_member_id: recipient.id,
      actor_member_id: null,
      notification_type: "conversation_reminder",
      title: "Reminder",
      body: reminder.note.slice(0, 1500),
      link: `/dashboard/inbox?conversation=${encodeURIComponent(
        reminder.conversation_id,
      )}`,
      room_id: null,
      conversation_id: reminder.conversation_id,
      contact_id: reminder.contact_id,
      is_read: false,
      read_at: null,
      created_at: reminder.remind_at,
    })),
  );

  for (let index = 0; index < notificationRows.length; index += 500) {
    const { error } = await supabaseAdmin
      .from("team_notifications")
      .upsert(notificationRows.slice(index, index + 500), {
        onConflict: "id",
        ignoreDuplicates: true,
      });

    if (error) {
      console.error(
        "[TENH reminders] Unable to create reminder notifications:",
        error.message,
      );
      return;
    }
  }
}

async function loadNotificationScope() {
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
      error: "Unable to load notification access.",
    };
  }

  const memberRows = (memberships ?? []) as MemberRow[];
  const businessIds = [...new Set(memberRows.map((row) => row.business_id))];

  if (businessIds.length === 0) {
    return {
      success: true as const,
      user,
      members: [] as MemberRow[],
      memberIds: [] as string[],
      businessIds: [] as string[],
      currentBusinessId: null as string | null,
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
      error: "Unable to verify notification subscriptions.",
    };
  }

  const latest = new Map<string, SubscriptionRow>();
  for (const row of (subscriptions ?? []) as SubscriptionRow[]) {
    if (!latest.has(row.business_id)) latest.set(row.business_id, row);
  }

  const operationalBusinessIds = businessIds.filter((businessId) =>
    isOperational(latest.get(businessId) ?? null),
  );
  const operationalSet = new Set(operationalBusinessIds);
  const operationalMembers = memberRows.filter((member) =>
    operationalSet.has(member.business_id),
  );

  const cookieStore = await cookies();
  const currentBusinessId =
    cookieStore.get(TENH_ACTIVE_BUSINESS_COOKIE)?.value?.trim() || null;

  return {
    success: true as const,
    user,
    members: operationalMembers,
    memberIds: operationalMembers.map((member) => member.id),
    businessIds: operationalBusinessIds,
    currentBusinessId,
  };
}

export async function GET() {
  const scope = await loadNotificationScope();

  if (!scope.success) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status, headers: NO_STORE_HEADERS },
    );
  }

  if (scope.memberIds.length === 0) {
    return NextResponse.json(
      {
        success: true,
        memberIds: [],
        businessIds: [],
        currentBusinessId: scope.currentBusinessId,
        notifications: [],
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  // The notification center already polls every 30 seconds. On each poll,
  // safely materialize any due reminder into one unread notification for
  // every active member (including Owners) in that workspace.
  await createDueReminderNotifications(scope.businessIds);

  const { data, error } = await supabaseAdmin
    .from("team_notifications")
    .select(`
      id,
      business_id,
      recipient_member_id,
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
    .in("business_id", scope.businessIds)
    .in("recipient_member_id", scope.memberIds)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load notifications.",
        details: error.message,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      success: true,
      memberIds: scope.memberIds,
      businessIds: scope.businessIds,
      currentBusinessId: scope.currentBusinessId,
      notifications: data ?? [],
    },
    { headers: NO_STORE_HEADERS },
  );
}

type PatchBody = {
  action?: unknown;
  notificationId?: unknown;
};

export async function PATCH(request: NextRequest) {
  const scope = await loadNotificationScope();

  if (!scope.success) {
    return NextResponse.json(
      { success: false, error: scope.error },
      { status: scope.status },
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

  const action =
    typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const notificationId =
    typeof body.notificationId === "string" ? body.notificationId.trim() : "";
  const now = new Date().toISOString();

  if (scope.memberIds.length === 0) {
    return NextResponse.json({ success: true });
  }

  if (action === "mark_read") {
    if (!notificationId) {
      return NextResponse.json(
        { success: false, error: "Notification ID is required." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("team_notifications")
      .update({ is_read: true, read_at: now })
      .eq("id", notificationId)
      .in("business_id", scope.businessIds)
      .in("recipient_member_id", scope.memberIds)
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
        { success: false, error: "Notification was not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  }

  if (action === "mark_all_read") {
    const { error } = await supabaseAdmin
      .from("team_notifications")
      .update({ is_read: true, read_at: now })
      .in("business_id", scope.businessIds)
      .in("recipient_member_id", scope.memberIds)
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
    { success: false, error: "Unsupported notification action." },
    { status: 400 },
  );
}
