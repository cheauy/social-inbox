import "server-only";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import type {
  TelegramUpdate,
} from "@/lib/telegram/types";

type TelegramSocialAccount = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
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

export async function processTelegramIncomingText({
  update,
  socialAccount,
}: {
  update: TelegramUpdate;
  socialAccount: TelegramSocialAccount;
}) {
  const message = update.message;

  if (
    !message ||
    message.chat.type !== "private" ||
    message.from?.is_bot === true ||
    !message.text
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
    .select("id")
    .single();

  if (contactError || !contact) {
    throw new Error(
      contactError?.message ??
        "Unable to create Telegram contact.",
    );
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

  const {
    error: messageError,
  } = await supabaseAdmin
    .from("messages")
    .insert({
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
      message_type: "text",
      message_text: message.text,
      attachment_url: null,
      is_echo: false,
      raw_payload: update,
      platform_created_at:
        messageTime,
    });

  if (messageError) {
    // A retry can race the duplicate pre-check. Treat the unique constraint as
    // an idempotent duplicate instead of failing Telegram's webhook delivery.
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
        message.text,
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
  };
}
