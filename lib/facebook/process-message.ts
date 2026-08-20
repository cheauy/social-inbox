import "server-only";

import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import { getFacebookMessageContent } from "@/lib/facebook/get-message-content";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FacebookMessagingEvent } from "@/types/facebook";

function toIso(timestamp?: number) {
  return timestamp
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

type FacebookMessengerProfile = {
  id?: string;
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
  error?: {
    message?: string;
    code?: number;
    type?: string;
    fbtrace_id?: string;
  };
};

async function getFacebookMessengerCustomerName({
  pageId,
  customerId,
}: {
  pageId: string;
  customerId: string;
}) {
  let pageAccessToken: string | null = null;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (error) {
    console.warn(
      "[Tenh Facebook Message] No OAuth Page token for Messenger profile enrichment.",
      error,
    );

    return null;
  }

  try {
    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION ??
      "v26.0";

    const url =
      new URL(
        `https://graph.facebook.com/${graphVersion}/${customerId}`,
      );

    url.searchParams.set(
      "fields",
      "first_name,last_name,profile_pic",
    );

    const response =
      await fetch(
        url,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Authorization:
              `Bearer ${pageAccessToken}`,
          },
        },
      );

    const text =
      await response.text();

    let result:
      FacebookMessengerProfile = {};

    if (text.trim()) {
      try {
        result =
          JSON.parse(
            text,
          ) as FacebookMessengerProfile;
      } catch {
        console.warn(
          "[Tenh Facebook Message] Messenger profile enrichment returned invalid JSON.",
        );
      }
    }

    if (
      !response.ok ||
      result.error
    ) {
      console.warn(
        "[Tenh Facebook Message] Messenger profile enrichment failed but message will still be saved.",
        {
          status:
            response.status,
          error:
            result.error,
          pageId,
          customerId,
        },
      );

      return null;
    }

    const fullName =
      [
        result.first_name
          ?.trim(),
        result.last_name
          ?.trim(),
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

    if (!fullName) {
      return null;
    }

    return fullName;
  } catch (error) {
    console.warn(
      "[Tenh Facebook Message] Messenger profile enrichment request failed but message will still be saved.",
      error,
    );

    return null;
  }
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
   * Messenger webhook payloads normally contain the customer's PSID,
   * but not the customer's display name. Enrich incoming messages
   * with the Messenger User Profile API using this Page's access token.
   *
   * Best-effort only: a profile lookup failure must never block
   * the message from being saved.
   */
  const customerName =
    !isEcho
      ? await getFacebookMessengerCustomerName({
          pageId,
          customerId,
        })
      : null;

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

  if (customerName) {
    console.log(
      "[Tenh Facebook Message] Messenger customer profile enriched.",
      {
        pageId,
        customerId,
        customerName,
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