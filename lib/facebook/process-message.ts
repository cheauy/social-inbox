import { captureFacebookNativeReply } from "@/lib/facebook/capture-native-reply";
import { readFacebookBlock } from "@/lib/facebook/customer-block";
import "server-only";
import { saveDetectedCustomerPhone } from "@/lib/inbox/save-detected-customer-phone";

import {
  getFacebookCustomerProfile,
} from "@/lib/facebook/get-facebook-customer-profile";
import { getFacebookMessageContent } from "@/lib/facebook/get-message-content";
import {
  getConversationMessagePreview,
} from "@/lib/inbox/conversation-preview";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { syncFacebookContactProfilePhoto } from "@/lib/facebook/facebook-profile-photo";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FacebookMessagingEvent } from "@/types/facebook";

function toIso(timestamp?: number) {
  return timestamp
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
}

/*
 * Meta's own annotations, delivered as if the Page had typed them.
 *
 * Business Suite narrates itself into the thread -- "This chat was assigned to
 * Deaar through an automation.", "RA VE replied to an ad.", "You are
 * responding to a user comment to a post on your Page. View comment. (https://
 * facebook.com/story.php?...)". They arrive as ordinary echoes, so TENH stored
 * them as outgoing messages and drew them as blue bubbles the shop appeared to
 * have sent, one of them a wall of raw URL.
 *
 * There is no structural way to tell them apart. They carry is_echo like every
 * other echo, and while none of them has an app_id, neither do the 350
 * outgoing messages a person typed straight into Business Suite -- filtering on
 * that would hide real replies. The wording is the only reliable signal, and
 * these are a small fixed set of Meta's own strings.
 *
 * Matching is deliberately narrow: the full distinctive phrase, only on
 * echoes. A shop writing "replied to an ad" in a sentence of their own keeps
 * their message.
 */
const FACEBOOK_SYSTEM_NOTICE_PATTERNS = [
  /\bthrough an automation\.?$/i,
  /\breplied to an ad\.?$/i,
  /^you are responding to a user comment to a post on your page\b/i,
  /^this chat was assigned to\b/i,
];

