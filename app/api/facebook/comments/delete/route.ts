import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  markFacebookCommentThreadDeleted,
} from "@/lib/facebook/mark-comment-thread-deleted";

import {
  FacebookCommentContextError,
  loadAuthorizedFacebookCommentActionContext,
} from "../_shared";
import {
  confirmCommentMissing,
  isGraphObjectMissing,
  phaseTimer,
} from "@/lib/facebook/comment-action-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteCommentBody = {
  commentId?: string;
};

type GraphResult = {
  success?: boolean;
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
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
  const timer = phaseTimer();
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
      await loadAuthorizedFacebookCommentActionContext({
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

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION
        ?.trim() || "v26.0";

    async function deleteComment(pageAccessToken: string) {
      const url = new URL(
        `https://graph.facebook.com/${graphVersion}/${commentId}`,
      );

      /* Preserve the existing Meta request style while routing the exact Page. */
      url.searchParams.set(
        "access_token",
        pageAccessToken,
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

      return { response, result };
    }

    timer.mark("auth");
    let usedToken = context.pageAccessToken;
    let attempt =
      await deleteComment(
        usedToken,
      );

    if (
      (!attempt.response.ok || attempt.result.error) &&
      isFacebookAccessTokenError(attempt.result.error)
    ) {
      const refreshedToken =
        await refreshFacebookPageAccessToken(
          context.pageId,
        );
      usedToken = refreshedToken;
      attempt =
        await deleteComment(
          refreshedToken,
        );
    }

    const { response, result } = attempt;
    timer.mark("meta");

    if (
      !response.ok ||
      result.success === false ||
      result.error
    ) {
      // Deleted only on structured, twice-confirmed evidence.
      if (isGraphObjectMissing(result.error) && await confirmCommentMissing(commentId, usedToken, graphVersion)) {
        return NextResponse.json(
          { success: false, code: "COMMENT_DELETED", error: "This comment no longer exists on Facebook." },
          { status: 410, headers: { "Server-Timing": timer.header() } },
        );
      }
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

    /*
     * Keep history in TENH, but mirror Facebook's thread deletion.
     * If the parent comment disappears, all locally saved replies that
     * point to that comment (including nested replies) become deleted too.
     */
    /*
     * Facebook has deleted it. If mirroring the thread locally fails now, that
     * is partial, not a failed delete: answering 500 here used to tell the
     * agent the comment was still there when it no longer existed.
     */
    try {
      await markFacebookCommentThreadDeleted({
        businessId:
          currentMember.business_id,
        commentId,
        deletedBy: "page",
      });
    } catch (reconcileError) {
      timer.mark("reconcile");
      console.error("Facebook comment deleted, but local reconciliation failed:", reconcileError);
      return NextResponse.json(
        {
          success: true,
          partial: true,
          code: "LOCAL_SAVE_FAILED",
          warning: "Facebook deleted the comment, but TENH could not update its replies locally.",
        },
        { headers: { "Server-Timing": timer.header() } },
      );
    }
    timer.mark("reconcile");

    return NextResponse.json(
      {
        success: true,
      },
      { headers: { "Server-Timing": timer.header() } },
    );
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
