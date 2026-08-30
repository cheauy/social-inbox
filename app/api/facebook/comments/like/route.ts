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
  FacebookCommentContextError,
  loadAuthorizedFacebookCommentActionContext,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LikeCommentBody = {
  commentId?: string;
  liked?: boolean;
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
  try {
    let body: LikeCommentBody;

    try {
      body =
        (await request.json()) as LikeCommentBody;
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
    const liked =
      body.liked ?? true;

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

    const endpoint =
      `https://graph.facebook.com/${graphVersion}/${commentId}/likes`;

    const response =
      await fetch(endpoint, {
        method: liked
          ? "POST"
          : "DELETE",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          access_token:
            context.pageAccessToken,
        }),
        cache: "no-store",
      });

    const result =
      await readGraphResult(
        response,
      );

    /*
     * V3.11.30: only change TENH local state after Meta confirms the
     * operation. The old route updated the DB before checking response.ok,
     * which could display a Like that Facebook had rejected.
     */
    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.error?.message ??
            "Unable to update Facebook comment like.",
        },
        {
          status:
            response.status || 500,
        },
      );
    }

    const { error: databaseError } =
      await supabaseAdmin
        .from("messages")
        .update({
          comment_is_liked: liked,
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
            "Facebook updated the comment Like, but TENH could not save the local state.",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      liked,
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
            : "Unable to update Facebook comment like.",
      },
      {
        status: 500,
      },
    );
  }
}
