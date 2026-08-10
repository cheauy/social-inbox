import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamMemberRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
};

type ConversationRow = {
  id: string;
  status: string;
  assigned_to: string | null;
  unread_count: number | null;
};

type ReminderRow = {
  assigned_to: string;
  remind_at: string;
  status: string;
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
      },
    );
  }

  const currentMember = authResult.member;
  const businessId = currentMember.business_id;

  const [
    membersResult,
    conversationsResult,
    remindersResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        email,
        role,
        profile_picture_url
      `)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("full_name", {
        ascending: true,
      }),

    supabaseAdmin
      .from("conversations")
      .select(`
        id,
        status,
        assigned_to,
        unread_count
      `)
      .eq("business_id", businessId),

    supabaseAdmin
      .from("conversation_reminders")
      .select(`
        assigned_to,
        remind_at,
        status
      `)
      .eq("business_id", businessId)
      .eq("status", "open"),
  ]);

  if (membersResult.error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load team members.",
        details: membersResult.error.message,
      },
      { status: 500 },
    );
  }

  if (conversationsResult.error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load conversation workload.",
        details: conversationsResult.error.message,
      },
      { status: 500 },
    );
  }

  if (remindersResult.error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load reminder workload.",
        details: remindersResult.error.message,
      },
      { status: 500 },
    );
  }

  const members =
    (membersResult.data ?? []) as TeamMemberRow[];

  const conversations =
    (conversationsResult.data ?? []) as ConversationRow[];

  const reminders =
    (remindersResult.data ?? []) as ReminderRow[];

  const now = Date.now();

  const workload = members.map((member) => {
    const assignedConversations =
      conversations.filter(
        (conversation) =>
          conversation.assigned_to === member.id,
      );

    const openCount =
      assignedConversations.filter(
        (conversation) =>
          conversation.status === "open",
      ).length;

    const pendingCount =
      assignedConversations.filter(
        (conversation) =>
          conversation.status === "pending",
      ).length;

    const unreadCount =
      assignedConversations.reduce(
        (total, conversation) =>
          total +
          Math.max(
            0,
            conversation.unread_count ?? 0,
          ),
        0,
      );

    const overdueReminders = reminders.filter(
      (reminder) =>
        reminder.assigned_to === member.id &&
        new Date(reminder.remind_at).getTime() < now,
    ).length;

    return {
      memberId: member.id,
      fullName: member.full_name,
      email: member.email,
      role: member.role,
      profilePictureUrl:
        member.profile_picture_url,
      openCount,
      pendingCount,
      activeCount:
        openCount + pendingCount,
      unreadCount,
      overdueReminders,
    };
  });

  workload.sort((first, second) => {
    if (
      first.activeCount !== second.activeCount
    ) {
      return (
        first.activeCount - second.activeCount
      );
    }

    if (
      first.overdueReminders !==
      second.overdueReminders
    ) {
      return (
        first.overdueReminders -
        second.overdueReminders
      );
    }

    return first.fullName.localeCompare(
      second.fullName,
    );
  });

  const unassignedCount = conversations.filter(
    (conversation) =>
      !conversation.assigned_to &&
      (conversation.status === "open" ||
        conversation.status === "pending"),
  ).length;

  return NextResponse.json({
    success: true,
    businessId,
    currentMemberId: currentMember.id,
    currentMemberRole: currentMember.role,
    unassignedCount,
    members: workload,
  });
}
