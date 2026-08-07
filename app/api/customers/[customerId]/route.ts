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
    customerId: string;
  }>;
};

type TeamMemberResult = {
  id: string;
  full_name: string;
  role: string;
  profile_picture_url: string | null;
};

type SocialAccountResult = {
  id: string;
  platform: string;
  account_name: string | null;
};

type TagResult = {
  id: string;
  name: string;
  color: string;
};

type ContactTagResult = {
  tag:
    | TagResult
    | TagResult[]
    | null;
};

type ContactResult = {
  id: string;
  business_id: string;
  full_name: string | null;
  profile_picture_url: string | null;
  platform_user_id: string;
  phone: string | null;
  address: string | null;
  customer_note: string | null;
  created_at: string;
  last_contact_at: string | null;
  updated_at: string | null;

  contact_tags:
    | ContactTagResult[]
    | null;
};

type ConversationResult = {
  id: string;
  business_id: string;
  contact_id: string | null;
  social_account_id: string | null;
  status: string;
  assigned_to: string | null;
  assigned_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string | null;

  assigned_member:
    | TeamMemberResult
    | TeamMemberResult[]
    | null;

  social_account:
    | SocialAccountResult
    | SocialAccountResult[]
    | null;
};

type NoteResult = {
  id: string;
  contact_id: string;
  author_id: string;
  note_text: string;
  created_at: string;
  updated_at: string;

  author:
    | TeamMemberResult
    | TeamMemberResult[]
    | null;
};

