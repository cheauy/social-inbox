import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type RouteContext = {
  params: Promise<{
    customerId: string;
    fileId: string;
  }>;
};

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

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

  const {
    customerId,
    fileId,
  } =
    await context.params;

  // Keep Next.js slug name consistent with /api/customers/[customerId].
  const contactId =
    customerId;

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq(
      "id",
      contactId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (
    contactError ||
    !contact
  ) {
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

  const {
    data: file,
    error: fileError,
  } = await supabaseAdmin
    .from("customer_files")
    .select(`
      id,
      item_type,
      storage_bucket,
      storage_path
    `)
    .eq(
      "id",
      fileId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      contactId,
    )
    .is(
      "deleted_at",
      null,
    )
    .maybeSingle();

  if (
    fileError ||
    !file
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer file or link was not found.",
      },
      {
        status: 404,
      },
    );
  }

  if (
    file.item_type ===
      "file" &&
    file.storage_bucket &&
    file.storage_path
  ) {
    const {
      error:
        removeError,
    } = await supabaseAdmin
      .storage
      .from(
        file.storage_bucket,
      )
      .remove([
        file.storage_path,
      ]);

    if (removeError) {
      console.error(
        "[Tenh Customer Files V2.18] Storage delete failed:",
        removeError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to delete the stored file.",
          details:
            removeError.message,
        },
        {
          status: 500,
        },
      );
    }
  }

  const {
    error:
      updateError,
  } = await supabaseAdmin
    .from("customer_files")
    .update({
      deleted_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      file.id,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      contactId,
    );

  if (updateError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The stored object was deleted, but TENH could not update the customer-file record.",
        details:
          updateError.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
  });
}
