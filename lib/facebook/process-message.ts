import "server-only";

import { getFacebookMessageContent } from "@/lib/facebook/get-message-content";
import {
  getFacebookCustomerProfile,
} from "@/lib/facebook/get-facebook-customer-profile";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FacebookMessagingEvent } from "@/types/facebook";

function toIso(timestamp?: number) {
  return timestamp
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

export async function processFacebookMessage(
  event: FacebookMessagingEvent,
) {
  const messageId = event.message?.mid;
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;

  if (!messageId || !senderId || !recipientId) {
    return;
  }

  const isEcho = event.message?.is_echo === true;

  const pageId = isEcho ? senderId : recipientId;
  const customerId = isEcho ? recipientId : senderId;

  /*
   * V3.1.17 — multi-Page routing.
   * The incoming webhook Page ID is the source of truth. TENH validates it
   * against an active social_accounts row below instead of one env Page ID.
   */

  const content =
    getFacebookMessageContent(event);

  const { data: existingMessage } =
    await supabaseAdmin
      .from("messages")
      .select("id,attachment_url")
      .eq("platform_message_id", messageId)
      .maybeSingle();

  if (existingMessage) {
    if (
      isEcho &&
      content.attachmentUrl &&
      !existingMessage.attachment_url
    ) {
      await supabaseAdmin
        .from("messages")
        .update({
          message_type: content.messageType,
          message_text: content.messageText,
          attachment_url: content.attachmentUrl,
        })
        .eq("id", existingMessage.id);
    }

    return;
  }

  const { data: socialAccount, error: accountError } =
    await supabaseAdmin
      .from("social_accounts")
      .select("id,business_id")
      .eq("platform", "facebook")
      .eq("platform_account_id", pageId)
      .eq("is_active", true)
      .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!socialAccount) {
    throw new Error(
      `Facebook Page ${pageId} was not found in social_accounts.`,
    );
  }

  const messageTime = toIso(event.timestamp);

  const customerProfile =
    isEcho
      ? null
      : await getFacebookCustomerProfile({
          pageId,
          customerId,
          latestMessageId:
            messageId,
        });

  if (
    !isEcho &&
    !customerProfile?.fullName &&
    !customerProfile
      ?.profilePictureUrl &&
    customerProfile
      ?.permissionHint
  ) {
    console.warn(
      "[Tenh Facebook Profile] Profile not available from permitted APIs.",
      {
        customerId,
        pageId,
        errors:
          customerProfile
            .errors,
        permissionHint:
          customerProfile
            .permissionHint,
      },
    );
  }

  const contactPayload = {
    business_id:
      socialAccount.business_id,
    platform:
      "facebook",
    platform_user_id:
      customerId,
    last_contact_at:
      messageTime,
    updated_at:
      new Date().toISOString(),

    ...(customerProfile
      ?.fullName
      ? {
          full_name:
            customerProfile.fullName,
        }
      : {}),

    ...(customerProfile
      ?.profilePictureUrl
      ? {
          profile_picture_url:
            customerProfile.profilePictureUrl,
        }
      : {}),
  };

  const { data: contact, error: contactError } =
    await supabaseAdmin
      .from("contacts")
      .upsert(
        contactPayload,

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
        "Unable to create contact.",
    );
  }

  const { data: conversation, error: conversationError } =
    await supabaseAdmin
      .from("conversations")
      .upsert(
        {
          business_id: socialAccount.business_id,
          social_account_id: socialAccount.id,
          contact_id: contact.id,
          platform: "facebook",
          status: "open",
          updated_at: new Date().toISOString(),
        },
        {
          onConflict:
            "social_account_id,contact_id",
        },
      )
      .select("id,unread_count")
      .single();

  if (conversationError || !conversation) {
    throw new Error(
      conversationError?.message ??
        "Unable to create conversation.",
    );
  }

  const { error: messageError } =
    await supabaseAdmin.from("messages").insert({
      business_id: socialAccount.business_id,
      conversation_id: conversation.id,
      platform_message_id: messageId,
      sender_platform_id: senderId,
      recipient_platform_id: recipientId,
      direction: isEcho ? "outgoing" : "incoming",
      message_type: content.messageType,
      message_text: content.messageText,
      attachment_url: content.attachmentUrl,
      is_echo: isEcho,
      raw_payload: event,
      platform_created_at: messageTime,
    });

  if (messageError) {
    throw new Error(messageError.message);
  }

  const unreadCount = isEcho
    ? conversation.unread_count
    : conversation.unread_count + 1;

  const { error: updateError } =
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text: content.messageText,
        last_message_at: messageTime,
        unread_count: unreadCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

  if (updateError) {
    throw new Error(updateError.message);
  }
}