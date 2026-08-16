import "server-only";

import {
  downloadTelegramFile,
  getTelegramFile,
  getTelegramUserProfilePhotos,
} from "@/lib/telegram/telegram-api";
import type {
  TelegramPhotoSize,
} from "@/lib/telegram/types";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const TELEGRAM_AVATAR_BUCKET =
  "tenh-contact-avatars";

const MAX_AVATAR_BYTES =
  5 * 1024 * 1024;

export function telegramAvatarStoragePath({
  businessId,
  contactId,
}: {
  businessId: string;
  contactId: string;
}) {
  return `${businessId}/${contactId}/telegram-avatar`;
}

export function telegramAvatarProxyUrl(
  contactId: string,
) {
  return `/api/contacts/${encodeURIComponent(
    contactId,
  )}/telegram-avatar`;
}

function largestPhotoSize(
  sizes: TelegramPhotoSize[],
) {
  return [...sizes].sort(
    (first, second) => {
      const firstScore =
        first.file_size ??
        first.width * first.height;
      const secondScore =
        second.file_size ??
        second.width * second.height;

      return secondScore - firstScore;
    },
  )[0] ?? null;
}

function contentTypeFromTelegramFile({
  responseContentType,
  filePath,
}: {
  responseContentType:
    | string
    | null;
  filePath: string;
}) {
  const headerType =
    responseContentType
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ??
    "";

  /*
   * Telegram's Bot API docs explicitly warn that getFile/file download may
   * not preserve the original MIME type. Therefore application/octet-stream
   * is not a reason to reject a file that came from getUserProfilePhotos().
   */
  if (
    headerType.startsWith(
      "image/",
    )
  ) {
    return headerType;
  }

  const lowerPath =
    filePath.toLowerCase();

  if (
    lowerPath.endsWith(".png")
  ) {
    return "image/png";
  }

  if (
    lowerPath.endsWith(".webp")
  ) {
    return "image/webp";
  }

  /*
   * Telegram profile PhotoSize files are image content. JPEG is the normal
   * Bot API profile-photo representation and is the safe fallback when the
   * download endpoint returns application/octet-stream or no MIME header.
   */
  return "image/jpeg";
}

export async function syncTelegramContactProfilePhoto({
  token,
  userId,
  businessId,
  contactId,
}: {
  token: string;
  userId: number;
  businessId: string;
  contactId: string;
}) {
  const profilePhotos =
    await getTelegramUserProfilePhotos({
      token,
      userId,
    });

  const latestPhotoSizes =
    profilePhotos.photos?.[0] ??
    [];

  const selectedPhoto =
    largestPhotoSize(
      latestPhotoSizes,
    );

  if (!selectedPhoto) {
    return {
      synced: false,
      reason: "no_profile_photo",
      totalCount:
        profilePhotos.total_count ??
        0,
    };
  }

  const file =
    await getTelegramFile({
      token,
      fileId:
        selectedPhoto.file_id,
    });

  if (!file.file_path) {
    return {
      synced: false,
      reason:
        "telegram_file_path_missing",
      totalCount:
        profilePhotos.total_count ??
        0,
    };
  }

  const downloadResponse =
    await downloadTelegramFile({
      token,
      filePath:
        file.file_path,
    });

  const contentType =
    contentTypeFromTelegramFile({
      responseContentType:
        downloadResponse.headers.get(
          "content-type",
        ),
      filePath:
        file.file_path,
    });

  const arrayBuffer =
    await downloadResponse
      .arrayBuffer();

  if (
    arrayBuffer.byteLength ===
    0
  ) {
    throw new Error(
      "Telegram profile image download was empty.",
    );
  }

  if (
    arrayBuffer.byteLength >
    MAX_AVATAR_BYTES
  ) {
    throw new Error(
      "Telegram profile image exceeds TENH's 5 MB avatar limit.",
    );
  }

  const storagePath =
    telegramAvatarStoragePath({
      businessId,
      contactId,
    });

  const {
    error: uploadError,
  } =
    await supabaseAdmin.storage
      .from(
        TELEGRAM_AVATAR_BUCKET,
      )
      .upload(
        storagePath,
        Buffer.from(
          arrayBuffer,
        ),
        {
          contentType,
          cacheControl:
            "86400",
          upsert: true,
        },
      );

  if (uploadError) {
    throw new Error(
      `Unable to save Telegram profile image: ${uploadError.message}`,
    );
  }

  const profilePictureUrl =
    telegramAvatarProxyUrl(
      contactId,
    );

  const {
    data: updatedContact,
    error: contactUpdateError,
  } =
    await supabaseAdmin
      .from("contacts")
      .update({
        profile_picture_url:
          profilePictureUrl,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq(
        "business_id",
        businessId,
      )
      .eq(
        "platform",
        "telegram",
      )
      .select(
        "id,profile_picture_url",
      )
      .maybeSingle();

  if (contactUpdateError) {
    throw new Error(
      contactUpdateError.message,
    );
  }

  if (!updatedContact) {
    throw new Error(
      "Telegram contact was not found while saving its profile image.",
    );
  }

  return {
    synced: true,
    reason: "profile_photo_saved",
    profilePictureUrl,
    totalCount:
      profilePhotos.total_count ??
      0,
    bytes:
      arrayBuffer.byteLength,
    contentType,
  };
}
