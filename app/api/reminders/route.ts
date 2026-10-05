import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canSeePersonalAccount, hiddenConversationIdSet, hiddenPersonalAccountIds } from "@/lib/telegram-personal/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateReminderBody = {
  conversationId?: string;
  contactId?: string;
  assignedTo?: string;
  note?: string;
  remindAt?: string;
};

export async function GET(
  request: NextRequest,
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
  const summary =
    request.nextUrl.searchParams.get("summary") ===
    "1";

  if (summary) {
    let countQuery = supabaseAdmin
      .from("conversation_reminders")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("business_id", currentMember.business_id)
      .eq("status", "open");

    if (
      currentMember.role !== "owner" &&
      currentMember.role !== "admin"
    ) {
      countQuery = countQuery.eq(
        "assigned_to",
        currentMember.id,
      );
    }

    const { count, error } = await countQuery;

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to load reminder count.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      count: count ?? 0,
    });
  }

  let query = supabaseAdmin
    .from("conversation_reminders")
    .select(`
      id,
      business_id,
      conversation_id,
      contact_id,
      assigned_to,
      created_by,
      note,
      remind_at,
      status,
      completed_at,
      completed_by,
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
    .eq("business_id", currentMember.business_id)
    .eq("status", "open")
    .order("remind_at", { ascending: true })
    .limit(250);

  if (
    currentMember.role !== "owner" &&
    currentMember.role !== "admin"
  ) {
    query = query.eq(
      "assigned_to",
      currentMember.id,
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load reminders.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  // Reminders on Telegram Personal chats this member may not see are not listed.
  const hiddenPersonal = await hiddenPersonalAccountIds([currentMember.business_id], authResult.user.id);
  const hiddenConversations = await hiddenConversationIdSet((data ?? []).map((row) => row.conversation_id), hiddenPersonal);

  return NextResponse.json({
    success: true,
    reminders: (data ?? []).filter((row) => !hiddenConversations.has(row.conversation_id)),
    currentMemberId: currentMember.id,
    currentMemberRole: currentMember.role,
  });
}

export async function POST(
  request: NextRequest,
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

  let body: CreateReminderBody;

  try {
    body =
      (await request.json()) as CreateReminderBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const conversationId =
    body.conversationId?.trim();
  const contactId = body.contactId?.trim();
  const assignedTo = body.assignedTo?.trim();
  const note = body.note?.trim();
  const remindAt = body.remindAt?.trim();

  if (
    !conversationId ||
    !contactId ||
    !assignedTo ||
    !note ||
    !remindAt
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation, customer, assignee, reminder text and time are required.",
      },
      { status: 400 },
    );
  }

  if (note.length > 2000) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Reminder cannot exceed 2,000 characters.",
      },
      { status: 400 },
    );
  }

  const remindDate = new Date(remindAt);

  if (
    !Number.isFinite(remindDate.getTime()) ||
    remindDate.getTime() <= Date.now()
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Reminder time must be in the future.",
      },
      { status: 400 },
    );
  }

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select("id, contact_id, business_id, social_account_id, platform")
    .eq("id", conversationId)
    .eq("contact_id", contactId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  // A reminder cannot be created on a Telegram Personal chat the member may not see.
  const conversationHidden = conversation?.platform === "telegram_personal" &&
    !(await canSeePersonalAccount(conversation.social_account_id, authResult.user.id));

  if (conversationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify conversation access.",
        details: conversationError.message,
      },
      { status: 500 },
    );
  }

  if (!conversation || conversationHidden) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation was not found or is not part of this business.",
      },
      { status: 404 },
    );
  }

  const {
    data: assignee,
    error: assigneeError,
  } = await supabaseAdmin
    .from("team_members")
    .select("id, user_id")
    .eq("id", assignedTo)
    .eq("business_id", currentMember.business_id)
    .eq("is_active", true)
    .maybeSingle();

  if (assigneeError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify assignee.",
        details: assigneeError.message,
      },
      { status: 500 },
    );
  }

  // The assignee must also be allowed to see a Telegram Personal chat.
  const assigneeHidden = Boolean(assignee) && conversation.platform === "telegram_personal" &&
    !(await canSeePersonalAccount(conversation.social_account_id, String(assignee?.user_id ?? "")));

  if (!assignee || assigneeHidden) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The selected assignee is not an active member of this business.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("conversation_reminders")
    .insert({
      business_id: currentMember.business_id,
      conversation_id: conversationId,
      contact_id: contactId,
      assigned_to: assignedTo,
      created_by: currentMember.id,
      note,
      remind_at: remindDate.toISOString(),
      status: "open",
    })
    .select(`
      id,
      conversation_id,
      contact_id,
      assigned_to,
      created_by,
      note,
      remind_at,
      status,
      created_at,
      updated_at
    `)
    .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to create reminder.",
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
