import "server-only";

import {
  randomUUID,
} from "crypto";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  downloadTelegramFile,
  getTelegramFile,
} from "@/lib/telegram/telegram-api";
import {
  inferTelegramMediaContentType,
  inferTelegramPhotoContentType,
  inferTelegramVideoContentType,
  saveTelegramMessageMedia,
  deleteTelegramMessageMedia,
  TELEGRAM_INCOMING_MEDIA_MAX_BYTES,
  type TelegramStoredMediaKind,
} from "@/lib/telegram/telegram-message-media";
import {
  syncTelegramContactProfilePhoto,
} from "@/lib/telegram/telegram-profile-photo";
import type {
  TelegramAudio,
  TelegramDocument,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramVideo,
  TelegramVoice,
} from "@/lib/telegram/types";

type TelegramSocialAccount = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
};

type IncomingTelegramMedia = {
  messageType:
    | "image"
    | "video"
    | "file"
    | "audio"
    | "voice";
  storageKind:
    TelegramStoredMediaKind;
  fileId: string;
  fileUniqueId:
    | string
    | null;
  fileName:
    | string
    | null;
  mimeType:
    | string
    | null;
  declaredSize:
    | number
    | null;
  duration:
    | number
    | null;
  telegramMediaKind?:
    | "photo"
    | "video"
    | "file"
    | "audio"
    | "voice";
  fallbackText: string;
};

function telegramMessageKey({
  chatId,
  messageId,
}: {
  chatId: number;
  messageId: number;
}) {
  return `telegram:${chatId}:${messageId}`;
}

