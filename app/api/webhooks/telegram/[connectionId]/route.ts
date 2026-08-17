import {
  timingSafeEqual,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  decryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  processTelegramIncomingText,
} from "@/lib/telegram/process-message";
import type {
  TelegramUpdate,
} from "@/lib/telegram/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    connectionId: string;
  }>;
};

type TelegramWebhookConnectionRow = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  is_active: boolean | null;
  telegram_token_status: string | null;
  telegram_bot_token_encrypted:
    | string
    | null;
  telegram_webhook_secret_encrypted:
    | string
    | null;
  telegram_webhook_status:
    | string
    | null;
};

function safeSecretEqual(
  actual: string,
  expected: string,
) {
  const actualBuffer =
    Buffer.from(actual, "utf8");
  const expectedBuffer =
    Buffer.from(expected, "utf8");

  if (
    actualBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualBuffer,
    expectedBuffer,
  );
}

async function processTelegramEditedText({
  update,
  businessId,
}: {
  update: TelegramUpdate;
  businessId: string;
}) {
  const message =
    update.edited_message;

  if (
    !message ||
    message.chat.type !==
      "private" ||
    message.from?.is_bot ===
      true ||
    !message.text?.trim()
  ) {
    return {
      edited: false,
      ignored: true,
    };
  }

  const platformMessageId =
    `telegram:${String(
      message.chat.id,
    )}:${message.message_id}`;

  const {
    data: existingData,
    error: existingError,
  } =
    await supabaseAdmin
      .from("messages")
      .select(
        "id,conversation_id,message_type,raw_payload,platform_created_at",
      )
      .eq(
        "business_id",
        businessId,
      )
      .eq(
        "platform_message_id",
        platformMessageId,
      )
      .maybeSingle();

  if (existingError) {
    throw new Error(
      existingError.message,
    );
  }

  const existing =
    existingData as unknown as
      | {
          id: string;
          conversation_id: string;
          message_type: string;
          raw_payload:
            | Record<string, unknown>
            | null;
          platform_created_at:
            | string
            | null;
        }
      | null;

  if (!existing) {
    return {
      edited: false,
      ignored: true,
      reason:
        "message_not_found",
    };
  }

  if (
    existing.message_type !==
      "text"
  ) {
    return {
      edited: false,
      ignored: true,
      reason:
        "non_text_message",
    };
  }

  const nextText =
    message.text.trim();

  const editedAt =
    typeof message.edit_date ===
      "number" &&
    Number.isFinite(
      message.edit_date,
    )
      ? new Date(
          message.edit_date *
            1000,
        ).toISOString()
      : new Date().toISOString();

  const nextRawPayload = {
    ...(existing.raw_payload ??
      {}),
    ...update,
    tenh_edit: {
      source:
        "telegram",
      edited_at:
        editedAt,
    },
  };

  const {
    error: updateError,
  } =
    await supabaseAdmin
      .from("messages")
      .update({
        message_text:
          nextText,
        raw_payload:
          nextRawPayload,
      })
      .eq(
        "id",
        existing.id,
      )
      .eq(
        "business_id",
        businessId,
      );

  if (updateError) {
    throw new Error(
      updateError.message,
    );
  }

  if (
    existing.platform_created_at
  ) {
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          nextText,
        updated_at:
          editedAt,
      })
      .eq(
        "id",
        existing.conversation_id,
      )
      .eq(
        "business_id",
        businessId,
      )
      .eq(
        "last_message_at",
        existing.platform_created_at,
      );
  }

  return {
    edited: true,
    messageId:
      existing.id,
    messageText:
      nextText,
  };
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  const { connectionId } =
    await context.params;

  if (!connectionId?.trim()) {
    return NextResponse.json(
      {
        received: true,
        ignored: true,
      },
      { status: 200 },
    );
  }

  const {
    data: connection,
    error: connectionError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id,
      platform_account_id,
      is_active,
      telegram_token_status,
      telegram_bot_token_encrypted,
      telegram_webhook_secret_encrypted,
      telegram_webhook_status
    `)
    .eq("id", connectionId)
    .eq("platform", "telegram")
    .maybeSingle<TelegramWebhookConnectionRow>();

  if (connectionError) {
    console.error(
      "[Tenh Telegram Webhook] Connection lookup failed:",
      connectionError.message,
    );

    return NextResponse.json(
      { received: false },
      { status: 500 },
    );
  }

  // Return 200 for old/disabled URLs so Telegram does not keep retrying a
  // connection TENH no longer accepts.
  if (
    !connection ||
    connection.is_active !== true ||
    connection.telegram_token_status !==
      "verified" ||
    connection.telegram_webhook_status !==
      "active"
  ) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason: "inactive_connection",
    });
  }

  if (
    !connection.telegram_webhook_secret_encrypted
  ) {
    console.error(
      "[Tenh Telegram Webhook] Active webhook has no saved secret.",
    );

    return NextResponse.json(
      { received: false },
      { status: 503 },
    );
  }

  let expectedSecret: string;

  try {
    expectedSecret =
      decryptChannelCredential(
        connection.telegram_webhook_secret_encrypted,
      );
  } catch {
    console.error(
      "[Tenh Telegram Webhook] Unable to decrypt webhook secret.",
    );

    return NextResponse.json(
      { received: false },
      { status: 503 },
    );
  }

  const suppliedSecret =
    request.headers.get(
      "x-telegram-bot-api-secret-token",
    ) ?? "";

  if (
    !suppliedSecret ||
    !safeSecretEqual(
      suppliedSecret,
      expectedSecret,
    )
  ) {
    return NextResponse.json(
      {
        received: false,
        error:
          "Invalid Telegram webhook secret.",
      },
      { status: 401 },
    );
  }

  /*
   * Decrypt the Bot token only on the server. It is passed to the Telegram
   * message processor for avatar sync plus supported Telegram media download and is
   * never returned to the browser or saved inside profile_picture_url.
   */
  let botToken:
    | string
    | null = null;

  if (
    connection.telegram_bot_token_encrypted
  ) {
    try {
      botToken =
        decryptChannelCredential(
          connection.telegram_bot_token_encrypted,
        );
    } catch {
      console.warn(
        "[Tenh Telegram Webhook] Unable to decrypt Bot token for avatar/media sync. Incoming message processing will continue without downloadable media.",
      );
    }
  }

  let update: TelegramUpdate;

  try {
    update =
      (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json(
      {
        received: false,
        error:
          "Invalid Telegram update payload.",
      },
      { status: 400 },
    );
  }

  if (
    update.edited_message
  ) {
    try {
      const result =
        await processTelegramEditedText({
          update,
          businessId:
            connection.business_id,
        });

      return NextResponse.json({
        received: true,
        ...result,
      });
    } catch (error) {
      console.error(
        "[Tenh Telegram Webhook] Edited message processing failed:",
        error instanceof Error
          ? error.message
          : "Unknown edit processing error",
      );

      return NextResponse.json(
        {
          received: false,
          error:
            "Unable to process Telegram message edit.",
        },
        { status: 500 },
      );
    }
  }

  const message =
    update.message;

  if (!message) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason:
        "unsupported_update",
    });
  }

  if (
    message.chat.type !== "private" ||
    message.from?.is_bot === true
  ) {
    return NextResponse.json({
      received: true,
      ignored: true,
      reason: "non_private_message",
    });
  }

  console.info(
    "[Tenh Telegram Webhook] Private message received.",
    {
      connectionId:
        connection.id,
      messageId:
        message.message_id,
      hasText:
        Boolean(
          message.text?.trim(),
        ),
      hasPhoto:
        Boolean(
          message.photo?.length,
        ),
      hasDocument:
        Boolean(
          message.document,
        ),
      hasAudio:
        Boolean(
          message.audio,
        ),
      hasVoice:
        Boolean(
          message.voice,
        ),
      hasVideo:
        Boolean(
          message.video,
        ),
      hasAnimation:
        Boolean(
          message.animation,
        ),
      hasSticker:
        Boolean(
          message.sticker,
        ),
      hasLocation:
        Boolean(
          message.location,
        ),
    },
  );

  try {
    const result =
      await processTelegramIncomingText({
        update,
        socialAccount: {
          id: connection.id,
          business_id:
            connection.business_id,
          platform_account_id:
            connection.platform_account_id,
        },
        botToken,
      });

    return NextResponse.json({
      received: true,
      ...result,
    });
  } catch (error) {
    console.error(
      "[Tenh Telegram Webhook] Incoming message processing failed:",
      error instanceof Error
        ? error.message
        : "Unknown processing error",
    );

    // Non-2xx lets Telegram retry a temporary server/database failure.
    return NextResponse.json(
      {
        received: false,
        error:
          "Unable to process Telegram message.",
      },
      { status: 500 },
    );
  }
}
