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

type DeleteCommentBody = {
  commentId?: string;
};

type GraphResult = {
  success?: boolean;
  error?: {
    message?: string;
  };
};

async function readGraphResult(
  response: Response,
): Promise<GraphResult> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(
      text,
    ) as GraphResult;
  } catch {
    return {};
  }
}

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
    let body: DeleteCommentBody;

    try {
      body =
        (await request.json()) as DeleteCommentBody;
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

    const commentId =
      body.commentId?.trim();

    if (!commentId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "commentId is required.",
        },
        {
          status: 400,
        },
      );
    }

    const context =
      await loadFacebookCommentActionContext({
        businessId:
          currentMember.business_id,
        commentId,
      });

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION
        ?.trim() || "v26.0";

    const url = new URL(
      `https://graph.facebook.com/${graphVersion}/${commentId}`,
    );

    /* Preserve the existing Meta request style while routing the exact Page. */
    url.searchParams.set(
      "access_token",
      context.pageAccessToken,
    );

    const response =
      await fetch(url, {
        method: "DELETE",
        cache: "no-store",
      });

    const result =
      await readGraphResult(
        response,
      );

    if (
      !response.ok ||
      result.success === false
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.error?.message ??
            "Unable to delete Facebook comment.",
        },
        {
          status:
            response.status || 500,
        },
      );
    }

    /* Keep history in TENH; do not physically delete the message row. */
    const { error: databaseError } =
      await supabaseAdmin
        .from("messages")
        .update({
          comment_is_deleted: true,
          comment_deleted_by:
            "page",
          comment_is_liked: false,
          comment_is_hidden: false,
          message_text:
            "Comment deleted by Page",
        })
        .eq(
          "id",
          context.message.id,
        )
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (databaseError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Facebook deleted the comment, but TENH could not save the local deleted state.",
        },
        {
          status: 500,
        },
      );
    }

    const {
      error: conversationUpdateError,
    } = await supabaseAdmin
      .from("conversations")
      .update({
        last_message_text:
          "Comment deleted by Page",
        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        context.conversation.id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

    if (conversationUpdateError) {
      console.warn(
        "Facebook comment was deleted, but TENH could not refresh the conversation preview:",
        conversationUpdateError,
      );
    }

    return NextResponse.json({
      success: true,
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
      "Delete Facebook comment failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete comment.",
      },
      {
        status: 500,
      },
    );
  }
}
