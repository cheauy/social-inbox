import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getInboxContactAccess } from "@/lib/inbox/get-inbox-resource-access";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  createConversationActivity,
} from "@/lib/inbox/create-conversation-activity";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

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
    await getInboxContactAccess((await context.params).contactId);

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  if (
    !(await memberHasPermission(currentMember, "customers", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to change customer tags.",
    );
  }

  const {
    contactId,
    tagId,
  } =
    await context.params;

  if (
    !contactId?.trim() ||
    !tagId?.trim()
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "contactId and tagId are required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    searchParams,
  } =
    new URL(
      request.url,
    );

  const conversationId =
    searchParams
      .get(
        "conversationId",
      )
      ?.trim() ??
    null;

  const [
    contactResult,
    tagResult,
  ] =
    await Promise.all([
      supabaseAdmin
        .from("contacts")
        .select(`
          id,
          business_id,
          full_name
        `)
        .eq(
          "id",
          contactId,
        )
        .eq(
          "business_id",
          currentMember.business_id,
        )
        .maybeSingle(),

      supabaseAdmin
        .from("tags")
        .select(`
          id,
          business_id,
          name,
          color
        `)
        .eq(
          "id",
          tagId,
        )
        .eq(
          "business_id",
          currentMember.business_id,
        )
        .maybeSingle(),
    ]);

  if (
    contactResult.error ||
    tagResult.error
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to validate the customer tag.",
        details:
          contactResult.error
            ?.message ??
          tagResult.error
            ?.message,
      },
      {
        status: 500,
      },
    );
  }

  if (
    !contactResult.data ||
    !tagResult.data
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer or tag was not found.",
      },
      {
        status: 404,
      },
    );
  }

  const contact =
    contactResult.data;

  const tag =
    tagResult.data;

  const {
    data:
      existingAssignment,
    error:
      assignmentError,
  } = await supabaseAdmin
    .from("contact_tags")
    .select(`
      contact_id,
      tag_id
    `)
    .eq(
      "contact_id",
      contactId,
    )
    .eq(
      "tag_id",
      tagId,
    )
    .maybeSingle();

  if (assignmentError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to check the current customer tags.",
        details:
          assignmentError.message,
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Idempotent delete:
   * clicking an already-removed tag still returns success.
   */
  if (!existingAssignment) {
    return NextResponse.json({
      success: true,
      tag,
      alreadyRemoved:
        true,
    });
  }

  const {
    error:
      deleteError,
  } = await supabaseAdmin
    .from("contact_tags")
    .delete()
    .eq(
      "contact_id",
      contactId,
    )
    .eq(
      "tag_id",
      tagId,
    );

  if (deleteError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to remove tag from customer.",
        details:
          deleteError.message,
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Activity logging is useful, but it must NEVER make a successful
   * tag removal look like a failed removal.
   */
  if (conversationId) {
    try {
      const {
        data:
          conversation,
      } = await supabaseAdmin
        .from(
          "conversations",
        )
        .select(`
          id,
          business_id,
          contact_id
        `)
        .eq(
          "id",
          conversationId,
        )
        .eq(
          "business_id",
          currentMember.business_id,
        )
        .eq(
          "contact_id",
          contactId,
        )
        .maybeSingle();

      if (conversation) {
        const customerName =
          contact.full_name
            ?.trim() ||
          "Facebook customer";

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
            "tag_removed",
          title:
            `removed tag "${tag.name}"`,
          description:
            `${currentMember.full_name} removed the "${tag.name}" tag from ${customerName}.`,
          customerName,
          actorName:
            currentMember.full_name,
          actorProfilePictureUrl:
            currentMember.profile_picture_url,
          metadata: {
            action:
              "removed",
            tag: {
              id:
                tag.id,
              name:
                tag.name,
              color:
                tag.color,
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
      }
    } catch (
      activityError
    ) {
      console.error(
        "[Tenh Tags V3.1.4] Tag removed but activity log failed:",
        activityError,
      );
    }
  }

  return NextResponse.json({
    success: true,
    tag,
  });
}
