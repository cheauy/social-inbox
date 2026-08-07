import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

type TagBody = {
  tagId?: string;

  /*
   * The active inbox conversation.
   * Activity belongs to this conversation timeline.
   */
  conversationId?: string;
};

type ContactResult = {
  id: string;
  business_id: string;
  full_name: string | null;
};

type TagResult = {
  id: string;
  business_id: string;
  name: string;
  color: string;
};

type ConversationResult = {
  id: string;
  business_id: string;
  contact_id: string | null;
};

async function loadTagContext({
  contactId,
  tagId,
  conversationId,
  businessId,
}: {
  contactId: string;
  tagId: string;
  conversationId: string | null;
  businessId: string;
}) {
  const {
    data: contactData,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name
    `)
    .eq("id", contactId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (contactError) {
    throw new Error(
      `Unable to load customer: ${contactError.message}`,
    );
  }

  if (!contactData) {
    return {
      success: false as const,
      status: 404,
      error:
        "Customer was not found or you do not have access.",
    };
  }

  const contact =
    contactData as ContactResult;

  const {
    data: tagData,
    error: tagError,
  } = await supabaseAdmin
    .from("tags")
    .select(`
      id,
      business_id,
      name,
      color
    `)
    .eq("id", tagId)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .maybeSingle();

  if (tagError) {
    throw new Error(
      `Unable to load tag: ${tagError.message}`,
    );
  }

  if (!tagData) {
    return {
      success: false as const,
      status: 404,
      error:
        "Tag was not found, is disabled, or belongs to another business.",
    };
  }

  const tag =
    tagData as TagResult;

  /*
   * Prefer the conversation ID sent by the inbox.
   * If it is missing, use the customer's most recent
   * conversation as a fallback.
   */
  let conversation:
    | ConversationResult
    | null = null;

  if (conversationId) {
    const {
      data,
      error,
    } = await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        business_id,
        contact_id
      `)
      .eq("id", conversationId)
      .eq("contact_id", contactId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load conversation: ${error.message}`,
      );
    }

    conversation =
      data as ConversationResult | null;
  } else {
    const {
      data,
      error,
    } = await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        business_id,
        contact_id
      `)
      .eq("contact_id", contactId)
      .eq("business_id", businessId)
      .order("last_message_at", {
        ascending: false,
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Unable to load customer conversation: ${error.message}`,
      );
    }

    conversation =
      data as ConversationResult | null;
  }

  if (!conversation) {
    return {
      success: false as const,
      status: 404,
      error:
        "A matching conversation was not found for this customer.",
    };
  }

  return {
    success: true as const,
    contact,
    tag,
    conversation,
  };
}

/*
 * Add tag
 */
export async function POST(
  request: NextRequest,
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

  const { contactId } =
    await context.params;

  if (!contactId?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "Customer ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  let body: TagBody;

  try {
    body =
      (await request.json()) as TagBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const tagId =
    body.tagId?.trim();

  const conversationId =
    body.conversationId?.trim() ||
    null;

  if (!tagId) {
    return NextResponse.json(
      {
        success: false,
        error: "tagId is required.",
      },
      {
        status: 400,
      },
    );
  }

  let contextResult;

  try {
    contextResult =
      await loadTagContext({
        contactId,
        tagId,
        conversationId,
        businessId:
          currentMember.business_id,
      });
  } catch (loadError) {
    console.error(
      "Unable to load tag context:",
      loadError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          loadError instanceof Error
            ? loadError.message
            : "Unable to load tag information.",
      },
      {
        status: 500,
      },
    );
  }

  if (!contextResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: contextResult.error,
      },
      {
        status: contextResult.status,
      },
    );
  }

  const {
    contact,
    tag,
    conversation,
  } = contextResult;

  /*
   * Avoid duplicate activity when the customer
   * already has this tag.
   */
  const {
    data: existingTag,
    error: existingError,
  } = await supabaseAdmin
    .from("contact_tags")
    .select("contact_id,tag_id")
    .eq("contact_id", contact.id)
    .eq("tag_id", tag.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to check the current customer tags.",
        details:
          existingError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (existingTag) {
    return NextResponse.json({
      success: true,
      activityRecorded: false,
      message:
        "The customer already has this tag.",
    });
  }

  const { error: insertError } =
    await supabaseAdmin
      .from("contact_tags")
      .insert({
        contact_id: contact.id,
        tag_id: tag.id,
      });

  if (insertError) {
    console.error(
      "Unable to assign tag:",
      insertError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to assign tag to customer.",
        details:
          insertError.message,
      },
      {
        status: 500,
      },
    );
  }

  const customerName =
    contact.full_name?.trim() ||
    "Facebook customer";

  let activityRecorded = false;

  try {
    await createConversationActivity({
      businessId:
        currentMember.business_id,

      conversationId:
        conversation.id,

      contactId:
        contact.id,

      actorMemberId:
        currentMember.id,

      activityType:
        "tag_added",

      title:
        `added tag "${tag.name}"`,

      description:
        `${currentMember.full_name} added the "${tag.name}" tag to ${customerName}.`,

      customerName,

      actorName:
        currentMember.full_name,

      actorProfilePictureUrl:
        currentMember.profile_picture_url,

      metadata: {
        action: "added",

        tag: {
          id: tag.id,
          name: tag.name,
          color: tag.color,
        },

        actor: {
          memberId:
            currentMember.id,
          name:
            currentMember.full_name,
          role:
            currentMember.role,
        },
      },
    });

    activityRecorded = true;
  } catch (activityError) {
    console.error(
      "Tag was added, but activity could not be recorded:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    tag,
    activityRecorded,
  });
}