type ActivityResult = {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  actor_member_id: string | null;
  activity_type: string;
  title: string;
  description: string | null;
  customer_name: string;
  actor_name: string;
  actor_profile_picture_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function getSingleResult<T>(
  value: T | T[] | null,
): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  /*
   * 1. Authenticate the logged-in team member.
   */
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

  if (!customerId?.trim()) {
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

  /*
   * 2. Load the customer and verify that the
   * customer belongs to the current business.
   */
  const {
    data: customerData,
    error: customerError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name,
      profile_picture_url,
      platform_user_id,
      phone,
      address,
      customer_note,
      created_at,
      last_contact_at,
      updated_at,

      contact_tags (
        tag:tags (
          id,
          name,
          color
        )
      )
    `)
    .eq("id", customerId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (customerError) {
    console.error(
      "Unable to load customer details:",
      customerError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer details.",
        details:
          customerError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!customerData) {
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

  const customer =
    customerData as unknown as ContactResult;

  /*
   * 3. Load conversations, notes and activity
   * at the same time.
   */
  const [
    conversationsResult,
    notesResult,
    activitiesResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("conversations")
      .select(`
        id,
        business_id,
        contact_id,
        social_account_id,
        status,
        assigned_to,
        assigned_at,
        last_message_at,
        created_at,
        updated_at,

        assigned_member:team_members (
          id,
          full_name,
          role,
          profile_picture_url
        ),

        social_account:social_accounts (
          id,
          platform,
          account_name
        )
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .eq(
        "contact_id",
        customer.id,
      )
      .order(
        "last_message_at",
        {
          ascending: false,
          nullsFirst: false,
        },
      ),

    supabaseAdmin
      .from("contact_notes")
      .select(`
        id,
        contact_id,
        author_id,
        note_text,
        created_at,
        updated_at,

        author:team_members (
          id,
          full_name,
          role,
          profile_picture_url
        )
      `)
      .eq(
        "contact_id",
        customer.id,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      ),

    supabaseAdmin
      .from("conversation_activity")
      .select(`
        id,
        conversation_id,
        contact_id,
        actor_member_id,
        activity_type,
        title,
        description,
        customer_name,
        actor_name,
        actor_profile_picture_url,
        metadata,
        created_at
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .eq(
        "contact_id",
        customer.id,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(50),
  ]);

  if (conversationsResult.error) {
    console.error(
      "Unable to load customer conversations:",
      conversationsResult.error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer conversations.",
        details:
          conversationsResult.error.message,
      },
      {
        status: 500,
      },
    );
  }

  if (notesResult.error) {
    console.error(
      "Unable to load customer notes:",
      notesResult.error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer notes.",
        details:
          notesResult.error.message,
      },
      {
        status: 500,
      },
    );
  }

  if (activitiesResult.error) {
    console.error(
      "Unable to load customer activities:",
      activitiesResult.error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer activities.",
        details:
          activitiesResult.error.message,
      },
      {
        status: 500,
      },
    );
  }

  const conversations =
    (
      conversationsResult.data ??
      []
    ) as unknown as ConversationResult[];

  const notes =
    (
      notesResult.data ?? []
    ) as unknown as NoteResult[];

  const activities =
    (
      activitiesResult.data ??
      []
    ) as unknown as ActivityResult[];

  /*
   * 4. Transform tags.
   */
  const tags =
    (
      customer.contact_tags ??
      []
    )
      .map((relation) =>
        getSingleResult(
          relation.tag,
        ),
      )
      .filter(
        (
          tag,
        ): tag is TagResult =>
          Boolean(tag),
      );

  /*
   * 5. Transform conversation records.
   */
  const transformedConversations =
    conversations.map(
      (conversation) => {
        const assignedMember =
          getSingleResult(
            conversation.assigned_member,
          );

        const socialAccount =
          getSingleResult(
            conversation.social_account,
          );

        return {
          id: conversation.id,

          status:
            conversation.status,

          assignedTo:
            conversation.assigned_to,

          assignedAt:
            conversation.assigned_at,

          lastMessageAt:
            conversation.last_message_at,

          createdAt:
            conversation.created_at,

          updatedAt:
            conversation.updated_at,

          assignedMember:
            assignedMember
              ? {
                  id:
                    assignedMember.id,

                  fullName:
                    assignedMember.full_name,

                  role:
                    assignedMember.role,

                  profilePictureUrl:
                    assignedMember.profile_picture_url,
                }
              : null,

          socialAccount:
            socialAccount
              ? {
                  id:
                    socialAccount.id,

                  platform:
                    socialAccount.platform,

                  accountName:
                    socialAccount.account_name,
                }
              : null,
        };
      },
    );

  /*
   * 6. Transform internal notes.
   */
  const transformedNotes =
    notes.map((note) => {
      const author =
        getSingleResult(
          note.author,
        );

      return {
        id: note.id,
        contactId:
          note.contact_id,
        authorId:
          note.author_id,
        noteText:
          note.note_text,
        createdAt:
          note.created_at,
        updatedAt:
          note.updated_at,

        author:
          author
            ? {
                id: author.id,

                fullName:
                  author.full_name,

                role:
                  author.role,

                profilePictureUrl:
                  author.profile_picture_url,
              }
            : null,
      };
    });

  /*
   * 7. Build customer statistics.
   */
  const totalConversations =
    transformedConversations.length;

  const openConversations =
    transformedConversations.filter(
      (conversation) =>
        conversation.status ===
        "open",
    ).length;

  const pendingConversations =
    transformedConversations.filter(
      (conversation) =>
        conversation.status ===
        "pending",
    ).length;

  const resolvedConversations =
    transformedConversations.filter(
      (conversation) =>
        conversation.status ===
          "resolved" ||
        conversation.status ===
          "closed",
    ).length;

  const unassignedConversations =
    transformedConversations.filter(
      (conversation) =>
        !conversation.assignedTo,
    ).length;

  const latestConversation =
    transformedConversations[0] ??
    null;

  /*
   * 8. Return the customer detail response.
   */
  return NextResponse.json({
    success: true,

    customer: {
      id: customer.id,

      fullName:
        customer.full_name ??
        "Facebook customer",
        
      businessId:
      customer.business_id,

      profilePictureUrl:
        customer.profile_picture_url,

      platformUserId:
        customer.platform_user_id,

      phone:
        customer.phone,

      address:
        customer.address,

      customerNote:
        customer.customer_note,

      createdAt:
        customer.created_at,

      lastActiveAt:
        customer.last_contact_at,

      updatedAt:
        customer.updated_at,

      tags,
    },

    statistics: {
      totalConversations,
      openConversations,
      pendingConversations,
      resolvedConversations,
      unassignedConversations,
      totalInternalNotes:
        transformedNotes.length,
      totalActivities:
        activities.length,
    },

    latestConversation,

    conversations:
      transformedConversations,

    notes:
      transformedNotes,

    activities,

    currentMember: {
      id:
        currentMember.id,

      fullName:
        currentMember.full_name,

      role:
        currentMember.role,

      profilePictureUrl:
        currentMember.profile_picture_url,
    },
  });
}