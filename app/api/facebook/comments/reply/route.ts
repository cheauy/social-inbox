import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  FacebookCommentContextError,
  loadFacebookCommentActionContext,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReplyBody = {
  conversationId?: string;
  commentId?: string;
  message?: string;
};

type GraphReplyResult = {
  id?: string;
  error?: {
    message?: string;
    code?: number;
  };
};

export async function POST(
  request: NextRequest,
) {
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

  try {
    let body: ReplyBody;

    try {
      body =
        (await request.json()) as ReplyBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid JSON request.",
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
            "conversationId, commentId and message are required.",
        },
        {
          status: 400,
        },
      );
    }

    if (message.length > 8000) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Comment reply is too long.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Verify TENH access and resolve the exact Facebook Page BEFORE sending.
     * The old route sent first using FACEBOOK_PAGE_ID, then checked the
     * conversation. That was unsafe and could reply through the wrong Page.
     */
    const context =
      await loadFacebookCommentActionContext({
        businessId:
          currentMember.business_id,
        commentId,
        conversationId,
      });

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION
        ?.trim() || "v26.0";

    const response = await fetch(
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
            context.pageAccessToken,
        }),
        cache: "no-store",
      },
    );

    const responseText =
      await response.text();

    let result: GraphReplyResult = {};

    if (responseText.trim()) {
      try {
        result = JSON.parse(
          responseText,
        ) as GraphReplyResult;
      } catch {
        return NextResponse.json(
          {
            success: false,
            error:
              "Facebook returned invalid JSON.",
          },
          {
            status: 502,
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
            result.error?.message ??
            "Unable to reply to Facebook comment.",
        },
        {
          status:
            response.status || 500,
        },
      );
    }

    const now =
      new Date().toISOString();

    const { error: messageError } =
      await supabaseAdmin
        .from("messages")
        .insert({
          business_id:
            currentMember.business_id,
          conversation_id:
            context.conversation.id,
          platform_message_id:
            result.id,
          sender_platform_id:
            context.pageId,
          recipient_platform_id:
            commentId,
          direction: "outgoing",
          message_type: "text",
          message_text: message,
          attachment_url: null,
          is_echo: true,
          raw_payload: {
            source:
              "facebook_comment_reply",
            parent_comment_id:
              commentId,
            reply_comment_id:
              result.id,
            social_account_id:
              context.socialAccount.id,
          },
          platform_created_at:
            now,
        });

    if (messageError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Facebook posted the reply, but TENH could not save the local message.",
        },
        {
          status: 500,
        },
      );
    }

    const { error: updateError } =
      await supabaseAdmin
        .from("conversations")
        .update({
          last_message_text:
            message,
          last_message_at: now,
          updated_at: now,
        })
        .eq(
          "id",
          context.conversation.id,
        )
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (updateError) {
      console.warn(
        "Facebook comment reply was saved, but TENH could not refresh the conversation preview:",
        updateError,
      );
    }

    return NextResponse.json({
      success: true,
      commentId: result.id,
    });
  } catch (error) {
    if (
      error instanceof
      FacebookCommentContextError
    ) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

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
