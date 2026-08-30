import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getInboxContactAccess } from "@/lib/inbox/get-inbox-resource-access";
import {
  TELEGRAM_AVATAR_BUCKET,
  telegramAvatarStoragePath,
} from "@/lib/telegram/telegram-profile-photo";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getInboxContactAccess((await context.params).contactId);

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status:
          authResult.status,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }

  const { contactId } =
    await context.params;

  if (!contactId?.trim()) {
    return new NextResponse(
      null,
      {
        status: 404,
      },
    );
  }

  const {
    data: contact,
    error: contactError,
  } =
    await supabaseAdmin
      .from("contacts")
      .select(
        "id,business_id,platform",
      )
      .eq(
        "id",
        contactId,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .eq(
        "platform",
        "telegram",
      )
      .maybeSingle();

  if (
    contactError ||
    !contact
  ) {
    return new NextResponse(
      null,
      {
        status: 404,
      },
    );
  }

  const storagePath =
    telegramAvatarStoragePath({
      businessId:
        authResult.member
          .business_id,
      contactId:
        contact.id,
    });

  const {
    data,
    error,
  } =
    await supabaseAdmin.storage
      .from(
        TELEGRAM_AVATAR_BUCKET,
      )
      .download(
        storagePath,
      );

  if (
    error ||
    !data
  ) {
    return new NextResponse(
      null,
      {
        status: 404,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }

  return new NextResponse(
    data,
    {
      status: 200,
      headers: {
        "Content-Type":
          data.type ||
          "image/jpeg",
        "Content-Length":
          String(
            data.size,
          ),
        /*
         * Private browser cache is allowed, but shared/proxy caches should not
         * publish a customer's Telegram profile photo.
         */
        "Cache-Control":
          "private, max-age=3600",
        "X-Content-Type-Options":
          "nosniff",
      },
    },
  );
}
