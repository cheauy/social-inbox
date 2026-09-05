import {
  randomUUID,
} from "crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getInboxConversationAccess,
} from "@/lib/inbox/get-inbox-resource-access";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  decryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  getConversationMessagePreview,
} from "@/lib/inbox/conversation-preview";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  sendTelegramMediaGroup,
  sendTelegramPhoto,
} from "@/lib/telegram/telegram-api";
import {
  deleteTelegramMessageMedia,
  inferTelegramPhotoContentType,
  saveTelegramMessageMedia,
  TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES,
} from "@/lib/telegram/telegram-message-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationRow = {
  id: string;
  business_id: string;
  platform: string | null;
  social_account_id: string | null;
  contact_id: string | null;
};

type ContactRow = {
  id: string;
  business_id: string;
  platform: string | null;
  platform_user_id: string;
};

type TelegramAccountRow = {
  id: string;
  business_id: string;
  platform: string;
  platform_account_id: string | null;
  is_active: boolean | null;
  telegram_token_status: string | null;
  telegram_bot_token_encrypted:
    | string
    | null;
};

function telegramMessageTime(
  timestamp: number | undefined,
) {
  if (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    timestamp > 0
  ) {
    return new Date(
      timestamp * 1000,
    ).toISOString();
  }

  return new Date().toISOString();
}

function isSupportedPhotoType(
  value: string,
) {
  return (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp"
  );
}

/*
 * Telegram puts photos and videos in the same album, so an agent sending both
 * gets one message rather than two. MP4 only, matching the single-video path --
 * Telegram plays other containers unreliably.
 */
function isSupportedAlbumVideoType(
  value: string,
) {
  return value === "video/mp4";
}

function isSupportedAlbumType(
  value: string,
) {
  return (
    isSupportedPhotoType(value) ||
    isSupportedAlbumVideoType(value)
  );
}

