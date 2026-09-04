import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  decryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  deleteTelegramMessage,
  editTelegramMessageText,
  TelegramApiError,
} from "@/lib/telegram/telegram-api";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

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
  conversation_id: string;
  platform_message_id: string;
  direction: string;
  message_type: string;
  message_text: string | null;
  raw_payload:
    | Record<string, unknown>
    | null;
  platform_created_at:
    | string
    | null;
};

type AccountRow = {
  platform: string;
  is_active: boolean | null;
  telegram_token_status:
    | string
    | null;
  telegram_bot_token_encrypted:
    | string
    | null;
};

function jsonError(
  error: string,
  status: number,
  telegramError?:
    | {
        method: string;
        errorCode:
          | number
          | null;
        retryAfter:
          | number
          | null;
      }
    | null,
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(telegramError
        ? { telegramError }
        : {}),
    },
    { status },
  );
}

function parsePlatformId(
  value: string,
) {
  const match =
    value.match(
      /^telegram:([^:]+):(\d+)$/,
    );

  if (!match) {
    return null;
  }

  const messageId =
    Number(match[2]);

  if (
    !Number.isSafeInteger(
      messageId,
    ) ||
    messageId <= 0
  ) {
    return null;
  }

  return {
    chatId: match[1],
    messageId,
  };
}

