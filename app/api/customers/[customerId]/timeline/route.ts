import {
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    customerId: string;
  }>;
};

type ContactRow = {
  id: string;
  business_id: string;
  full_name: string | null;
  platform: string | null;
  created_at: string;
};

type ConversationRow = {
  id: string;
  business_id: string;
  contact_id: string | null;
  social_account_id: string | null;
  source_type: string | null;
  created_at: string;
};

type SocialAccountRow = {
  id: string;
  account_name: string | null;
  platform: string | null;
};

type ActivityRow = {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  actor_member_id: string | null;
  activity_type: string;
  title: string;
  description: string | null;
  actor_name: string | null;
  actor_profile_picture_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type CustomerFileRow = {
  id: string;
  conversation_id: string | null;
  item_type: "file" | "link" | string;
  display_name: string;
  description: string | null;
  uploaded_by_member_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

type ReminderRow = {
  id: string;
  conversation_id: string;
  contact_id: string;
  assigned_to: string;
  created_by: string;
  note: string;
  remind_at: string;
  status: "open" | "completed" | "cancelled" | string;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
};

type TeamMemberRow = {
  id: string;
  full_name: string;
  profile_picture_url: string | null;
};

export type CustomerTimelineItem = {
  id: string;
  type: string;
  createdAt: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  actorProfilePictureUrl: string | null;
  conversationId: string | null;
  channel: "messenger" | "comment" | null;
  pageName: string | null;
};

const ACTIVITY_TYPES = [
  "status_changed",
  "assigned",
  "unassigned",
  "tag_added",
  "tag_removed",
  "note_added",
  "note_updated",
  "note_deleted",
  "internal_note_added",
  "internal_note_updated",
  "internal_note_deleted",
  "customer_profile_updated",
  "customer_updated",
] as const;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function cleanText(
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return null;
  }

  return value.trim();
}

function capitalize(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function getNestedRecord(
  metadata: Record<string, unknown>,
  key: string,
) {
  return isRecord(metadata[key])
    ? metadata[key] as Record<string, unknown>
    : null;
}

function getChangedFieldLabels(
  metadata: Record<string, unknown>,
): string[] {
  const candidates = [
    metadata.changedFields,
    metadata.changed_fields,
    metadata.fields,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const labels = candidate
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }

        if (isRecord(item)) {
          return (
            cleanText(item.label) ??
            cleanText(item.field) ??
            ""
          );
        }

        return "";
      })
      .filter(Boolean);

    if (labels.length > 0) {
      return labels;
    }
  }

  return [];
}

function getConversationChannel(
  sourceType: string | null,
): "messenger" | "comment" {
  return sourceType === "comment"
    ? "comment"
    : "messenger";
}

