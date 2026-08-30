import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  markFacebookCommentThreadDeleted,
} from "@/lib/facebook/mark-comment-thread-deleted";

import {
  FacebookCommentContextError,
  loadAuthorizedLocalFacebookCommentContext,
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
      "Message deleted by commenter or Page";

    const context =
      await loadAuthorizedLocalFacebookCommentContext({
        commentId,
      });

    const currentMember = context.member;

    if (
      !(await memberHasPermission(currentMember, "conversations", "manage"))
    ) {
      return permissionDenied(
        "You do not have permission to reply in this workspace.",
      );
    }

    await markFacebookCommentThreadDeleted({
      businessId:
        currentMember.business_id,
      commentId,
      deletedBy,
    });

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
