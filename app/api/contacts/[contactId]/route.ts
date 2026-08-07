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

type UpdateContactBody = {
  conversationId?: string;
  phone?: string | null;
  address?: string | null;
  customerNote?: string | null;
};

type ContactResult = {
  id: string;
  business_id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  customer_note: string | null;
  updated_at: string | null;
};

type ConversationResult = {
  id: string;
  business_id: string;
  contact_id: string | null;
};

type ChangedField = {
  field:
    | "phone"
    | "address"
    | "customer_note";

  label: string;
  oldValue: string | null;
  newValue: string | null;
};

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : "";

  return normalized || null;
}

function valuesAreEqual(
  first: string | null,
  second: string | null,
): boolean {
  return (
    (first ?? "").trim() ===
    (second ?? "").trim()
  );
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  /*
   * 1. Authenticate the logged-in member.
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

  const { contactId } =
    await context.params;

  if (!contactId?.trim()) {
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
   * 2. Parse the request body.
   */
  let body: UpdateContactBody;

  try {
    body =
      (await request.json()) as UpdateContactBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const conversationId =
    body.conversationId?.trim();

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * 3. Load the customer before using
   * contactData or contact.
   */
  const {
    data: contactData,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name,
      phone,
      address,
      customer_note,
      updated_at
    `)
    .eq("id", contactId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (contactError) {
    console.error(
      "Unable to load customer:",
      contactError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the customer.",
        details:
          contactError.message,
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
    contactData as ContactResult;

  /*
   * Preserve existing fields when they are not
   * included in the request body.
   */
  const nextPhone =
    body.phone === undefined
      ? contact.phone
      : normalizeOptionalText(
          body.phone,
        );

  const nextAddress =
    body.address === undefined
      ? contact.address
      : normalizeOptionalText(
          body.address,
        );

  const nextCustomerNote =
    body.customerNote === undefined
      ? contact.customer_note
      : normalizeOptionalText(
          body.customerNote,
        );

  /*
   * 4. Validate the submitted values.
   */
  if (
    nextPhone &&
    nextPhone.length > 50
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Phone number is too long.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    nextAddress &&
    nextAddress.length > 1000
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Address cannot contain more than 1,000 characters.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    nextCustomerNote &&
    nextCustomerNote.length > 5000
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer note cannot contain more than 5,000 characters.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * 5. Verify that the conversation belongs
   * to the customer and the current business.
   */
  const {
    data: conversationData,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id
    `)
    .eq("id", conversationId)
    .eq("contact_id", contact.id)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (conversationError) {
    console.error(
      "Unable to verify customer conversation:",
      conversationError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify the conversation.",
        details:
          conversationError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!conversationData) {
    return NextResponse.json(
      {
        success: false,
        error:
          "A matching conversation was not found for this customer.",
      },
      {
        status: 404,
      },
    );
  }

  const conversation =
    conversationData as ConversationResult;

  /*
   * 6. Determine which fields changed.
   */
  const changedFields: ChangedField[] =
    [];

  if (
    !valuesAreEqual(
      contact.phone,
      nextPhone,
    )
  ) {
    changedFields.push({
      field: "phone",
      label: "phone number",
      oldValue: contact.phone,
      newValue: nextPhone,
    });
  }

  if (
    !valuesAreEqual(
      contact.address,
      nextAddress,
    )
  ) {
    changedFields.push({
      field: "address",
      label: "address",
      oldValue: contact.address,
      newValue: nextAddress,
    });
  }

  if (
    !valuesAreEqual(
      contact.customer_note,
      nextCustomerNote,
    )
  ) {
    changedFields.push({
      field: "customer_note",
      label: "customer note",
      oldValue:
        contact.customer_note,
      newValue:
        nextCustomerNote,
    });
  }

  if (changedFields.length === 0) {
    return NextResponse.json({
      success: true,
      contact,
      changedFields: [],
      activityRecorded: false,
      message:
        "Customer profile was unchanged.",
    });
  }

  /*
   * 7. Update the customer.
   */
  const now =
    new Date().toISOString();

  const {
    data: updatedContact,
    error: updateError,
  } = await supabaseAdmin
    .from("contacts")
    .update({
      phone: nextPhone,
      address: nextAddress,
      customer_note:
        nextCustomerNote,
      updated_at: now,
    })
    .eq("id", contact.id)
    .eq(
      "business_id",
      currentMember.business_id,
    )
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
      updated_at
    `)
    .maybeSingle();

  if (updateError) {
    console.error(
      "Unable to update customer profile:",
      updateError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to update the customer profile.",
        details:
          updateError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!updatedContact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found or could not be updated.",
      },
      {
        status: 404,
      },
    );
  }

  /*
   * 8. Build the activity message.
   */
  const customerName =
    contact.full_name?.trim() ||
    "Facebook customer";

  const changedLabels =
    changedFields.map(
      (item) => item.label,
    );

  const title =
    changedLabels.length === 1
      ? `updated customer ${changedLabels[0]}`
      : "updated customer profile";

  const description =
    changedLabels.length === 1
      ? `${currentMember.full_name} updated ${customerName}'s ${changedLabels[0]}.`
      : `${currentMember.full_name} updated ${customerName}'s profile: ${changedLabels.join(
          ", ",
        )}.`;

  /*
   * 9. Record the customer activity.
   */
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
        "customer_updated",

      title,
      description,
      customerName,

      actorName:
        currentMember.full_name,

      actorProfilePictureUrl:
        currentMember.profile_picture_url,

      metadata: {
        changedFields:
          changedFields.map(
            (field) => ({
              field: field.field,
              label: field.label,
              oldValue:
                field.oldValue,
              newValue:
                field.newValue,
            }),
          ),

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
      "Customer was updated, but activity could not be recorded:",
      activityError,
    );
  }

  return NextResponse.json({
    success: true,
    contact: updatedContact,
    changedFields,
    activityRecorded,
  });
}