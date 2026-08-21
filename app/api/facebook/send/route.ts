import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
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
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

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
   * Meta Send API.
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
  let usedHumanAgentTag =
    false;

  try {
    let standardAttempt =
      await sendToFacebook({
        useHumanAgentTag: false,
      });

    /*
     * Meta can invalidate a stored Page token while the User authorization
     * behind it is still valid. In that specific case TENH re-derives the
     * Page token from the encrypted User token and retries once. This does
     * not bypass revoked Facebook authorization; if the User token is no
     * longer valid, the refresh helper returns a reconnect-required error.
     */
    if (
      (!standardAttempt.response.ok ||
        standardAttempt.result.error) &&
      isFacebookAccessTokenError(
        standardAttempt.result.error,
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

      standardAttempt =
        await sendToFacebook({
          useHumanAgentTag: false,
        });
    }

    facebookResponse =
      standardAttempt.response;
    facebookResult =
      standardAttempt.result;

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

    /*
     * Meta allows the HUMAN_AGENT tag for a real support representative's
     * manual reply beyond the 24-hour standard window, up to the policy's
     * Human Agent period. TENH uses it only as a fallback on this authenticated
     * manual-agent route—never for automated sends.
     */
    if (
      (!facebookResponse.ok ||
        facebookResult.error) &&
      outsideStandardWindow
    ) {
      const humanAgentAttempt =
        await sendToFacebook({
          useHumanAgentTag: true,
        });

      facebookResponse =
        humanAgentAttempt.response;
      facebookResult =
        humanAgentAttempt.result;
      usedHumanAgentTag = true;
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

    return NextResponse.json(
      {
        success: false,
        error:
          usedHumanAgentTag
            ? `Meta would not allow this manual reply outside the standard messaging window. ${metaMessage}`
            : metaMessage,
        details:
          facebookResult.error ??
          facebookResult,
        usedHumanAgentTag,
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
        message,
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