function buildActivityPresentation(
  activity: ActivityRow,
): {
  title: string;
  detail: string | null;
} {
  const metadata = isRecord(activity.metadata)
    ? activity.metadata
    : {};

  if (activity.activity_type === "status_changed") {
    const oldStatus = capitalize(
      cleanText(metadata.oldStatus) ??
        cleanText(metadata.old_status),
    );
    const newStatus = capitalize(
      cleanText(metadata.newStatus) ??
        cleanText(metadata.new_status),
    );

    return {
      title: "Status changed",
      detail:
        oldStatus && newStatus
          ? `${oldStatus} → ${newStatus}`
          : newStatus
            ? `Changed to ${newStatus}`
            : null,
    };
  }

  if (activity.activity_type === "assigned") {
    const assignedTo =
      getNestedRecord(
        metadata,
        "assignedTo",
      ) ??
      getNestedRecord(
        metadata,
        "assigned_to",
      );

    const assignedName =
      cleanText(assignedTo?.name) ??
      activity.actor_name;

    return {
      title: assignedName
        ? `Assigned to ${assignedName}`
        : "Conversation assigned",
      detail: null,
    };
  }

  if (activity.activity_type === "unassigned") {
    return {
      title: "Conversation unassigned",
      detail: null,
    };
  }

  if (
    activity.activity_type === "tag_added" ||
    activity.activity_type === "tag_removed"
  ) {
    const tag = getNestedRecord(
      metadata,
      "tag",
    );
    const tagName = cleanText(tag?.name);
    const action =
      activity.activity_type === "tag_added"
        ? "added"
        : "removed";

    return {
      title: tagName
        ? `${tagName} tag ${action}`
        : `Customer tag ${action}`,
      detail: null,
    };
  }

  if (
    activity.activity_type === "note_added" ||
    activity.activity_type === "internal_note_added"
  ) {
    return {
      title: "Internal note added",
      detail: cleanText(metadata.noteText),
    };
  }

  if (
    activity.activity_type === "note_updated" ||
    activity.activity_type === "internal_note_updated"
  ) {
    return {
      title: "Internal note updated",
      detail:
        cleanText(metadata.noteText) ??
        cleanText(metadata.newNoteText),
    };
  }

  if (
    activity.activity_type === "note_deleted" ||
    activity.activity_type === "internal_note_deleted"
  ) {
    return {
      title: "Internal note deleted",
      detail: null,
    };
  }

  if (
    activity.activity_type === "customer_profile_updated" ||
    activity.activity_type === "customer_updated"
  ) {
    const fields = getChangedFieldLabels(
      metadata,
    );

    return {
      title: "Customer profile updated",
      detail:
        fields.length > 0
          ? `${fields.join(", ")} updated`
          : null,
    };
  }

  return {
    title:
      cleanText(activity.title) ??
      "Customer activity",
    detail: null,
  };
}

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

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

  const currentMember =
    authResult.member;
  const { customerId } =
    await context.params;
  const normalizedContactId =
    customerId?.trim();

  if (!normalizedContactId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: contactData,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name,
      platform,
      created_at
    `)
    .eq("id", normalizedContactId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the customer timeline.",
        details: contactError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!contactData) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  const contact =
    contactData as ContactRow;

  const {
    data: conversationData,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id,
      social_account_id,
      source_type,
      created_at
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      normalizedContactId,
    )
    .order("created_at", {
      ascending: false,
    });

  if (conversationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer conversations for the timeline.",
        details:
          conversationError.message,
      },
      {
        status: 500,
      },
    );
  }

  const conversations =
    (conversationData ?? []) as
      ConversationRow[];

  const socialAccountIds =
    Array.from(
      new Set(
        conversations
          .map(
            (conversation) =>
              conversation.social_account_id,
          )
          .filter(
            (id): id is string =>
              Boolean(id),
          ),
      ),
    );

  let socialAccounts:
    SocialAccountRow[] = [];

  if (socialAccountIds.length > 0) {
    const {
      data: socialAccountData,
      error: socialAccountError,
    } = await supabaseAdmin
      .from("social_accounts")
      .select(`
        id,
        account_name,
        platform
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .in("id", socialAccountIds);

    if (socialAccountError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to load Page information for the customer timeline.",
          details:
            socialAccountError.message,
        },
        {
          status: 500,
        },
      );
    }

    socialAccounts =
      (socialAccountData ?? []) as
        SocialAccountRow[];
  }

  const socialAccountMap =
    new Map(
      socialAccounts.map(
        (account) => [
          account.id,
          account,
        ],
      ),
    );

  const conversationMap =
    new Map(
      conversations.map(
        (conversation) => [
          conversation.id,
          conversation,
        ],
      ),
    );

  const conversationIds =
    conversations.map(
      (conversation) =>
        conversation.id,
    );

  let activities:
    ActivityRow[] = [];

  if (conversationIds.length > 0) {
    const {
      data: activityData,
      error: activityError,
    } = await supabaseAdmin
      .from("conversation_activity")
      .select(`
        id,
        conversation_id,
        contact_id,
        actor_member_id,
        activity_type,
        title,
        description,
        actor_name,
        actor_profile_picture_url,
        metadata,
        created_at
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .in(
        "conversation_id",
        conversationIds,
      )
      .in(
        "activity_type",
        [...ACTIVITY_TYPES],
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(150);

    if (activityError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to load customer activities.",
          details:
            activityError.message,
        },
        {
          status: 500,
        },
      );
    }

    activities =
      (activityData ?? []) as
        ActivityRow[];
  }

  const {
    data: customerFileData,
    error: customerFileError,
  } = await supabaseAdmin
    .from("customer_files")
    .select(`
      id,
      conversation_id,
      item_type,
      display_name,
      description,
      uploaded_by_member_id,
      created_at,
      deleted_at
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      normalizedContactId,
    )
    .order("created_at", {
      ascending: false,
    })
    .limit(100);

  if (customerFileError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer file activity.",
        details:
          customerFileError.message,
      },
      {
        status: 500,
      },
    );
  }

  const customerFiles =
    (customerFileData ?? []) as
      CustomerFileRow[];

  const {
    data: reminderData,
    error: reminderError,
  } = await supabaseAdmin
    .from("conversation_reminders")
    .select(`
      id,
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
      updated_at
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      normalizedContactId,
    )
    .order("created_at", {
      ascending: false,
    })
    .limit(100);

  if (reminderError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer reminder activity.",
        details:
          reminderError.message,
      },
      {
        status: 500,
      },
    );
  }

  const reminders =
    (reminderData ?? []) as
      ReminderRow[];

  const memberIds =
    Array.from(
      new Set(
        [
          ...customerFiles.map(
            (file) =>
              file.uploaded_by_member_id,
          ),
          ...reminders.flatMap(
            (reminder) => [
              reminder.created_by,
              reminder.completed_by,
            ],
          ),
        ].filter(
          (id): id is string =>
            Boolean(id),
        ),
      ),
    );

  let teamMembers:
    TeamMemberRow[] = [];

  if (memberIds.length > 0) {
    const {
      data: memberData,
      error: memberError,
    } = await supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        profile_picture_url
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .in("id", memberIds);

    if (memberError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to load team-member information for the customer timeline.",
          details:
            memberError.message,
        },
        {
          status: 500,
        },
      );
    }

    teamMembers =
      (memberData ?? []) as
        TeamMemberRow[];
  }

  const teamMemberMap =
    new Map(
      teamMembers.map(
        (member) => [
          member.id,
          member,
        ],
      ),
    );

  const timeline:
    CustomerTimelineItem[] = [];

  for (const activity of activities) {
    const conversation =
      conversationMap.get(
        activity.conversation_id,
      ) ?? null;
    const socialAccount =
      conversation?.social_account_id
        ? socialAccountMap.get(
            conversation.social_account_id,
          ) ?? null
        : null;
    const presentation =
      buildActivityPresentation(
        activity,
      );

    timeline.push({
      id: `activity:${activity.id}`,
      type: activity.activity_type,
      createdAt: activity.created_at,
      title: presentation.title,
      detail: presentation.detail,
      actorName:
        activity.actor_name,
      actorProfilePictureUrl:
        activity.actor_profile_picture_url,
      conversationId:
        activity.conversation_id,
      channel: conversation
        ? getConversationChannel(
            conversation.source_type,
          )
        : null,
      pageName:
        socialAccount?.account_name ??
        null,
    });
  }

  for (const file of customerFiles) {
    const conversation =
      file.conversation_id
        ? conversationMap.get(
            file.conversation_id,
          ) ?? null
        : null;
    const socialAccount =
      conversation?.social_account_id
        ? socialAccountMap.get(
            conversation.social_account_id,
          ) ?? null
        : null;
    const channel = conversation
      ? getConversationChannel(
          conversation.source_type,
        )
      : null;
    const uploader =
      file.uploaded_by_member_id
        ? teamMemberMap.get(
            file.uploaded_by_member_id,
          ) ?? null
        : null;
    const isLink =
      file.item_type === "link";

    timeline.push({
      id: `customer-file-created:${file.id}`,
      type: isLink
        ? "customer_link_added"
        : "customer_file_added",
      createdAt: file.created_at,
      title: isLink
        ? "Customer link added"
        : "Customer file added",
      detail:
        cleanText(file.display_name) ??
        file.description,
      actorName:
        uploader?.full_name ??
        null,
      actorProfilePictureUrl:
        uploader?.profile_picture_url ??
        null,
      conversationId:
        file.conversation_id,
      channel,
      pageName:
        socialAccount?.account_name ??
        null,
    });

    if (file.deleted_at) {
      timeline.push({
        id: `customer-file-deleted:${file.id}`,
        type: isLink
          ? "customer_link_deleted"
          : "customer_file_deleted",
        createdAt:
          file.deleted_at,
        title: isLink
          ? "Customer link deleted"
          : "Customer file deleted",
        detail:
          cleanText(file.display_name),
        actorName: null,
        actorProfilePictureUrl:
          null,
        conversationId:
          file.conversation_id,
        channel,
        pageName:
          socialAccount?.account_name ??
          null,
      });
    }
  }

  for (const reminder of reminders) {
    const conversation =
      conversationMap.get(
        reminder.conversation_id,
      ) ?? null;
    const socialAccount =
      conversation?.social_account_id
        ? socialAccountMap.get(
            conversation.social_account_id,
          ) ?? null
        : null;
    const channel = conversation
      ? getConversationChannel(
          conversation.source_type,
        )
      : null;
    const creator =
      teamMemberMap.get(
        reminder.created_by,
      ) ?? null;
    const completer =
      reminder.completed_by
        ? teamMemberMap.get(
            reminder.completed_by,
          ) ?? null
        : null;
    const reminderDetail =
      cleanText(reminder.note);

    timeline.push({
      id: `reminder-created:${reminder.id}`,
      type: "reminder_created",
      createdAt:
        reminder.created_at,
      title: "Reminder created",
      detail: reminderDetail,
      actorName:
        creator?.full_name ??
        null,
      actorProfilePictureUrl:
        creator?.profile_picture_url ??
        null,
      conversationId:
        reminder.conversation_id,
      channel,
      pageName:
        socialAccount?.account_name ??
        null,
    });

    if (
      reminder.status ===
        "completed" &&
      reminder.completed_at
    ) {
      timeline.push({
        id: `reminder-completed:${reminder.id}`,
        type:
          "reminder_completed",
        createdAt:
          reminder.completed_at,
        title:
          "Reminder completed",
        detail: reminderDetail,
        actorName:
          completer?.full_name ??
          null,
        actorProfilePictureUrl:
          completer?.profile_picture_url ??
          null,
        conversationId:
          reminder.conversation_id,
        channel,
        pageName:
          socialAccount?.account_name ??
          null,
      });
    } else if (
      reminder.status ===
        "cancelled"
    ) {
      timeline.push({
        id: `reminder-deleted:${reminder.id}`,
        type:
          "reminder_deleted",
        createdAt:
          reminder.updated_at,
        title: "Reminder deleted",
        detail: reminderDetail,
        actorName: null,
        actorProfilePictureUrl:
          null,
        conversationId:
          reminder.conversation_id,
        channel,
        pageName:
          socialAccount?.account_name ??
          null,
      });
    } else if (
      reminder.status === "open" &&
      new Date(
        reminder.updated_at,
      ).getTime() -
        new Date(
          reminder.created_at,
        ).getTime() >
        2_000
    ) {
      timeline.push({
        id: `reminder-snoozed:${reminder.id}`,
        type:
          "reminder_snoozed",
        createdAt:
          reminder.updated_at,
        title: "Reminder snoozed",
        detail: reminderDetail,
        actorName: null,
        actorProfilePictureUrl:
          null,
        conversationId:
          reminder.conversation_id,
        channel,
        pageName:
          socialAccount?.account_name ??
          null,
      });
    }
  }

  for (const conversation of conversations) {
    const socialAccount =
      conversation.social_account_id
        ? socialAccountMap.get(
            conversation.social_account_id,
          ) ?? null
        : null;
    const channel =
      getConversationChannel(
        conversation.source_type,
      );

    timeline.push({
      id:
        `conversation:${conversation.id}`,
      type: "conversation_started",
      createdAt:
        conversation.created_at,
      title:
        channel === "comment"
          ? "Facebook comment conversation started"
          : "Messenger conversation started",
      detail: null,
      actorName: null,
      actorProfilePictureUrl:
        null,
      conversationId:
        conversation.id,
      channel,
      pageName:
        socialAccount?.account_name ??
        null,
    });
  }

  const customerCreatedItem:
    CustomerTimelineItem = {
      id:
        `customer:${contact.id}`,
      type: "customer_created",
      createdAt: contact.created_at,
      title: "Customer created",
      detail:
        contact.platform === "facebook"
          ? "Created from Facebook"
          : null,
      actorName: null,
      actorProfilePictureUrl: null,
      conversationId: null,
      channel: null,
      pageName: null,
    };

  timeline.push(
    customerCreatedItem,
  );

  timeline.sort(
    (first, second) =>
      new Date(
        second.createdAt,
      ).getTime() -
      new Date(
        first.createdAt,
      ).getTime(),
  );

  /*
   * Keep the component light even for very old customers, but always retain
   * the original customer-created event at the bottom of the returned list.
   */
  let items = timeline.slice(
    0,
    120,
  );

  if (
    !items.some(
      (item) =>
        item.id ===
        customerCreatedItem.id,
    )
  ) {
    items = [
      ...items,
      customerCreatedItem,
    ];
  }

  return NextResponse.json({
    success: true,
    items,
  });
}