export async function POST(
  request: NextRequest,
) {
  let formData: FormData;

  try {
    formData =
      await request.formData();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid photo upload request.",
      },
      { status: 400 },
    );
  }

  const conversationIdValue =
    formData.get(
      "conversationId",
    );
  /*
   * "files" carries an album, "file" a single photo. Both are accepted so the
   * existing single-photo path keeps working unchanged.
   */
  const albumValues = formData
    .getAll("files")
    .filter(
      (value): value is File => value instanceof File,
    );
  const fileValue =
    albumValues.length > 0
      ? albumValues[0]
      : formData.get("file");

  const conversationId =
    typeof conversationIdValue ===
    "string"
      ? conversationIdValue.trim()
      : "";

  /*
   * The agent's typed message, carried as the album caption rather than sent
   * after it. Telegram caps a caption at 1024 characters; anything longer is
   * left for the composer to send as its own message, which is the only way it
   * can arrive at all.
   */
  const captionValue = formData.get(
    "caption",
  );
  const caption =
    typeof captionValue === "string"
      ? captionValue.trim().slice(0, 1024)
      : "";

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation ID is required.",
      },
      { status: 400 },
    );
  }

  const inboxAccess =
    await getInboxConversationAccess(conversationId);

  if (!inboxAccess.success) {
    return NextResponse.json(
      { success: false, error: inboxAccess.error },
      { status: inboxAccess.status },
    );
  }

  const currentMember = inboxAccess.member;

  if (
    !(await memberHasPermission(currentMember, "conversations", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to reply in this workspace.",
    );
  }

  if (!(fileValue instanceof File)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "A Telegram photo file is required.",
      },
      { status: 400 },
    );
  }

  const file = fileValue;

  /* One item for a single send, up to ten for an album. */
  const albumFiles =
    albumValues.length > 0 ? albumValues : [file];

  if (albumFiles.length > 10) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram albums hold up to 10 photos. Send the rest as a second album.",
      },
      { status: 400 },
    );
  }

  for (const albumFile of albumFiles) {
    const albumFileType = albumFile.type
      .split(";")[0]
      .trim()
      .toLowerCase();

    if (!isSupportedAlbumType(albumFileType)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A Telegram album can contain JPG, PNG or WEBP images and MP4 video.",
        },
        { status: 400 },
      );
    }

    if (
      albumFile.size <= 0 ||
      albumFile.size >
        TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "For reliable Vercel delivery, TENH Telegram photos are currently limited to 4 MB each.",
        },
        { status: 400 },
      );
    }
  }

  const fileType =
    file.type
      .split(";")[0]
      .trim()
      .toLowerCase();

  const {
    data: conversationData,
    error: conversationError,
  } =
    await supabaseAdmin
      .from("conversations")
      .select(
        [
          "id",
          "business_id",
          "platform",
          "social_account_id",
          "contact_id",
        ].join(","),
      )
      .eq(
        "id",
        conversationId,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle();

  if (conversationError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Telegram conversation.",
        details:
          conversationError.message,
      },
      { status: 500 },
    );
  }

  const conversation =
    conversationData as unknown as
      ConversationRow | null;

  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation was not found.",
      },
      { status: 404 },
    );
  }

  if (
    conversation.platform !==
    "telegram"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This conversation is not a Telegram conversation.",
      },
      { status: 400 },
    );
  }

  if (
    !conversation.contact_id ||
    !conversation.social_account_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram conversation routing information is incomplete.",
      },
      { status: 409 },
    );
  }

  const [
    contactResult,
    accountResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select(
        "id,business_id,platform,platform_user_id",
      )
      .eq(
        "id",
        conversation.contact_id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle(),

    supabaseAdmin
      .from("social_accounts")
      .select(
        [
          "id",
          "business_id",
          "platform",
          "platform_account_id",
          "is_active",
          "telegram_token_status",
          "telegram_bot_token_encrypted",
        ].join(","),
      )
      .eq(
        "id",
        conversation.social_account_id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle(),
  ]);

  if (contactResult.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Telegram customer.",
        details:
          contactResult.error.message,
      },
      { status: 500 },
    );
  }

  if (accountResult.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Telegram Bot connection.",
        details:
          accountResult.error.message,
      },
      { status: 500 },
    );
  }

  const contact =
    contactResult.data as unknown as
      ContactRow | null;
  const socialAccount =
    accountResult.data as unknown as
      TelegramAccountRow | null;

  if (
    !contact ||
    contact.platform !==
      "telegram"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram customer routing information was not found.",
      },
      { status: 404 },
    );
  }

  if (
    !socialAccount ||
    socialAccount.platform !==
      "telegram" ||
    socialAccount.is_active !== true ||
    socialAccount.telegram_token_status !==
      "verified" ||
    !socialAccount.telegram_bot_token_encrypted
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "A verified active Telegram Bot connection is required.",
      },
      { status: 409 },
    );
  }

  const chatId =
    contact.platform_user_id?.trim();

  if (!chatId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram customer chat ID is missing.",
      },
      { status: 409 },
    );
  }

  let botToken: string;

  try {
    botToken =
      decryptChannelCredential(
        socialAccount.telegram_bot_token_encrypted,
      );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "TENH could not decrypt the Telegram Bot credential.",
      },
      { status: 500 },
    );
  }

  let telegramMessages: Awaited<
    ReturnType<typeof sendTelegramMediaGroup>
  >;

  try {
    telegramMessages =
      albumFiles.length > 1
        ? await sendTelegramMediaGroup({
            token: botToken,
            chatId,
            files: albumFiles,
            caption,
          })
        : [
            await sendTelegramPhoto({
              token: botToken,
              chatId,
              photo: file,
              fileName:
                file.name || "tenh-photo.jpg",
            }),
          ];
  } catch (error) {
    console.error(
      "[Tenh Telegram] Outgoing photo send failed:",
      error instanceof Error
        ? error.message
        : "Unknown Telegram send error",
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Telegram rejected the photo.",
      },
      { status: 502 },
    );
  }

  const telegramMessage = telegramMessages[0];

  if (
    !Number.isFinite(telegramMessage.message_id)
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram accepted the photo but returned no message ID.",
      },
      { status: 502 },
    );
  }

  const senderPlatformId =
    socialAccount.platform_account_id ??
    (telegramMessage.from?.id
      ? String(telegramMessage.from.id)
      : "telegram-bot");

  const sentAt = telegramMessageTime(
    telegramMessage.date,
  );

  const platformMessageId = `telegram:${chatId}:${telegramMessage.message_id}`;

  let saveWarning: string | null = null;
  let savedMessageData: unknown = null;
  const savedMessages: unknown[] = [];

  /*
   * One row per photo. Telegram returns a message per album item, so an album
   * is stored exactly like six separate sends — the grouping is what the
   * customer sees, not how TENH keeps it. Anything Telegram did not return a
   * message for is skipped rather than guessed at.
   */
  for (
    let index = 0;
    index < telegramMessages.length;
    index += 1
  ) {
    const sentMessage = telegramMessages[index];
    const sentFile =
      albumFiles[index] ?? albumFiles[0];

    if (!Number.isFinite(sentMessage.message_id)) {
      continue;
    }

    const itemPlatformMessageId = `telegram:${chatId}:${sentMessage.message_id}`;
    const itemSentAt = telegramMessageTime(
      sentMessage.date,
    );
    const localMessageId = randomUUID();

    let attachmentUrl: string | null = null;
    let mediaSaved = false;

    try {
      const fileBytes = new Uint8Array(
        await sentFile.arrayBuffer(),
      );

      const contentType =
        inferTelegramPhotoContentType({
          providedContentType: sentFile.type
            .split(";")[0]
            .trim()
            .toLowerCase(),
          filePath: sentFile.name,
        });

      const savedMedia =
        await saveTelegramMessageMedia({
          businessId: currentMember.business_id,
          messageId: localMessageId,
          bytes: fileBytes,
          contentType,
        });

      attachmentUrl = savedMedia.attachmentUrl;
      mediaSaved = true;
    } catch (mediaError) {
      console.error(
        "[Tenh Telegram] Photo sent but TENH media storage failed:",
        mediaError,
      );

      saveWarning =
        "Telegram received the photo, but TENH could not save a persistent local image copy.";
    }

    const rawPayload = {
      ...sentMessage,
      tenh_attachment: {
        type: "image",
        name:
          sentFile.name || "Telegram photo",
        mime_type: sentFile.type
          .split(";")[0]
          .trim()
          .toLowerCase(),
        size: sentFile.size,
      },
    };

    const {
      data: insertedMessage,
      error: insertError,
    } = await supabaseAdmin
      .from("messages")
      .insert({
        id: localMessageId,
        business_id: currentMember.business_id,
        conversation_id: conversation.id,
        platform_message_id: itemPlatformMessageId,
        sender_platform_id: senderPlatformId,
        recipient_platform_id: chatId,
        direction: "outgoing",
        /*
         * Per file, not per request: an album can hold both now, and a video
         * saved as an image renders with the wrong player in the thread.
         */
        message_type: sentFile.type
          .toLowerCase()
          .startsWith("video/")
          ? "video"
          : "image",

        /*
         * The caption belongs to the first item, the way Telegram displays it.
         * The rest keep a plain label so the thread reads as one message with
         * text rather than the same sentence repeated under every photo.
         */
        message_text:
          index === 0 && caption
            ? caption
            : sentFile.type
                  .toLowerCase()
                  .startsWith("video/")
              ? "Sent a video"
              : "Sent a photo",
        sent_by_member_id: currentMember.id,
        delivery_status: "sent",
        delivered_at: null,
        seen_at: null,
        attachment_url: attachmentUrl,
        is_echo: false,
        raw_payload: rawPayload,
        platform_created_at: itemSentAt,
      })
      .select("*")
      .single();

    if (insertError) {
      console.error(
        "[Tenh Telegram] Photo was sent but local message save failed:",
        insertError,
      );

      if (mediaSaved) {
        await deleteTelegramMessageMedia({
          businessId: currentMember.business_id,
          messageId: localMessageId,
        });
      }

      saveWarning =
        "Telegram received the photo, but TENH could not save the local message row.";
      continue;
    }

    savedMessages.push(insertedMessage);

    if (!savedMessageData) {
      savedMessageData = insertedMessage;
    }
  }

  const {
    error: conversationUpdateError,
  } =
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          getConversationMessagePreview({
            direction: "outgoing",
            messageType: "image",
            messageText: "Sent a photo",
          }),
        last_message_at:
          sentAt,
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        conversation.id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

  if (conversationUpdateError) {
    console.error(
      "[Tenh Telegram] Photo was sent but conversation preview update failed:",
      conversationUpdateError,
    );

    saveWarning =
      saveWarning ??
      "Telegram received the photo, but TENH could not update the conversation preview.";
  }

  console.info(
    "[Tenh Telegram] Outgoing photo sent.",
    {
      conversationId:
        conversation.id,
      platformMessageId,
      sentByMemberId:
        currentMember.id,
      photos: telegramMessages.length,
      saved: savedMessages.length,
    },
  );

  return NextResponse.json({
    success: true,
    platform: "telegram",
    messageId:
      platformMessageId,
    /* First row for the existing single-photo callers. */
    message:
      savedMessageData ??
      undefined,
    /* Every row, so an album caller can reconcile all of its photos. */
    messages: savedMessages,
    warning:
      saveWarning,
  });
}