async function loadContext({
  localMessageId,
  businessId,
}: {
  localMessageId: string;
  businessId: string;
}) {
  const {
    data: messageData,
    error: messageError,
  } =
    await supabaseAdmin
      .from("messages")
      .select(
        "id,business_id,conversation_id,platform_message_id,direction,message_type,message_text,raw_payload,platform_created_at",
      )
      .eq(
        "id",
        localMessageId,
      )
      .eq(
        "business_id",
        businessId,
      )
      .maybeSingle();

  if (messageError) {
    throw new Error(
      messageError.message,
    );
  }

  const message =
    messageData as unknown as
      MessageRow | null;

  if (!message) {
    return null;
  }

  const {
    data: conversationData,
    error: conversationError,
  } =
    await supabaseAdmin
      .from("conversations")
      .select(
        "id,platform,social_account_id",
      )
      .eq(
        "id",
        message.conversation_id,
      )
      .eq(
        "business_id",
        businessId,
      )
      .maybeSingle();

  if (conversationError) {
    throw new Error(
      conversationError.message,
    );
  }

  const conversation =
    conversationData as unknown as
      | {
          id: string;
          platform:
            | string
            | null;
          social_account_id:
            | string
            | null;
        }
      | null;

  if (
    !conversation ||
    conversation.platform !==
      "telegram" ||
    !conversation.social_account_id
  ) {
    return null;
  }

  const {
    data: accountData,
    error: accountError,
  } =
    await supabaseAdmin
      .from("social_accounts")
      .select(
        "platform,is_active,telegram_token_status,telegram_bot_token_encrypted",
      )
      .eq(
        "id",
        conversation.social_account_id,
      )
      .eq(
        "business_id",
        businessId,
      )
      .maybeSingle();

  if (accountError) {
    throw new Error(
      accountError.message,
    );
  }

  const account =
    accountData as unknown as
      AccountRow | null;

  if (
    !account ||
    account.platform !==
      "telegram" ||
    account.is_active !== true ||
    account.telegram_token_status !==
      "verified" ||
    !account.telegram_bot_token_encrypted
  ) {
    return null;
  }

  const platform =
    parsePlatformId(
      message.platform_message_id,
    );

  if (!platform) {
    return null;
  }

  return {
    message,
    account,
    platform,
  };
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  if (
    !(await memberHasPermission(
      authResult.member,
      "conversations",
      "manage",
    ))
  ) {
    return jsonError(
      "You do not have permission to reply in this workspace.",
      403,
    );
  }

  const { messageId } =
    await context.params;

  let body: {
    text?: string;
  };

  try {
    body =
      (await request.json()) as {
        text?: string;
      };
  } catch {
    return jsonError(
      "Invalid JSON request.",
      400,
    );
  }

  const text =
    body.text?.trim() ?? "";

  if (!text) {
    return jsonError(
      "Edited message text is required.",
      400,
    );
  }

  if (text.length > 4096) {
    return jsonError(
      "Telegram text messages cannot exceed 4,096 characters.",
      400,
    );
  }

  let loaded;

  try {
    loaded =
      await loadContext({
        localMessageId: messageId,
        businessId:
          authResult.member
            .business_id,
      });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to load Telegram message.",
      500,
    );
  }

  if (!loaded) {
    return jsonError(
      "Telegram message was not found.",
      404,
    );
  }

  if (
    loaded.message.direction !==
      "outgoing" ||
    loaded.message.message_type !==
      "text"
  ) {
    return jsonError(
      "Only outgoing Telegram text messages can be edited.",
      400,
    );
  }

  if (
    Boolean(
      loaded.message.raw_payload
        ?.tenh_deleted,
    )
  ) {
    return jsonError(
      "Deleted Telegram messages cannot be edited.",
      409,
    );
  }

  let token: string;

  try {
    token =
      decryptChannelCredential(
        loaded.account
          .telegram_bot_token_encrypted!,
      );
  } catch {
    return jsonError(
      "TENH could not decrypt the Telegram Bot credential.",
      500,
    );
  }

  let editedMessage;

  try {
    editedMessage =
      await editTelegramMessageText({
        token,
        chatId:
          loaded.platform.chatId,
        messageId:
          loaded.platform.messageId,
        text,
      });
  } catch (error) {
    const telegramError =
      error instanceof TelegramApiError
        ? {
            method:
              error.method,
            errorCode:
              error.errorCode,
            retryAfter:
              error.retryAfter,
          }
        : null;

    return jsonError(
      error instanceof Error
        ? error.message
        : "Telegram rejected the edit.",
      502,
      telegramError,
    );
  }

  const editedAt =
    new Date().toISOString();

  const rawPayload = {
    ...(loaded.message
      .raw_payload ?? {}),
    ...editedMessage,
    tenh_edit: {
      source: "tenh",
      edited_at:
        editedAt,
      edited_by_member_id:
        authResult.member.id,
    },
  };

  const {
    error: updateError,
  } =
    await supabaseAdmin
      .from("messages")
      .update({
        message_text: text,
        raw_payload:
          rawPayload,
      })
      .eq(
        "id",
        loaded.message.id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      );

  if (updateError) {
    return jsonError(
      "Telegram edited the message, but TENH could not update the local copy.",
      500,
    );
  }

  if (
    loaded.message
      .platform_created_at
  ) {
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          text,
        updated_at:
          editedAt,
      })
      .eq(
        "id",
        loaded.message
          .conversation_id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .eq(
        "last_message_at",
        loaded.message
          .platform_created_at,
      );
  }

  return NextResponse.json({
    success: true,
    messageId:
      loaded.message.id,
    messageText:
      text,
    editedAt,
  });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  if (
    !(await memberHasPermission(
      authResult.member,
      "conversations",
      "manage",
    ))
  ) {
    return jsonError(
      "You do not have permission to reply in this workspace.",
      403,
    );
  }

  const { messageId } =
    await context.params;

  let loaded;

  try {
    loaded =
      await loadContext({
        localMessageId: messageId,
        businessId:
          authResult.member
            .business_id,
      });
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to load Telegram message.",
      500,
    );
  }

  if (!loaded) {
    return jsonError(
      "Telegram message was not found.",
      404,
    );
  }

  /*
   * Every message type can be deleted. Telegram's deleteMessage does not
   * care what the message contains, and the row is marked deleted the same
   * way afterwards, so the old text-only limit only stopped agents removing
   * the photos and files they most often send by mistake.
   */

  /*
   * Already gone is a success, not an error. One click can now fan out to
   * several deletes -- an album, or a retry after a partial failure -- and
   * asking Telegram to remove a message it has already removed answers with
   * a 400 that would surface as a failure for work that is in fact done.
   */
  if (
    Boolean(
      loaded.message.raw_payload
        ?.tenh_deleted,
    )
  ) {
    return NextResponse.json({
      success: true,
      messageId:
        loaded.message.id,
      deletedAt:
        (
          loaded.message
            .raw_payload
            ?.tenh_deleted as {
            deleted_at?: string;
          } | null
        )?.deleted_at ??
        new Date().toISOString(),
      alreadyDeleted: true,
    });
  }

  let token: string;

  try {
    token =
      decryptChannelCredential(
        loaded.account
          .telegram_bot_token_encrypted!,
      );
  } catch {
    return jsonError(
      "TENH could not decrypt the Telegram Bot credential.",
      500,
    );
  }

  try {
    await deleteTelegramMessage({
      token,
      chatId:
        loaded.platform.chatId,
      messageId:
        loaded.platform.messageId,
    });
  } catch (error) {
    /*
     * Telegram saying it cannot FIND the message means someone already
     * removed it there -- on a phone, or by an earlier attempt whose local
     * write failed. The chat is in the state the agent asked for, so carry on
     * and mark the local row instead of reporting a failure they cannot act
     * on.
     *
     * "can't be deleted" is deliberately not in here. That one means the
     * message is still sitting in the customer's chat, past the window
     * Telegram allows, and the agent has to know it is still visible.
     */
    const alreadyGone =
      error instanceof Error &&
      /message to delete not found/i.test(
        error.message,
      );

    if (!alreadyGone) {
      const telegramError =
        error instanceof TelegramApiError
          ? {
              method:
                error.method,
              errorCode:
                error.errorCode,
              retryAfter:
                error.retryAfter,
            }
          : null;

      return jsonError(
        error instanceof Error
          ? error.message
          : "Telegram rejected the delete.",
        502,
        telegramError,
      );
    }
  }

  const deletedAt =
    new Date().toISOString();

  const rawPayload = {
    ...(loaded.message
      .raw_payload ?? {}),
    tenh_deleted: {
      source: "tenh",
      deleted_at:
        deletedAt,
      deleted_by_member_id:
        authResult.member.id,
    },
  };

  const {
    error: updateError,
  } =
    await supabaseAdmin
      .from("messages")
      .update({
        message_text:
          "Message deleted",
        /*
         * Drop the media with the message. A deleted photo, video, voice note
         * or file is gone from the chat, so the row must stop pointing at the
         * stored copy -- otherwise anything reading the row straight from the
         * database, now or later, can still hand the file back.
         */
        attachment_url: null,
        raw_payload:
          rawPayload,
      })
      .eq(
        "id",
        loaded.message.id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      );

  if (updateError) {
    return jsonError(
      "Telegram deleted the message, but TENH could not mark the local copy deleted.",
      500,
    );
  }

  if (
    loaded.message
      .platform_created_at
  ) {
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          "Message deleted",
        updated_at:
          deletedAt,
      })
      .eq(
        "id",
        loaded.message
          .conversation_id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .eq(
        "last_message_at",
        loaded.message
          .platform_created_at,
      );
  }

  return NextResponse.json({
    success: true,
    messageId:
      loaded.message.id,
    deletedAt,
  });
}