function telegramDisplayName(
  update: TelegramUpdate,
) {
  const message = update.message;
  const sender = message?.from;

  const name = [
    sender?.first_name?.trim(),
    sender?.last_name?.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (name) {
    return name;
  }

  if (sender?.username?.trim()) {
    return `@${sender.username.trim()}`;
  }

  const chatName = [
    message?.chat.first_name?.trim(),
    message?.chat.last_name?.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (chatName) {
    return chatName;
  }

  if (message?.chat.username?.trim()) {
    return `@${message.chat.username.trim()}`;
  }

  return "Telegram customer";
}

function largestTelegramPhoto(
  photos: TelegramPhotoSize[],
) {
  return [...photos].sort(
    (first, second) => {
      const firstScore =
        first.file_size ??
        first.width * first.height;
      const secondScore =
        second.file_size ??
        second.width * second.height;

      return (
        secondScore - firstScore
      );
    },
  )[0] ?? null;
}

function fileFallbackText(
  fileName:
    | string
    | undefined,
) {
  const clean =
    fileName?.trim();

  return clean
    ? `Sent a file: ${clean}`
    : "Sent a file";
}

function audioFallbackText(
  audio: TelegramAudio,
) {
  const display =
    audio.title?.trim() ||
    audio.file_name?.trim();

  return display
    ? `Sent audio: ${display}`
    : "Sent an audio file";
}

function getIncomingTelegramMedia(
  update: TelegramUpdate,
): IncomingTelegramMedia | null {
  const message =
    update.message;

  if (!message) {
    return null;
  }

  const photos =
    message.photo ?? [];

  if (photos.length > 0) {
    const photo =
      largestTelegramPhoto(
        photos,
      );

    if (photo) {
      return {
        messageType:
          "image",
        storageKind:
          "photo",
        fileId:
          photo.file_id,
        fileUniqueId:
          photo.file_unique_id ??
          null,
        fileName:
          "Telegram photo",
        mimeType:
          null,
        declaredSize:
          photo.file_size ??
          null,
        duration:
          null,
        fallbackText:
          "Sent a photo",
      };
    }
  }

  const video:
    | TelegramVideo
    | undefined =
    message.video;

  if (video) {
    return {
      messageType:
        "video",
      storageKind:
        "video",
      telegramMediaKind:
        "video",
      fileId:
        video.file_id,
      fileUniqueId:
        video.file_unique_id ??
        null,
      fileName:
        video.file_name ??
        "Telegram video.mp4",
      mimeType:
        video.mime_type ??
        "video/mp4",
      declaredSize:
        video.file_size ??
        null,
      duration:
        video.duration ??
        null,
      fallbackText:
        "Sent a video",
    };
  }

  const voice:
    | TelegramVoice
    | undefined =
    message.voice;

  if (voice) {
    /*
     * TENH already uses "audio" as the canonical Inbox/database type for
     * voice messages. Keep Telegram's native voice subtype in raw_payload,
     * but store/render through the existing audio path.
     */
    return {
      messageType:
        "audio",
      storageKind:
        "audio",
      telegramMediaKind:
        "voice",
      fileId:
        voice.file_id,
      fileUniqueId:
        voice.file_unique_id ??
        null,
      fileName:
        "Telegram voice message",
      mimeType:
        voice.mime_type ??
        "audio/ogg",
      declaredSize:
        voice.file_size ??
        null,
      duration:
        voice.duration ??
        null,
      fallbackText:
        "Sent a voice message",
    };
  }

  const audio:
    | TelegramAudio
    | undefined =
    message.audio;

  if (audio) {
    return {
      messageType:
        "audio",
      storageKind:
        "audio",
      fileId:
        audio.file_id,
      fileUniqueId:
        audio.file_unique_id ??
        null,
      fileName:
        audio.file_name ??
        audio.title ??
        "Telegram audio",
      mimeType:
        audio.mime_type ??
        null,
      declaredSize:
        audio.file_size ??
        null,
      duration:
        audio.duration ??
        null,
      fallbackText:
        audioFallbackText(
          audio,
        ),
    };
  }

  const document:
    | TelegramDocument
    | undefined =
    message.document;

  if (document) {
    return {
      messageType:
        "file",
      storageKind:
        "file",
      fileId:
        document.file_id,
      fileUniqueId:
        document.file_unique_id ??
        null,
      fileName:
        document.file_name ??
        "Telegram file",
      mimeType:
        document.mime_type ??
        null,
      declaredSize:
        document.file_size ??
        null,
      duration:
        null,
      fallbackText:
        fileFallbackText(
          document.file_name,
        ),
    };
  }

  return null;
}

/*
 * Historical export name is kept so the existing Telegram webhook route does
 * not need to change.
 *
 * V3.11.8 accepts:
 * - text
 * - photo
 * - video
 * - document/general file
 * - Telegram audio
 * - Telegram voice note
 */
export async function processTelegramIncomingText({
  update,
  socialAccount,
  botToken,
}: {
  update: TelegramUpdate;
  socialAccount: TelegramSocialAccount;
  botToken?: string | null;
}) {
  const message = update.message;

  const incomingText =
    message?.text?.trim() ??
    "";

  const media =
    getIncomingTelegramMedia(
      update,
    );

  if (
    !message ||
    message.chat.type !== "private" ||
    message.from?.is_bot === true ||
    (!incomingText && !media)
  ) {
    return {
      saved: false,
      ignored: true,
    };
  }

  const customerId = String(
    message.from?.id ?? message.chat.id,
  );
  const botId =
    socialAccount.platform_account_id ??
    "telegram-bot";
  const messageTime = new Date(
    message.date * 1000,
  ).toISOString();
  const platformMessageId =
    telegramMessageKey({
      chatId: message.chat.id,
      messageId: message.message_id,
    });

  if (
    message.voice &&
    media
  ) {
    console.info(
      "[Tenh Telegram] Incoming voice note detected.",
      {
        platformMessageId,
        declaredSize:
          media.declaredSize,
        duration:
          media.duration,
        mimeType:
          media.mimeType,
      },
    );
  }

  const {
    data: existingMessage,
    error: existingMessageError,
  } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq(
      "business_id",
      socialAccount.business_id,
    )
    .eq(
      "platform_message_id",
      platformMessageId,
    )
    .maybeSingle();

  if (existingMessageError) {
    throw new Error(
      existingMessageError.message,
    );
  }

  if (existingMessage) {
    return {
      saved: false,
      duplicate: true,
    };
  }

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .upsert(
      {
        business_id:
          socialAccount.business_id,
        platform: "telegram",
        platform_user_id: customerId,
        full_name:
          telegramDisplayName(update),
        last_contact_at: messageTime,
        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "business_id,platform,platform_user_id",
      },
    )
    .select(
      "id,profile_picture_url",
    )
    .single();

  if (contactError || !contact) {
    throw new Error(
      contactError?.message ??
        "Unable to create Telegram contact.",
    );
  }

  if (
    botToken &&
    !contact.profile_picture_url &&
    message.from?.id
  ) {
    try {
      const avatarResult =
        await syncTelegramContactProfilePhoto({
          token: botToken,
          userId:
            message.from.id,
          businessId:
            socialAccount.business_id,
          contactId:
            contact.id,
        });

      console.info(
        "[Tenh Telegram] Customer avatar sync result:",
        {
          contactId:
            contact.id,
          synced:
            avatarResult.synced,
          reason:
            avatarResult.reason,
          totalCount:
            avatarResult.totalCount ??
            null,
        },
      );
    } catch (avatarError) {
      console.warn(
        "[Tenh Telegram] Customer avatar sync failed; message processing will continue.",
        avatarError instanceof Error
          ? avatarError.message
          : "Unknown Telegram avatar error",
      );
    }
  }

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .upsert(
      {
        business_id:
          socialAccount.business_id,
        social_account_id:
          socialAccount.id,
        contact_id: contact.id,
        platform: "telegram",
        status: "open",
        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "social_account_id,contact_id",
      },
    )
    .select("id,unread_count")
    .single();

  if (
    conversationError ||
    !conversation
  ) {
    throw new Error(
      conversationError?.message ??
        "Unable to create Telegram conversation.",
    );
  }

  const localMessageId =
    randomUUID();

  let attachmentUrl:
    | string
    | null = null;
  let attachmentMimeType:
    | string
    | null =
    media?.mimeType ??
    null;
  let attachmentSize:
    | number
    | null =
    media?.declaredSize ??
    null;
  let mediaSaved = false;

  if (
    media &&
    botToken
  ) {
    const tooLargeByMetadata =
      typeof media.declaredSize ===
        "number" &&
      media.declaredSize >
        TELEGRAM_INCOMING_MEDIA_MAX_BYTES;

    if (tooLargeByMetadata) {
      console.warn(
        "[Tenh Telegram] Incoming media exceeds Telegram getFile download limit; saving message without local media copy.",
        {
          platformMessageId,
          messageType:
            media.messageType,
          declaredSize:
            media.declaredSize,
        },
      );
    } else {
      try {
        const telegramFile =
          await getTelegramFile({
            token: botToken,
            fileId:
              media.fileId,
          });

        if (
          !telegramFile.file_path
        ) {
          throw new Error(
            "Telegram returned no file path for the incoming media.",
          );
        }

        const downloadResponse =
          await downloadTelegramFile({
            token: botToken,
            filePath:
              telegramFile.file_path,
          });

        const arrayBuffer =
          await downloadResponse.arrayBuffer();

        if (
          arrayBuffer.byteLength ===
          0
        ) {
          throw new Error(
            "Incoming Telegram media download was empty.",
          );
        }

        if (
          arrayBuffer.byteLength >
          TELEGRAM_INCOMING_MEDIA_MAX_BYTES
        ) {
          throw new Error(
            "Incoming Telegram media is larger than TENH's 20 MB Telegram download limit.",
          );
        }

        attachmentMimeType =
          media.messageType ===
          "image"
            ? inferTelegramPhotoContentType({
                providedContentType:
                  media.mimeType,
                responseContentType:
                  downloadResponse.headers.get(
                    "content-type",
                  ),
                filePath:
                  telegramFile.file_path,
              })
            : media.messageType ===
                "video"
              ? inferTelegramVideoContentType({
                  providedContentType:
                    media.mimeType,
                  responseContentType:
                    downloadResponse.headers.get(
                      "content-type",
                    ),
                  filePath:
                    telegramFile.file_path,
                })
              : inferTelegramMediaContentType({
                  providedContentType:
                    media.mimeType,
                  responseContentType:
                    downloadResponse.headers.get(
                      "content-type",
                    ),
                  filePath:
                    telegramFile.file_path,
                });

        attachmentSize =
          arrayBuffer.byteLength;

        const savedMedia =
          await saveTelegramMessageMedia({
            businessId:
              socialAccount.business_id,
            messageId:
              localMessageId,
            bytes:
              new Uint8Array(
                arrayBuffer,
              ),
            contentType:
              attachmentMimeType,
            mediaKind:
              media.storageKind,
          });

        attachmentUrl =
          savedMedia.attachmentUrl;
        mediaSaved = true;
      } catch (mediaError) {
        console.warn(
          "[Tenh Telegram] Incoming media sync failed; the message will still be saved.",
          mediaError instanceof Error
            ? mediaError.message
            : "Unknown Telegram media error",
        );
      }
    }
  }

  const messageText =
    media
      ? message.caption?.trim() ||
        media.fallbackText
      : incomingText;

  const rawPayload =
    media
      ? {
          ...update,
          tenh_attachment: {
            type:
              media.telegramMediaKind ??
              media.messageType,
            tenh_message_type:
              media.messageType,
            name:
              media.fileName,
            mime_type:
              attachmentMimeType,
            size:
              attachmentSize,
            telegram_file_id:
              media.fileId,
            telegram_file_unique_id:
              media.fileUniqueId,
            duration:
              media.duration,
          },
        }
      : update;

  const {
    error: messageError,
  } = await supabaseAdmin
    .from("messages")
    .insert({
      id: localMessageId,
      business_id:
        socialAccount.business_id,
      conversation_id:
        conversation.id,
      platform_message_id:
        platformMessageId,
      sender_platform_id:
        customerId,
      recipient_platform_id:
        botId,
      direction: "incoming",
      message_type:
        media?.messageType ??
        "text",
      message_text:
        messageText,
      attachment_url:
        attachmentUrl,
      is_echo: false,
      raw_payload:
        rawPayload,
      platform_created_at:
        messageTime,
    });

  if (messageError) {
    if (
      mediaSaved &&
      media
    ) {
      await deleteTelegramMessageMedia({
        businessId:
          socialAccount.business_id,
        messageId:
          localMessageId,
        mediaKind:
          media.storageKind,
      });
    }

    if (messageError.code === "23505") {
      return {
        saved: false,
        duplicate: true,
      };
    }

    throw new Error(
      messageError.message,
    );
  }

  const currentUnread =
    Number(conversation.unread_count) || 0;

  const {
    error: updateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      last_message_text:
        messageText,
      last_message_at:
        messageTime,
      unread_count:
        currentUnread + 1,
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", conversation.id);

  if (updateError) {
    throw new Error(
      updateError.message,
    );
  }

  return {
    saved: true,
    contactId: contact.id,
    conversationId:
      conversation.id,
    platformMessageId,
    messageType:
      media?.messageType ??
      "text",
    attachmentSaved:
      attachmentUrl !== null,
  };
}
