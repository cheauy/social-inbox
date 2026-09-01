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
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/telegram/telegram-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendTelegramBody = {
  conversationId?: string;
  message?: string;
  replyToMessageId?: string;
};

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

type ReplyTargetRow = {
  id: string;
  conversation_id: string;
  platform_message_id: string;
  message_text: string | null;
  message_type: string | null;
};

function parseTelegramMessageNumber({
  platformMessageId,
  expectedChatId,
}: {
  platformMessageId: string;
  expectedChatId: string;
}) {
  const match =
    platformMessageId.match(
      /^telegram:([^:]+):(\d+)$/,
    );

  if (!match) return null;

  const [, chatId, messageId] =
    match;

  if (chatId !== expectedChatId) {
    return null;
  }

  const parsed = Number(messageId);

  return Number.isSafeInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

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

export async function POST(
  request: NextRequest,
) {
  let body: SendTelegramBody;

  try {
    body =
      (await request.json()) as
        SendTelegramBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const conversationId =
    body.conversationId?.trim();
  const message =
    body.message?.trim();

  const replyToMessageId =
    body.replyToMessageId?.trim() ||
    null;

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error: "Conversation ID is required.",
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

  if (!message) {
    return NextResponse.json(
      {
        success: false,
        error: "Message is required.",
      },
      { status: 400 },
    );
  }

  if (message.length > 4096) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram text messages cannot exceed 4,096 characters.",
      },
      { status: 400 },
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
        error: "Conversation was not found.",
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
    contact.platform !== "telegram"
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

  let replyTarget:
    | ReplyTargetRow
    | null = null;

  let replyToTelegramMessageId:
    | number
    | null = null;

  if (replyToMessageId) {
    const {
      data: replyTargetData,
      error: replyTargetError,
    } =
      await supabaseAdmin
        .from("messages")
        .select(
          "id,conversation_id,platform_message_id,message_text,message_type",
        )
        .eq("id", replyToMessageId)
        .eq(
          "business_id",
          currentMember.business_id,
        )
        .eq(
          "conversation_id",
          conversation.id,
        )
        .maybeSingle();

    if (replyTargetError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to load the Telegram reply target.",
          details:
            replyTargetError.message,
        },
        { status: 500 },
      );
    }

    replyTarget =
      replyTargetData as unknown as
        ReplyTargetRow | null;

    if (!replyTarget) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The selected Telegram reply target was not found.",
        },
        { status: 404 },
      );
    }

    replyToTelegramMessageId =
      parseTelegramMessageNumber({
        platformMessageId:
          replyTarget.platform_message_id,
        expectedChatId: chatId,
      });

    if (!replyToTelegramMessageId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The selected TENH message is not a valid Telegram reply target.",
        },
        { status: 400 },
      );
    }
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

  let telegramMessage;

  try {
    telegramMessage =
      await sendTelegramMessage({
        token: botToken,
        chatId,
        text: message,
        replyToMessageId:
          replyToTelegramMessageId,
      });
  } catch (error) {
    console.error(
      "[Tenh Telegram] Outgoing text send failed:",
      error instanceof Error
        ? error.message
        : "Unknown Telegram send error",
    );

    const telegramError =
      error instanceof TelegramApiError
        ? {
            method: error.method,
            errorCode:
              error.errorCode,
            retryAfter:
              error.retryAfter,
          }
        : null;

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Telegram rejected the message.",
        telegramError,
      },
      { status: 502 },
    );
  }

  const messageId =
    telegramMessage.message_id;

  if (
    !Number.isFinite(messageId)
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram accepted the send request but returned no message ID.",
      },
      { status: 502 },
    );
  }

  const platformMessageId =
    `telegram:${chatId}:${messageId}`;

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

  let saveWarning:
    | string
    | null = null;

  const {
    error: insertError,
  } =
    await supabaseAdmin
      .from("messages")
      .insert({
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
        message_type: "text",
        message_text: message,
        sent_by_member_id:
          currentMember.id,
        delivery_status: "sent",
        delivered_at: null,
        seen_at: null,
        attachment_url: null,
        is_echo: false,
        raw_payload: {
          ...telegramMessage,
          ...(replyTarget
            ? {
                tenh_reply: {
                  reply_to_local_message_id:
                    replyTarget.id,
                  reply_to_platform_message_id:
                    replyTarget.platform_message_id,
                  preview_text:
                    replyTarget.message_text,
                  preview_type:
                    replyTarget.message_type,
                },
              }
            : {}),
          tenh_delivery: {
            status:
              "accepted_by_telegram",
            accepted_at:
              sentAt,
          },
        },
        platform_created_at:
          sentAt,
      });

  if (insertError) {
    console.error(
      "[Tenh Telegram] Message was sent but local message save failed:",
      insertError,
    );

    /*
     * Telegram already received the message. Return success so the agent does
     * not retry and accidentally send the customer a duplicate message.
     */
    saveWarning =
      "Telegram sent the message, but TENH could not save the local message row.";
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
            messageType: "text",
            messageText: message,
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

  if (
    conversationUpdateError
  ) {
    console.error(
      "[Tenh Telegram] Message was sent but conversation preview update failed:",
      conversationUpdateError,
    );

    saveWarning =
      saveWarning ??
      "Telegram sent the message, but TENH could not update the conversation preview.";
  }

  console.info(
    "[Tenh Telegram] Outgoing text sent.",
    {
      conversationId:
        conversation.id,
      messageId:
        platformMessageId,
      sentByMemberId:
        currentMember.id,
    },
  );

  return NextResponse.json({
    success: true,
    platform: "telegram",
    messageId:
      platformMessageId,
    warning:
      saveWarning,
  });
}
