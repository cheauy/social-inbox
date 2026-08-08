import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";


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

export async function POST(request: NextRequest) {
  let body: SendMessageBody;

  try {
    body = (await request.json()) as SendMessageBody;
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

  const conversationId = body.conversationId?.trim();
  const recipientId = body.recipientId?.trim();
  const message = body.message?.trim();

  if (!conversationId) {
    return NextResponse.json(
      {
        success: false,
        error: "conversationId is required.",
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
        error: "recipientId is required.",
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
        error: "Message cannot be empty.",
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

  const pageId = process.env.FACEBOOK_PAGE_ID;
const pageAccessToken =
  await getFacebookPageAccessToken(
    pageId,
  );
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION;

  if (!pageId || !pageAccessToken || !graphVersion) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing Facebook environment variables.",
      },
      {
        status: 500,
      },
    );
  }

  /*
   * Confirm that the conversation exists and retrieve its
   * business and social-account information.
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
  .maybeSingle();

  if (conversationError) {
    console.error(
      "Unable to load conversation:",
      conversationError,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load the conversation.",
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
        error: "Conversation was not found.",
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
    platform_account_id
  `)
  .eq("id", conversation.social_account_id)
  .maybeSingle();

if (socialAccountError) {
  console.error(
    "Unable to load social account:",
    socialAccountError,
  );

  return NextResponse.json(
    {
      success: false,
      error: "Unable to load the Facebook Page.",
      details: socialAccountError.message,
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
      error: "Connected Facebook Page was not found.",
    },
    {
      status: 404,
    },
  );
}

if (
  socialAccount.platform !== "facebook" ||
  socialAccount.platform_account_id !== pageId
) {
  return NextResponse.json(
    {
      success: false,
      error:
        "The conversation does not belong to the configured Facebook Page.",
    },
    {
      status: 400,
    },
  );
}

  /*
   * Current Meta Send API endpoint:
   * POST /{PAGE_ID}/messages
   */
 const graphUrl = new URL(
  `https://graph.facebook.com/${graphVersion}/me/messages`,
);

  graphUrl.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  const facebookResponse = await fetch(graphUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: {
        id: recipientId,
      },
      messaging_type: "RESPONSE",
      message: {
        text: message,
      },
    }),
    cache: "no-store",
  });

  const facebookResult =
    (await facebookResponse.json()) as FacebookSendResult;

  if (!facebookResponse.ok || facebookResult.error) {
    console.error(
      "Facebook message send failed:",
      facebookResult,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          facebookResult.error?.message ??
          "Facebook rejected the message.",
        details: facebookResult.error ?? facebookResult,
      },
      {
        status: facebookResponse.status,
      },
    );
  }

  if (!facebookResult.message_id) {
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

  /*
   * Save the outgoing message immediately.
   *
   * Your webhook may later receive an echo for the same
   * message. Because platform_message_id is unique, your
   * webhook processor should ignore that duplicate.
   */
  const now = new Date().toISOString();

  const { error: insertError } = await supabaseAdmin
    .from("messages")
    .upsert(
      {
        business_id: conversation.business_id,
        conversation_id: conversation.id,
        platform_message_id:
          facebookResult.message_id,
        sender_platform_id: pageId,
        recipient_platform_id: recipientId,
        direction: "outgoing",
        message_type: "text",
        message_text: message,

        delivery_status: "sent",
    delivered_at: null,
    seen_at: null,
        attachment_url: null,
        is_echo: false,
        raw_payload: facebookResult,
        platform_created_at: now,
      },
      {
        onConflict:
          "business_id,platform_message_id",
        ignoreDuplicates: true,
      },
    );

  if (insertError) {
    console.error(
      "Message sent but unable to save it:",
      insertError,
    );

    return NextResponse.json(
      {
        success: true,
        warning:
          "Facebook delivered the message, but it could not be saved locally.",
        recipientId:
          facebookResult.recipient_id ?? recipientId,
        messageId: facebookResult.message_id,
      },
      {
        status: 200,
      },
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("conversations")
    .update({
      last_message_text: message,
      last_message_at: now,
      updated_at: now,
    })
    .eq("id", conversation.id);

  if (updateError) {
    console.error(
      "Unable to update conversation preview:",
      updateError,
    );
  }

  return NextResponse.json({
    success: true,
    recipientId:
      facebookResult.recipient_id ?? recipientId,
    messageId: facebookResult.message_id,
  });
}