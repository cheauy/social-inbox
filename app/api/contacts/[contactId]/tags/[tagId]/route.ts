import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    contactId: string;
    tagId: string;
  }>;
};

export async function DELETE(
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

  const member =
    authResult.member;

  const {
    contactId,
    tagId,
  } = await context.params;

  const conversationId =
    request.nextUrl.searchParams.get(
      "conversationId",
    );

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name
    `)
    .eq("id", contactId)
    .eq(
      "business_id",
      member.business_id,
    )
    .single();

  if (contactError || !contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer not found.",
      },
      {
        status: 404,
      },
    );
  }

  const {
    data: tag,
    error: tagError,
  } = await supabaseAdmin
    .from("tags")
    .select(`
      id,
      name,
      color
    `)
    .eq("id", tagId)
    .eq(
      "business_id",
      member.business_id,
    )
    .single();

  if (tagError || !tag) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Tag not found.",
      },
      {
        status: 404,
      },
    );
  }

  const {
    error: deleteError,
  } = await supabaseAdmin
    .from("contact_tags")
    .delete()
    .eq("contact_id", contactId)
    .eq("tag_id", tagId);

  if (deleteError) {
    return NextResponse.json(
      {
        success: false,
        error:
          deleteError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (conversationId) {
    try {
      await createConversationActivity({
        businessId:
          member.business_id,

        conversationId,

        contactId,

        actorMemberId:
          member.id,

        activityType:
          "tag_removed",

        title: `removed tag "${tag.name}"`,

        description:
          `${member.full_name} removed "${tag.name}".`,

        customerName:
          contact.full_name ??
          "Facebook customer",

        actorName:
          member.full_name,

        actorProfilePictureUrl:
          member.profile_picture_url,

        metadata: {
          tag,
        },
      });
    } catch (error) {
      console.error(error);
    }
  }

  return NextResponse.json({
    success: true,
    tag,
    activityRecorded: true,
  });
}