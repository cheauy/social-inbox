import {
  NextRequest,
  NextResponse,
} from "next/server";

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
