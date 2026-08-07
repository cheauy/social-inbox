import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type ReplyCommentBody = {
  conversationId?: string;
  commentId?: string;
  message?: string;
};

export async function POST(
  request: NextRequest,
) {
  let body: ReplyCommentBody;

  try {
    body =
      (await request.json()) as ReplyCommentBody;
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

  const commentId =
    body.commentId?.trim();

  const message =
    body.message?.trim();

  if (
    !conversationId ||
    !commentId ||
    !message
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Conversation, comment and message are required.",
      },
      {
        status: 400,
      },
    );
  }

  const pageAccessToken =
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageAccessToken) {
    return NextResponse.json(
      {
        success: false,
        error:
          "FACEBOOK_PAGE_ACCESS_TOKEN is missing.",
      },
      {
        status: 500,
      },
    );
  }

  try {
    const graphResponse =
      await fetch(
        `https://graph.facebook.com/v23.0/${commentId}/comments`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            message,
            access_token:
              pageAccessToken,
          }),
        },
      );

    const graphText =
      await graphResponse.text();

    let graphResult: {
      id?: string;
      error?: {
        message?: string;
      };
    } = {};

    if (graphText.trim()) {
      graphResult =
        JSON.parse(graphText) as {
          id?: string;
          error?: {
            message?: string;
          };
        };
    }

    if (
      !graphResponse.ok ||
      !graphResult.id
    ) {
      throw new Error(
        graphResult.error?.message ??
          "Unable to reply to Facebook comment.",
      );
    }

    const now =
      new Date().toISOString();

    const {
      data: conversation,
      error: conversationError,
    } = await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        business_id,
        facebook_post_id
      `)
      .eq(
        "id",
        conversationId,
      )
      .single();

    if (
      conversationError ||
      !conversation
    ) {
      throw new Error(
        conversationError?.message ??
          "Conversation not found.",
      );
    }

    const {
      error: messageError,
    } = await supabaseAdmin
      .from("messages")
      .insert({
        business_id:
          conversation.business_id,

        conversation_id:
          conversationId,

        platform_message_id:
          graphResult.id,

        sender_platform_id:
          process.env.FACEBOOK_PAGE_ID ??
          "",

        recipient_platform_id:
          commentId,

        direction:
          "outgoing",

        message_type:
          "text",

        message_text:
          message,

        attachment_url:
          null,

        is_echo:
          true,

        raw_payload: {
          source: "facebook_comment_reply",
          parent_comment_id:
            commentId,
          reply_comment_id:
            graphResult.id,
        },

        platform_created_at:
          now,
      });

    if (messageError) {
      throw new Error(
        messageError.message,
      );
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
        conversationId,
      );

    if (updateError) {
      throw new Error(
        updateError.message,
      );
    }

    return NextResponse.json({
      success: true,
      commentId:
        graphResult.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to reply to Facebook comment.",
      },
      {
        status: 500,
      },
    );
  }
}