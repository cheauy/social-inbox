import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { confirmCommentReply } from "@/lib/facebook/confirm-comment-reply";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";

import {
  FacebookCommentContextError,
  loadAuthorizedFacebookCommentActionContext,
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
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export async function POST(
  request: NextRequest,
) {
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
      typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
    const commentId =
      typeof body?.commentId === "string" ? body.commentId.trim() : "";
    const message =
      typeof body?.message === "string" ? body.message.trim() : "";

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
      await loadAuthorizedFacebookCommentActionContext({
        commentId,
        conversationId,
      });

    const currentMember = context.member;

    if (
      !(await memberHasPermission(currentMember, "conversations", "manage"))
    ) {
      return permissionDenied(
        "You do not have permission to reply in this workspace.",
      );
    }

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION
        ?.trim() || "v26.0";

    async function sendReply(
      pageAccessToken: string,
    ) {
      const response = await fetch(
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(commentId)}/comments`,
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
          return {
            response,
            result,
            invalidJson: true,
          };
        }
      }

      return {
        response,
        result,
        invalidJson: false,
      };
    }

    const startedAt = Date.now();
    let activeToken = context.pageAccessToken;
    let attempt =
      await sendReply(
        context.pageAccessToken,
      );

    /*
     * A Page token can be invalidated by Meta even though the previously
     * authorized User token is still valid. Repair that case automatically
     * and retry exactly once. If the User authorization itself is gone, the
     * refresh helper returns a clear reconnect-required error instead.
     */
    if (
      (!attempt.response.ok ||
        attempt.result.error) &&
      isFacebookAccessTokenError(
        attempt.result.error,
      )
    ) {
      const refreshedToken =
        await refreshFacebookPageAccessToken(
          context.pageId,
        );

      activeToken = refreshedToken;

      attempt =
        await sendReply(
          refreshedToken,
        );
    }

    // Meta can post a comment and still return code 1 instead of its ID.
    // Confirm the actual Page-authored reply with a bounded read, never a resend.
    if (attempt.invalidJson || attempt.result.error?.code === 1 ||
        /reduce the amount of data/i.test(attempt.result.error?.message ?? "")) {
      const confirmedId = await confirmCommentReply({ commentId, pageId: context.pageId,
        message, startedAt, pageAccessToken: activeToken, graphVersion });
      if (confirmedId) {
        attempt = { response: new Response(null, { status: 200 }), result: { id: confirmedId }, invalidJson: false };
      }
    }

    if (attempt.invalidJson) {
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

    const {
      response,
      result,
    } = attempt;

    if (!response.ok || !result.id) {
      const overloaded = /reduce the amount of data/i.test(result.error?.message ?? "");
      const reference = result.error?.code ? ` (Meta ${result.error.code}${result.error.error_subcode ? `/${result.error.error_subcode}` : ""})` : "";
      console.warn("Facebook comment reply not confirmed", { conversationId, commentId, status: response.status,
        code: result.error?.code, subcode: result.error?.error_subcode, traceId: result.error?.fbtrace_id });
      return NextResponse.json({ success: false,
        code: overloaded ? "FACEBOOK_COMMENT_UNCONFIRMED" : "FACEBOOK_COMMENT_REJECTED",
        error: overloaded
          ? `Facebook could not confirm this comment reply. Check the post before trying again to avoid a duplicate. This is a Facebook API error, not a request to shorten your message.${reference}`
          : (result.error?.message ?? "Unable to reply to Facebook comment.") + reference,
      }, { status: response.status >= 400 ? response.status : 502 });
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

    // A webhook may already have saved the same confirmed Facebook comment.
    // Once Meta returns its ID, a local persistence error must not invite a resend.
    const warning = messageError && messageError.code !== "23505"
      ? "Facebook posted the reply, but TENH could not save its local copy. Refresh the conversation; do not resend it."
      : undefined;
    if (warning) console.warn("Confirmed comment could not be stored", { conversationId, commentId: result.id, code: messageError?.code });

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
      messageId: result.id,
      ...(warning ? { warning } : {}),
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
