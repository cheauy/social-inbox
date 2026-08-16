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
import {
  TELEGRAM_MESSAGE_MEDIA_BUCKET,
  telegramMessageMediaStoragePath,
} from "@/lib/telegram/telegram-message-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    messageId: string;
  }>;
};

type MessageRow = {
  id: string;
  business_id: string;
  platform_message_id: string;
  message_type: string;
};

export async function GET(
  _request: NextRequest,
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
        status:
          authResult.status,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }

  const { messageId } =
    await context.params;

  if (!messageId?.trim()) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from("messages")
      .select(
        "id,business_id,platform_message_id,message_type",
      )
      .eq("id", messageId)
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "[TENH Media] Unable to load Telegram message:",
      error,
    );

    return new NextResponse(
      null,
      { status: 500 },
    );
  }

  const message =
    data as unknown as
      MessageRow | null;

  if (
    !message ||
    ![
      "image",
      "file",
      "audio",
      "voice",
    ].includes(
      message.message_type,
    ) ||
    !message.platform_message_id
      .startsWith("telegram:")
  ) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  const mediaKind =
    message.message_type ===
      "image"
      ? "photo"
      : message.message_type ===
          "audio"
        ? "audio"
        : message.message_type ===
            "voice"
          ? "voice"
          : "file";

  const storagePath =
    telegramMessageMediaStoragePath({
      businessId:
        authResult.member
          .business_id,
      messageId:
        message.id,
      mediaKind,
    });

  const {
    data: signed,
    error: signedError,
  } =
    await supabaseAdmin.storage
      .from(
        TELEGRAM_MESSAGE_MEDIA_BUCKET,
      )
      .createSignedUrl(
        storagePath,
        300,
      );

  if (
    signedError ||
    !signed?.signedUrl
  ) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  /*
   * Redirect instead of proxying the photo bytes through Vercel. The object
   * stays private and the generated Supabase URL expires after five minutes.
   */
  return NextResponse.redirect(
    signed.signedUrl,
    307,
  );
}
