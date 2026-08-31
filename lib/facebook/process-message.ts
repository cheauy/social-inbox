import "server-only";

import {
  getFacebookCustomerProfile,
} from "@/lib/facebook/get-facebook-customer-profile";
import { getFacebookMessageContent } from "@/lib/facebook/get-message-content";
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

  /*
   * V3.11.30.2 — Multi-Page incoming Messenger fix.
   *
   * Do NOT compare this Page to legacy FACEBOOK_PAGE_ID.
   * The webhook recipient is the authoritative Page for incoming
   * customer messages, and every active connected Page is resolved
   * from social_accounts below.
   */
  const pageId = isEcho ? senderId : recipientId;
  const customerId = isEcho ? recipientId : senderId;

  const { data: existingMessage, error: existingMessageError } =
    await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("platform_message_id", messageId)
      .maybeSingle();

  if (existingMessageError) {
    throw new Error(existingMessageError.message);
  }

  if (existingMessage) {
    return;
  }

  const { data: socialAccount, error: accountError } =
    await supabaseAdmin
      .from("social_accounts")
      .select("id,business_id,account_name")
      .eq("platform", "facebook")
      .eq("platform_account_id", pageId)
      .eq("is_active", true)
      .maybeSingle();

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!socialAccount) {
    throw new Error(
      `Active Facebook Page ${pageId} was not found in social_accounts.`,
    );
  }

  console.log(
    "[Tenh Facebook Message] Processing Messenger event.",
    {
      pageId,
      pageName: socialAccount.account_name ?? null,
      customerId,
      messageId,
      isEcho,
    },
  );

  const messageTime = toIso(event.timestamp);

  /*
   * Messenger webhook payloads normally contain the customer's PSID but not
   * a reliable display profile. The direct /{PSID} profile endpoint is not
   * available for every Meta app/customer combination, so use TENH's existing
   * Page-accessible message/conversation enrichment helper instead.
   *
   * Best-effort only: profile enrichment must never block message delivery.
   */
  const customerProfile =
    !isEcho
      ? await getFacebookCustomerProfile({
          pageId,
          customerId,
          latestMessageId: messageId,
        })
      : null;

  const customerName =
    customerProfile
      ?.fullName ??
    null;

  const customerProfilePictureUrl =
    customerProfile
      ?.profilePictureUrl ??
    null;

  /*
   * Match the working Facebook comment flow:
   * only write full_name when we actually have a real name.
   * This avoids overwriting an existing real customer name with null.
   */
  const contactPayload:
    Record<
      string,
      unknown
    > = {
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
  };

  if (customerName) {
    contactPayload.full_name =
      customerName;
  }

  if (customerProfilePictureUrl) {
    contactPayload.profile_picture_url =
      customerProfilePictureUrl;
  }

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

  if (
    customerName ||
    customerProfilePictureUrl
  ) {
    console.log(
      "[Tenh Facebook Message] Messenger customer profile enriched.",
      {
        pageId,
        customerId,
        customerName,
        hasProfilePicture:
          Boolean(
            customerProfilePictureUrl,
          ),
      },
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

  const content =
    getFacebookMessageContent(event);

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
    ? (conversation.unread_count ?? 0)
    : (conversation.unread_count ?? 0) + 1;

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