function isFacebookSystemNotice(
  text: string | null | undefined,
) {
  const value =
    typeof text === "string" ? text.trim() : "";

  if (!value) {
    return false;
  }

  return FACEBOOK_SYSTEM_NOTICE_PATTERNS.some(
    (pattern) => pattern.test(value),
  );
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
   * Dropped rather than hidden. These are Meta's own interface notices, not
   * anything anyone wrote, so they do not belong in a message table at all --
   * storing them would keep them in conversation previews, unread counts and
   * every export, with a filter needed at each one.
   */
  if (
    isEcho &&
    isFacebookSystemNotice(event.message?.text)
  ) {
    return;
  }

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

  /*
   * V3.11.33 — Messenger receive fast path.
   *
   * Duplicate detection and connected-Page lookup are independent reads. Run
   * them together so a new customer message does not pay for two sequential
   * Supabase round trips before TENH can insert the Realtime message row.
   * This changes no authorization or message semantics; it only removes
   * avoidable latency from the webhook path.
   */
  const [existingMessageResult, socialAccountResult] = await Promise.all([
    supabaseAdmin
      .from("messages")
      .select("id")
      .eq("platform_message_id", messageId)
      .maybeSingle(),
    supabaseAdmin
      .from("social_accounts")
      .select("id,business_id,account_name")
      .eq("platform", "facebook")
      .eq("platform_account_id", pageId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const {
    data: existingMessage,
    error: existingMessageError,
  } = existingMessageResult;

  if (existingMessageError) {
    throw new Error(existingMessageError.message);
  }

  if (existingMessage) {
    return;
  }

  const {
    data: socialAccount,
    error: accountError,
  } = socialAccountResult;

  if (accountError) {
    throw new Error(accountError.message);
  }

  if (!socialAccount) {
    /*
     * A Page that is not (or no longer) connected to any TENH workspace is a
     * normal situation, not an error: Meta keeps delivering events for a
     * short time after a Page is disconnected. Skip quietly so the rest of
     * the webhook batch is unaffected.
     */
    console.warn(
      "[Tenh Facebook Message] Ignoring event for a Page that is not connected.",
      { pageId, messageId, isEcho },
    );
    return;
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
   * Start customer profile enrichment immediately, but do not wait for Meta
   * before saving the message. The messages INSERT is the Realtime fast path
   * for the Inbox and alert sound, so profile lookup must never block it.
   */
  const customerProfilePromise =
    !isEcho
      ? getFacebookCustomerProfile({
          pageId,
          customerId,
          latestMessageId: messageId,
        }).catch((error) => {
          console.warn(
            "[Tenh Facebook Message] Customer profile enrichment failed; message delivery continues.",
            error instanceof Error
              ? error.message
              : "Unknown profile enrichment error",
          );

          return null;
        })
      : Promise.resolve(null);

  /*
   * Upsert only the stable identity now. Existing name/photo values are not
   * overwritten because those optional columns are intentionally omitted.
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
      /* created_at tells a first message apart from every one after it. */
      .select("id,profile_picture_url,created_at")
      .single();

  if (contactError || !contact) {
    throw new Error(
      contactError?.message ??
        "Unable to create contact.",
    );
  }



  if (!isEcho) {
    const block = await readFacebookBlock({ businessId: socialAccount.business_id, socialAccountId: socialAccount.id, contactId: contact.id });
    if (block.state?.is_blocked) return; // Keep history; do not add new incoming messages after a confirmed Page block.
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

          /*
           * A Messenger message means this is a Messenger conversation.
           *
           * Comments and DMs from one customer share a conversation row, and
           * the comment path stamps source_type as "comment" on every comment.
           * Nothing ever stamped it back, so a customer who once commented was
           * treated as a comment thread forever -- attachments refused, and the
           * conversation left out of analytics counts. The flag now follows the
           * newest message, which is what the comment side already does.
           */
          source_type: "messenger",
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

  const nativeReply = await captureFacebookNativeReply(event, { businessId: socialAccount.business_id, conversationId: conversation.id, messageId });

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
      raw_payload: nativeReply ? { ...event, tenh_facebook_reply: nativeReply } : event,
      platform_created_at: messageTime,
    });

  if (messageError) {
    /*
     * 23505 = unique violation. A concurrent Meta retry already inserted this
     * exact platform_message_id between the existence check above and this
     * insert. The message is safely stored; do not fail the webhook for it.
     */
    if (messageError.code === "23505") {
      console.warn(
        "[Tenh Facebook Message] Duplicate Messenger event skipped.",
        { pageId, messageId },
      );
      return;
    }

    throw new Error(messageError.message);
  }

  await saveDetectedCustomerPhone({
    businessId: socialAccount.business_id, contactId: contact.id, conversationId: conversation.id,
    messageId, text: event.message?.text, incoming: !isEcho,
  });

  const unreadCount = isEcho
    ? (conversation.unread_count ?? 0)
    : (conversation.unread_count ?? 0) + 1;

  const { error: updateError } =
    await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          getConversationMessagePreview({
            direction: isEcho
              ? "outgoing"
              : "incoming",
            messageType:
              content.messageType,
            messageText:
              content.messageText,
          }),
        last_message_at: messageTime,
        unread_count: unreadCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const customerProfile =
    await customerProfilePromise;

  const customerName =
    customerProfile?.fullName ?? null;
  const customerProfilePictureUrl =
    customerProfile?.profilePictureUrl ?? null;

  if (customerName || customerProfilePictureUrl) {
    const profileUpdate:
      Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (customerName) {
      profileUpdate.full_name = customerName;
    }

    if (customerProfilePictureUrl && !contact.profile_picture_url?.includes("/facebook-avatar")) {
      profileUpdate.profile_picture_url =
        customerProfilePictureUrl;
    }

    const { error: profileUpdateError } =
      await supabaseAdmin
        .from("contacts")
        .update(profileUpdate)
        .eq("id", contact.id);

    if (profileUpdateError) {
      console.warn(
        "[Tenh Facebook Message] Message was saved, but customer profile update failed:",
        profileUpdateError.message,
      );
    } else {
      console.log(
        "[Tenh Facebook Message] Messenger customer profile enriched after Realtime message save.",
        {
          pageId,
          customerId,
          customerName,
          hasProfilePicture: Boolean(
            customerProfilePictureUrl,
          ),
        },
      );
    }
  }

  /*
   * Fetch the customer's photo, once, the first time they message.
   *
   * Meta does not put a photo in any payload the webhook already reads, so it
   * has to be asked for directly -- and its URL expires, so a copy is stored
   * rather than the link. Doing it here means the avatars an agent is actually
   * looking at stay current, and a customer who changes their picture is picked
   * up the next time they write.
   *
   * Deliberately last, and deliberately swallowed: the message is already
   * saved and delivered by this point, and a missing avatar must never cost a
   * customer their message. Echoes are skipped -- the Page is not a contact.
   */
  if (!isEcho) {
    const alreadyStored =
      typeof contact.profile_picture_url ===
        "string" &&
      contact.profile_picture_url.includes(
        "/facebook-avatar",
      );

    /*
     * Once per contact, on their first message.
     *
     * Meta refuses profile_pic for anyone without a role on the app until it
     * has Advanced Access, so while an app is in review this lookup fails for
     * every real customer. Attempting it on every message would spend a Graph
     * call per message, forever, to be told the same thing -- and that quota is
     * shared with sending.
     *
     * The first message is the one attempt worth making: it succeeds outright
     * once access is granted, and the backfill exists to sweep up everyone who
     * wrote before then.
     */
    const isFirstMessage =
      typeof contact.created_at === "string" &&
      Date.now() -
        new Date(
          contact.created_at,
        ).getTime() <
        30_000;

    if (!alreadyStored && isFirstMessage) {
      try {
        const pageAccessToken =
          await getFacebookPageAccessToken(
            pageId,
          );

        const avatarResult =
          await syncFacebookContactProfilePhoto({
            contactId: contact.id,
            businessId:
              socialAccount.business_id,
            customerId,
            pageAccessToken,
          });

        if (!avatarResult.stored) {
          console.log(
            "[Tenh Facebook Message] No customer avatar stored.",
            {
              customerId,
              reason: avatarResult.reason,
            },
          );
        }
      } catch (avatarError) {
        console.warn(
          "[Tenh Facebook Message] Avatar sync failed; message delivery is unaffected.",
          avatarError instanceof Error
            ? avatarError.message
            : avatarError,
        );
      }
    }
  }
}
