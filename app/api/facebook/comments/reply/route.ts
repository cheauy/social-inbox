import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

type ReplyBody = {
  conversationId?: string;
  commentId?: string;
  message?: string;
};

export async function POST(
  request: NextRequest,
) {
  try {
    const body =
      (await request.json()) as ReplyBody;

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
            "conversationId, commentId and message are required.",
        },
        {
          status: 400,
        },
      );
    }

   

    const pageId =
      process.env.FACEBOOK_PAGE_ID;

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION ??
      "v26.0";
const pageAccessToken =
  await getFacebookPageAccessToken(
    pageId,
  );


    const response =
      await fetch(
        `https://graph.facebook.com/${graphVersion}/${commentId}/comments`,
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

    const responseText =
      await response.text();

    let result: {
      id?: string;

      error?: {
        message?: string;
        code?: number;
      };
    } = {};

    if (responseText.trim()) {
      try {
        result =
          JSON.parse(
            responseText,
          ) as typeof result;
      } catch {
        return NextResponse.json(
          {
            success: false,
            error:
              "Facebook returned invalid JSON.",
          },
          {
            status: 500,
          },
        );
      }
    }

    if (
      !response.ok ||
      !result.id
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.error
              ?.message ??
            "Unable to reply to Facebook comment.",
        },
        {
          status:
            response.status ||
            500,
        },
      );
    }

    const {
      data: conversation,
      error:
        conversationError,
    } = await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        business_id
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
      return NextResponse.json(
        {
          success: false,
          error:
            conversationError
              ?.message ??
            "Conversation not found.",
        },
        {
          status: 404,
        },
      );
    }

    const now =
      new Date().toISOString();

    const {
      error: messageError,
    } = await supabaseAdmin
      .from("messages")
      .insert({
        business_id:
          conversation.business_id,

        conversation_id:
          conversation.id,

        platform_message_id:
          result.id,

        sender_platform_id:
          pageId,

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
          source:
            "facebook_comment_reply",

          parent_comment_id:
            commentId,

          reply_comment_id:
            result.id,
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
        conversation.id,
      );

    if (updateError) {
      throw new Error(
        updateError.message,
      );
    }

    return NextResponse.json({
      success: true,
      commentId:
        result.id,
    });
  } catch (error) {
    console.error(
      "Facebook comment reply failed:",
      error,
    );

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