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
  sendTelegramAnimation,
  sendTelegramAudio,
  sendTelegramDocument,
  sendTelegramVideo,
  sendTelegramVoice,
} from "@/lib/telegram/telegram-api";
import {
  deleteTelegramMessageMedia,
  inferTelegramMediaContentType,
  inferTelegramVideoContentType,
  saveTelegramMessageMedia,
  TENH_TELEGRAM_OUTGOING_MEDIA_MAX_BYTES,
  type TelegramStoredMediaKind,
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

type OutgoingTelegramMediaKind =
  | "animation"
  | "video"
  | "file"
  | "audio"
  | "voice";

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

function normalizedMimeType(
  file: File,
) {
  return (
    file.type
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ||
    ""
  );
}

function lowerExtension(
  fileName: string,
) {
  const match =
    fileName
      .toLowerCase()
      .match(
        /\.([a-z0-9]+)$/,
      );

  return match?.[1] ?? "";
}

function telegramVideoCompatible(
  file: File,
) {
  const mime =
    normalizedMimeType(
      file,
    );
  const extension =
    lowerExtension(
      file.name,
    );

  return (
    mime === "video/mp4" ||
    extension === "mp4"
  );
}


function telegramAnimationCompatible(
  file: File,
) {
  const mime =
    normalizedMimeType(
      file,
    );
  const extension =
    lowerExtension(
      file.name,
    );

  return (
    mime === "image/gif" ||
    extension === "gif"
  );
}

type RequestedAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "file"
  | null;

function telegramVoiceCompatible(
  file: File,
) {
  const mime =
    normalizedMimeType(
      file,
    );
  const extension =
    lowerExtension(
      file.name,
    );

  return (
    mime === "audio/ogg" ||
    mime === "audio/opus" ||
    mime === "audio/mpeg" ||
    mime === "audio/mp3" ||
    mime === "audio/mp4" ||
    mime === "audio/x-m4a" ||
    extension === "ogg" ||
    extension === "opus" ||
    extension === "mp3" ||
    extension === "m4a"
  );
}

function isRecordedVoiceUpload({
  file,
  requestedKind,
}: {
  file: File;
  requestedKind:
    RequestedAttachmentKind;
}) {
  const lowerName =
    file.name.toLowerCase();

  return (
    requestedKind === "voice" ||
    (
      requestedKind === "audio" &&
      lowerName.startsWith(
        "voice-message-",
      )
    )
  );
}

function classifyTelegramMedia({
  file,
  requestedKind,
}: {
  file: File;
  requestedKind:
    RequestedAttachmentKind;
}): OutgoingTelegramMediaKind {
  const mime =
    normalizedMimeType(
      file,
    );
  const extension =
    lowerExtension(
      file.name,
    );

  /*
   * ReplyBox selects GIF through the existing image picker. Telegram GIFs
   * should use sendAnimation rather than sendPhoto.
   */
  if (
    telegramAnimationCompatible(
      file,
    )
  ) {
    return "animation";
  }

  /*
   * A microphone recording from TENH is a VOICE intent even though the
   * ReplyBox historically labels recorded blobs as kind="audio".
   */
  if (
    isRecordedVoiceUpload({
      file,
      requestedKind,
    })
  ) {
    return "voice";
  }

  if (
    requestedKind ===
      "video" ||
    mime.startsWith(
      "video/",
    )
  ) {
    return "video";
  }

  /*
   * User-selected OGG/OPUS files are treated as Telegram voice notes.
   */
  if (
    mime === "audio/ogg" ||
    mime === "audio/opus" ||
    extension === "ogg" ||
    extension === "opus"
  ) {
    return "voice";
  }

  /*
   * User-selected MP3/M4A files are normal audio unless they came from
   * TENH's microphone recorder (handled above).
   */
  if (
    mime === "audio/mpeg" ||
    mime === "audio/mp3" ||
    mime === "audio/mp4" ||
    mime === "audio/x-m4a" ||
    extension === "mp3" ||
    extension === "m4a"
  ) {
    return "audio";
  }

  return "file";
}

function messageTextForMedia({
  kind,
  fileName,
}: {
  kind: OutgoingTelegramMediaKind;
  fileName: string;
}) {
  const cleanName =
    fileName.trim();

  if (kind === "animation") {
    return "Sent an animation";
  }

  if (kind === "voice") {
    return "Sent a voice message";
  }

  if (kind === "video") {
    return "Sent a video";
  }

  if (kind === "audio") {
    return cleanName
      ? `Sent audio: ${cleanName}`
      : "Sent an audio file";
  }

  return cleanName
    ? `Sent a file: ${cleanName}`
    : "Sent a file";
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
          "Invalid Telegram media upload request.",
      },
      { status: 400 },
    );
  }

  const conversationIdValue =
    formData.get(
      "conversationId",
    );
  const kindValue =
    formData.get("kind");
  const fileValue =
    formData.get("file");

  const requestedKind:
    RequestedAttachmentKind =
    typeof kindValue ===
      "string" &&
    [
      "image",
      "video",
      "audio",
      "voice",
      "file",
    ].includes(kindValue)
      ? (kindValue as RequestedAttachmentKind)
      : null;

  const conversationId =
    typeof conversationIdValue ===
    "string"
      ? conversationIdValue.trim()
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
          "A Telegram file is required.",
      },
      { status: 400 },
    );
  }

  const file = fileValue;

  if (
    file.size <= 0 ||
    file.size >
      TENH_TELEGRAM_OUTGOING_MEDIA_MAX_BYTES
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "For reliable Vercel delivery, TENH Telegram media uploads are currently limited to 4 MB each.",
      },
      { status: 400 },
    );
  }

  const fileMime =
    normalizedMimeType(
      file,
    );

  if (
    fileMime.startsWith(
      "image/",
    ) &&
    !telegramAnimationCompatible(
      file,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Use the Telegram photo endpoint for images.",
      },
      { status: 400 },
    );
  }

  if (
    (
      requestedKind ===
        "video" ||
      fileMime.startsWith(
        "video/",
      )
    ) &&
    !telegramVideoCompatible(
      file,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "TENH Telegram video currently supports MP4 video only. Please choose an .mp4 file.",
      },
      { status: 415 },
    );
  }

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

  const mediaKind =
    classifyTelegramMedia({
      file,
      requestedKind,
    });

  /*
   * Telegram can still use the native sendVoice API externally, while TENH
   * stores voice content with the existing canonical message_type = "audio".
   */
  const tenhMediaKind:
    TelegramStoredMediaKind =
    mediaKind === "voice"
      ? "audio"
      : mediaKind ===
          "animation"
        ? "video"
        : mediaKind;

  const tenhMessageType =
    mediaKind === "voice"
      ? "audio"
      : mediaKind ===
          "animation"
        ? "video"
        : mediaKind;

  /*
   * Do not silently turn a microphone recording into a Telegram document.
   * If the browser could only record WebM, return a clear error instead.
   * ReplyBox V3.11.7.3 prefers OGG/OPUS or M4A before WebM.
   */
  if (
    mediaKind === "voice" &&
    !telegramVoiceCompatible(
      file,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This browser recorded the voice note as WebM. Telegram native voice requires OGG/OPUS, MP3, or M4A. Refresh after installing V3.11.7.3 and record again.",
      },
      { status: 415 },
    );
  }

  let telegramMessage;

  try {
    if (
      mediaKind ===
      "animation"
    ) {
      telegramMessage =
        await sendTelegramAnimation({
          token: botToken,
          chatId,
          animation: file,
          fileName:
            file.name ||
            "tenh-animation.gif",
        });
    } else if (
      mediaKind === "video"
    ) {
      telegramMessage =
        await sendTelegramVideo({
          token: botToken,
          chatId,
          video: file,
          fileName:
            file.name ||
            "tenh-video.mp4",
        });
    } else if (
      mediaKind === "voice"
    ) {
      telegramMessage =
        await sendTelegramVoice({
          token: botToken,
          chatId,
          voice: file,
          fileName:
            file.name ||
            "tenh-voice.ogg",
        });
    } else if (
      mediaKind === "audio"
    ) {
      telegramMessage =
        await sendTelegramAudio({
          token: botToken,
          chatId,
          audio: file,
          fileName:
            file.name ||
            "tenh-audio.mp3",
        });
    } else {
      telegramMessage =
        await sendTelegramDocument({
          token: botToken,
          chatId,
          document: file,
          fileName:
            file.name ||
            "tenh-file",
        });
    }
  } catch (error) {
    console.error(
      "[Tenh Telegram] Outgoing animation/video/file/audio/voice send failed:",
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
            : "Telegram rejected the file.",
      },
      { status: 502 },
    );
  }

  const telegramMessageId =
    telegramMessage.message_id;

  if (
    !Number.isFinite(
      telegramMessageId,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram accepted the media but returned no message ID.",
      },
      { status: 502 },
    );
  }

  const platformMessageId =
    `telegram:${chatId}:${telegramMessageId}`;
  const sentAt =
    telegramMessageTime(
      telegramMessage.date,
    );
  const senderPlatformId =
    socialAccount
      .platform_account_id ??
    (telegramMessage.from?.id
      ? String(
          telegramMessage.from.id,
        )
      : "telegram-bot");

  const localMessageId =
    randomUUID();
  const messageText =
    messageTextForMedia({
      kind:
        mediaKind,
      fileName:
        file.name,
    });

  const contentType =
    mediaKind === "video"
      ? inferTelegramVideoContentType({
          providedContentType:
            fileMime,
          filePath:
            file.name,
        })
      : inferTelegramMediaContentType({
          providedContentType:
            fileMime,
          filePath:
            file.name,
        });

  let attachmentUrl:
    | string
    | null = null;
  let mediaSaved = false;
  let saveWarning:
    | string
    | null = null;

  try {
    const fileBytes =
      new Uint8Array(
        await file.arrayBuffer(),
      );

    const savedMedia =
      await saveTelegramMessageMedia({
        businessId:
          currentMember.business_id,
        messageId:
          localMessageId,
        bytes:
          fileBytes,
        contentType,
        mediaKind:
          tenhMediaKind,
      });

    attachmentUrl =
      savedMedia.attachmentUrl;
    mediaSaved = true;
  } catch (mediaError) {
    console.error(
      "[Tenh Telegram] Media sent but TENH storage failed:",
      mediaError,
    );

    saveWarning =
      "Telegram received the media, but TENH could not save a persistent local copy.";
  }

  const rawPayload = {
    ...telegramMessage,
    ...(mediaKind ===
      "animation"
      ? {
          tenh_animation: {
            format: "gif",
            source:
              "tenh",
          },
        }
      : {}),
    tenh_attachment: {
      type:
        mediaKind,
      tenh_message_type:
        tenhMessageType,
      name:
        file.name ||
        (mediaKind ===
        "voice"
          ? "Telegram voice message"
          : "Telegram file"),
      mime_type:
        contentType,
      size:
        file.size,
    },
  };

  const {
    data: savedMessageData,
    error: insertError,
  } =
    await supabaseAdmin
      .from("messages")
      .insert({
        id: localMessageId,
        business_id:
          currentMember.business_id,
        conversation_id:
          conversation.id,
        platform_message_id:
          platformMessageId,
        sender_platform_id:
          senderPlatformId,
        recipient_platform_id:
          chatId,
        direction: "outgoing",
        message_type:
          tenhMessageType,
        message_text:
          messageText,
        sent_by_member_id:
          currentMember.id,
        delivery_status: "sent",
        delivered_at: null,
        seen_at: null,
        attachment_url:
          attachmentUrl,
        is_echo: false,
        raw_payload:
          rawPayload,
        platform_created_at:
          sentAt,
      })
      .select("*")
      .single();

  if (insertError) {
    console.error(
      "[Tenh Telegram] Media was sent but local message save failed:",
      insertError,
    );

    if (mediaSaved) {
      await deleteTelegramMessageMedia({
        businessId:
          currentMember.business_id,
        messageId:
          localMessageId,
        mediaKind:
          tenhMediaKind,
      });
    }

    saveWarning =
      "Telegram received the media, but TENH could not save the local message row.";
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
            messageType: tenhMessageType,
            messageText,
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
      "[Tenh Telegram] Media was sent but conversation preview update failed:",
      conversationUpdateError,
    );

    saveWarning =
      saveWarning ??
      "Telegram received the media, but TENH could not update the conversation preview.";
  }

  console.info(
    "[Tenh Telegram] Outgoing Telegram media sent.",
    {
      conversationId:
        conversation.id,
      platformMessageId,
      mediaKind,
      sentByMemberId:
        currentMember.id,
      mediaSaved,
    },
  );

  return NextResponse.json({
    success: true,
    platform: "telegram",
    mediaKind,
    tenhMessageType,
    messageId:
      platformMessageId,
    message:
      savedMessageData ??
      undefined,
    warning:
      saveWarning,
  });
}
