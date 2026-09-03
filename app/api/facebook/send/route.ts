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
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  getConversationMessagePreview,
} from "@/lib/inbox/conversation-preview";
import {
  getFacebookMessengerReplyPolicy,
} from "@/lib/facebook/messenger-reply-policy";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendMessageBody = {
  conversationId?: string;
  recipientId?: string;
  message?: string;
};

type FacebookSendResult = {
  recipient_id?: string;
  message_id?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export async function POST(
  request: NextRequest,
) {
  /*
   * V2.14.1:
   * Authenticate the Tenh team member who is actually
   * sending this customer reply.
   */
  let body: SendMessageBody;

  try {
    body =
      (await request.json()) as
        SendMessageBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const conversationId =
    body.conversationId?.trim();
  const recipientId =
    body.recipientId?.trim();
  const message =
    body.message?.trim();

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "conversationId is required.",
      },
      {
        status: 400,
      },
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

  if (!recipientId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "recipientId is required.",
      },
      {
        status: 400,
      },
    );
  }

  if (!message) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Message cannot be empty.",
      },
      {
        status: 400,
      },
    );
  }

  if (message.length > 2000) {
    return NextResponse.json(
      {
        success: false,
        error: "Message is too long.",
      },
      {
        status: 400,
      },
    );
  }

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION
      ?.trim() ||
    "v26.0";

  /*
   * Confirm that the conversation belongs to the
   * logged-in member's business.
   */
  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id,
      social_account_id
    `)
    .eq("id", conversationId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (conversationError) {
    console.error(
      "Unable to load conversation:",
      conversationError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the conversation.",
      },
      {
        status: 500,
      },
    );
  }

  if (!conversation) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  /*
   * Security: recipientId comes from the client. Never trust it on its own.
   * The reply must go to the exact customer this conversation belongs to,
   * matching the guard already used by send-attachment and Telegram send.
   */
  if (!conversation.contact_id) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This conversation has no customer to reply to.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      platform,
      platform_user_id
    `)
    .eq("id", conversation.contact_id)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (contactError) {
    console.error(
      "Unable to load conversation contact before send:",
      contactError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify the customer for this conversation.",
      },
      {
        status: 500,
      },
    );
  }

  if (
    !contact ||
    contact.platform !== "facebook" ||
    !contact.platform_user_id ||
    contact.platform_user_id !== recipientId
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Recipient does not match the customer in this conversation.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: socialAccount,
    error: socialAccountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      platform,
      platform_account_id,
      is_active
    `)
    .eq(
      "id",
      conversation.social_account_id,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (socialAccountError) {
    console.error(
      "Unable to load social account:",
      socialAccountError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load the Facebook Page.",
        details:
          socialAccountError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!socialAccount) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Connected Facebook Page was not found.",
      },
      {
        status: 404,
      },
    );
  }

  if (
    socialAccount.platform !==
      "facebook" ||
    !socialAccount.is_active ||
    !socialAccount
      .platform_account_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The Facebook Page connection for this conversation is not active.",
      },
      {
        status: 400,
      },
    );
  }

  /*
   * V3.1.17 — route the reply through the exact Page that owns this
   * conversation. This allows several connected Facebook Pages in one TENH
   * workspace without relying on FACEBOOK_PAGE_ID.
   */
  const pageId =
    socialAccount
      .platform_account_id;

  let pageAccessToken: string;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (tokenError) {
    return NextResponse.json(
      {
        success: false,
        error:
          tokenError instanceof Error
            ? tokenError.message
            : "Unable to load the Facebook Page access token.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Safe Messenger reply-window policy.
   *
   * - one private reply after a Facebook comment, then wait for the customer
   * - 0–24h after a customer Messenger message: normal RESPONSE
   * - 24h–7d: HUMAN_AGENT for a real support agent only
   * - after 7d: block and wait for a new customer message
   */
  let messengerPolicy;

  try {
    messengerPolicy =
      await getFacebookMessengerReplyPolicy(
        conversationId,
      );
  } catch (policyError) {
    console.warn(
      "Unable to inspect the Facebook Messenger reply policy before send:",
      policyError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "TENH could not safely verify whether Facebook allows another message. Please try again.",
        code: "MESSENGER_POLICY_CHECK_FAILED",
      },
      { status: 503 },
    );
  }

  if (
    messengerPolicy.windowState ===
      "waiting_for_customer_reply"
  ) {
    return NextResponse.json(
      {
        success: false,
        code: "WAITING_FOR_CUSTOMER_REPLY",
        error:
          "Waiting for customer reply. Meta allows only one private Messenger reply after a Facebook comment. You can send again as soon as the customer replies in Messenger.",
        waitingForCustomerReply: true,
      },
      { status: 409 },
    );
  }

  if (
    messengerPolicy.windowState ===
      "expired"
  ) {
    return NextResponse.json(
      {
        success: false,
        code: "MESSENGER_WINDOW_EXPIRED",
        error:
          "The 7-day Messenger support window has expired. Wait for the customer to message again before sending another reply.",
        latestDirectIncomingAt:
          messengerPolicy.latestDirectIncomingAt,
      },
      { status: 409 },
    );
  }

  if (
    messengerPolicy.windowState ===
      "unknown"
  ) {
    return NextResponse.json(
      {
        success: false,
        code: "MESSENGER_POLICY_UNKNOWN",
        error:
          "TENH could not safely verify this Messenger conversation yet. Refresh the conversation and try again after the latest customer activity is loaded.",
      },
      { status: 409 },
    );
  }

  const hasRecentDirectCustomerMessage =
    messengerPolicy.hasRecentDirectCustomerMessage;
  const latestDirectIncomingAt =
    messengerPolicy.latestDirectIncomingAt;
  const shouldUseHumanAgent =
    messengerPolicy.windowState ===
    "human_agent";

  /*
   * Meta Send API. HUMAN_AGENT is selected only when TENH has verified that
   * the customer's latest direct Messenger message is older than 24 hours
   * but still younger than 7 days. It is never an automatic fallback for
   * arbitrary send errors.
   */
  const graphUrl = new URL(
    `https://graph.facebook.com/${graphVersion}/me/messages`,
  );

  graphUrl.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  async function sendToFacebook({
    useHumanAgentTag,
  }: {
    useHumanAgentTag: boolean;
  }) {
    const response =
      await fetch(graphUrl, {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          recipient: {
            id: recipientId,
          },
          ...(useHumanAgentTag
            ? {
                messaging_type:
                  "MESSAGE_TAG",
                tag: "HUMAN_AGENT",
              }
            : {
                messaging_type:
                  "RESPONSE",
              }),
          message: {
            text: message,
          },
        }),
        cache: "no-store",
      });

    let result:
      FacebookSendResult = {};

    try {
      result =
        (await response.json()) as
          FacebookSendResult;
    } catch {
      // Response validation below reports a useful error.
    }

    return {
      response,
      result,
    };
  }

  let facebookResponse: Response | null = null;
  let facebookResult:
    FacebookSendResult = {};
  const usedHumanAgentTag =
    shouldUseHumanAgent;

  try {
    let sendAttempt =
      await sendToFacebook({
        useHumanAgentTag:
          shouldUseHumanAgent,
      });

    /*
     * Token repair retries the exact same messaging mode. It never changes a
     * standard reply into HUMAN_AGENT and never bypasses the 7-day ceiling.
     */
    if (
      (!sendAttempt.response.ok ||
        sendAttempt.result.error) &&
      isFacebookAccessTokenError(
        sendAttempt.result.error,
      )
    ) {
      pageAccessToken =
        await refreshFacebookPageAccessToken(
          pageId,
        );

      graphUrl.searchParams.set(
        "access_token",
        pageAccessToken,
      );

      sendAttempt =
        await sendToFacebook({
          useHumanAgentTag:
            shouldUseHumanAgent,
        });
    }

    facebookResponse =
      sendAttempt.response;
    facebookResult =
      sendAttempt.result;

    /*
     * A very fresh inbound webhook can race Meta's own messaging-window
     * propagation. Only the verified <24h RESPONSE path gets one retry.
     */
    if (
      !shouldUseHumanAgent &&
      hasRecentDirectCustomerMessage &&
      (!facebookResponse.ok ||
        facebookResult.error)
    ) {
      const standardErrorMessage =
        facebookResult.error?.message
          ?.toLowerCase() ?? "";
      const outsideStandardWindow =
        facebookResult.error?.code === 10 &&
        (standardErrorMessage.includes(
          "outside the allowed window",
        ) ||
          standardErrorMessage.includes(
            "allowed window",
          ) ||
          standardErrorMessage.includes(
            "24",
          ));

      if (outsideStandardWindow) {
        await new Promise((resolve) =>
          setTimeout(resolve, 400),
        );

        const standardRetry =
          await sendToFacebook({
            useHumanAgentTag: false,
          });

        facebookResponse =
          standardRetry.response;
        facebookResult =
          standardRetry.result;
      }
    }
  } catch (sendError) {
    console.error(
      "Facebook message send request failed:",
      sendError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to send the message to Facebook.",
      },
      {
        status: 502,
      },
    );
  }

  if (!facebookResponse) {
    return NextResponse.json(
      {
        success: false,
        error: "Facebook did not return a response.",
      },
      { status: 502 },
    );
  }

  if (
    !facebookResponse.ok ||
    facebookResult.error
  ) {
    console.error(
      "Facebook message send failed:",
      facebookResult,
    );

    const metaMessage =
      facebookResult.error
        ?.message ??
      "Facebook rejected the message.";
    const metaMessageLower =
      metaMessage.toLowerCase();
    const humanAgentApprovalRequired =
      usedHumanAgentTag &&
      metaMessageLower.includes(
        "human_agent",
      ) &&
      (metaMessageLower.includes(
        "prior approval",
      ) ||
        metaMessageLower.includes(
          "approval",
        ));

    return NextResponse.json(
      {
        success: false,
        code: humanAgentApprovalRequired
          ? "HUMAN_AGENT_APPROVAL_REQUIRED"
          : undefined,
        error: humanAgentApprovalRequired
          ? "Extended messaging access is not available for this Facebook Page yet. Ask an administrator to finish the required Meta approval, or wait for the customer to message again."
          : usedHumanAgentTag
            ? `Meta rejected this extended support reply. ${metaMessage}`
            : hasRecentDirectCustomerMessage
              ? `Meta rejected a normal Messenger reply even though TENH received a recent customer message. ${metaMessage}`
              : metaMessage,
        details:
          facebookResult.error ??
          facebookResult,
        usedHumanAgentTag,
        hasRecentDirectCustomerMessage,
        latestDirectIncomingAt:
          latestDirectIncomingAt,
      },
      {
        status:
          facebookResponse.status,
      },
    );
  }

  const facebookMessageId =
    facebookResult.message_id?.trim();

  if (!facebookMessageId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Facebook accepted the request but returned no message ID.",
      },
      {
        status: 502,
      },
    );
  }

  const now =
    new Date().toISOString();

  /*
   * V2.14.1 VERIFIED AGENT ATTRIBUTION
   * ---------------------------------
   * Facebook's message echo can race this API route.
   *
   * If the echo row already exists, update ONLY the
   * verified Tenh sender. This avoids overwriting a
   * Delivered/Seen status that may already have arrived.
   *
   * If no row exists yet, insert the outgoing message
   * with sent_by_member_id immediately.
   */
  const {
    data: existingMessage,
    error: existingMessageError,
  } = await supabaseAdmin
    .from("messages")
    .select(`
      id,
      delivery_status,
      delivered_at,
      seen_at
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "platform_message_id",
      facebookMessageId,
    )
    .maybeSingle();

  let saveWarning:
    string | null = null;

  if (existingMessageError) {
    console.error(
      "Message sent but unable to check existing local message:",
      existingMessageError,
    );

    saveWarning =
      "Facebook delivered the message, but Tenh Chat could not verify the local message row.";
  } else if (existingMessage) {
    const {
      error: attributionError,
    } = await supabaseAdmin
      .from("messages")
      .update({
        sent_by_member_id:
          currentMember.id,
      })
      .eq(
        "id",
        existingMessage.id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

    if (attributionError) {
      console.error(
        "Message sent but unable to save verified agent attribution:",
        attributionError,
      );

      saveWarning =
        "Facebook delivered the message, but Tenh Chat could not save the sending agent.";
    }
  } else {
    const {
      error: insertError,
    } = await supabaseAdmin
      .from("messages")
      .insert({
        business_id:
          currentMember.business_id,
        conversation_id:
          conversation.id,
        platform_message_id:
          facebookMessageId,
        sender_platform_id:
          pageId,
        recipient_platform_id:
          recipientId,
        direction:
          "outgoing",
        message_type:
          "text",
        message_text:
          message,

        /*
         * V2.14.1 — this is the key field.
         */
        sent_by_member_id:
          currentMember.id,

        /*
         * Keep V2.2 Messenger status fields.
         */
        delivery_status:
          "sent",
        delivered_at:
          null,
        seen_at:
          null,

        attachment_url:
          null,
        is_echo:
          false,
        raw_payload:
          facebookResult,
        platform_created_at:
          now,
      });

    if (insertError) {
      /*
       * The echo may have been inserted after our
       * existing-message check but before this insert.
       * If so, attach the verified sender to that row.
       */
      if (
        insertError.code ===
        "23505"
      ) {
        const {
          error:
            raceAttributionError,
        } = await supabaseAdmin
          .from("messages")
          .update({
            sent_by_member_id:
              currentMember.id,
          })
          .eq(
            "business_id",
            currentMember.business_id,
          )
          .eq(
            "platform_message_id",
            facebookMessageId,
          );

        if (raceAttributionError) {
          console.error(
            "Echo race occurred and agent attribution update failed:",
            raceAttributionError,
          );

          saveWarning =
            "Facebook delivered the message, but Tenh Chat could not save the sending agent.";
        }
      } else {
        console.error(
          "Message sent but unable to save it:",
          insertError,
        );

        saveWarning =
          "Facebook delivered the message, but it could not be saved locally.";
      }
    }
  }

  const {
    error: updateError,
  } = await supabaseAdmin
    .from("conversations")
    .update({
      last_message_text:
        getConversationMessagePreview({
          direction: "outgoing",
          messageType: "text",
          messageText: message,
        }),
      last_message_at:
        now,
      updated_at:
        now,
    })
    .eq(
      "id",
      conversation.id,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    );

  if (updateError) {
    console.error(
      "Unable to update conversation preview:",
      updateError,
    );
  }

  return NextResponse.json({
    success: true,
    ...(saveWarning
      ? {
          warning:
            saveWarning,
        }
      : {}),
    recipientId:
      facebookResult.recipient_id ??
      recipientId,
    messageId:
      facebookMessageId,

    /*
     * Helpful while testing V2.14.1.
     * This is an internal API response only.
     */
    sentByMemberId:
      currentMember.id,
    sentByMemberName:
      currentMember.full_name,
    usedHumanAgentTag,
  });
}
