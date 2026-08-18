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
  loadLocalFacebookCommentContext,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MarkDeletedBody = {
  commentId?: string;
  deletedBy?:
    | "customer"
    | "page";
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
    let body: MarkDeletedBody;

    try {
      body =
        (await request.json()) as MarkDeletedBody;
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

    const deletedBy =
      body.deletedBy === "page"
        ? "page"
        : "customer";

    const deletedText =
      deletedBy === "page"
        ? "Comment deleted by Page"
        : "Comment is deleted by commenter";

    const context =
      await loadLocalFacebookCommentContext({
        businessId:
          currentMember.business_id,
        commentId,
      });

    const {
      error: messageUpdateError,
    } = await supabaseAdmin
      .from("messages")
      .update({
        comment_is_deleted: true,
        comment_deleted_by:
          deletedBy,
        comment_is_liked: false,
        comment_is_hidden: false,
        message_text:
          deletedText,
      })
      .eq(
        "id",
        context.message.id,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

    if (messageUpdateError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to mark the local comment deleted.",
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
          deletedText,
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
        "Unable to update conversation preview after marking comment deleted:",
        conversationUpdateError,
      );
    }

    return NextResponse.json({
      success: true,
      deletedBy,
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

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to mark comment deleted.",
      },
      {
        status: 500,
      },
    );
  }
}
