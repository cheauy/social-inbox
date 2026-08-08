import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

type DeleteCommentBody = {
  commentId?: string;
};

export async function POST(
  request: NextRequest,
) {
  try {
    const body =
      (await request.json()) as DeleteCommentBody;

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

    const pageAccessToken =
      process.env
        .FACEBOOK_PAGE_ACCESS_TOKEN;

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION ??
      "v26.0";

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

    const url =
      `https://graph.facebook.com/${graphVersion}/${commentId}` +
      `?access_token=${encodeURIComponent(
        pageAccessToken,
      )}`;

    const response =
      await fetch(
        url,
        {
          method: "DELETE",
        },
      );

    const responseText =
      await response.text();

    let result: {
      success?: boolean;

      error?: {
        message?: string;
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

    /*
     * Keep history in Tenh Chat.
     * Do NOT physically delete our DB row.
     */
    const {
      error: databaseError,
    } = await supabaseAdmin
      .from("messages")
      .update({
        comment_is_deleted:
          true,

        comment_deleted_by:
          "page",

        message_text:
          "Comment deleted by Page",
      })
      .eq(
        "platform_message_id",
        commentId,
      );

    if (databaseError) {
      throw new Error(
        databaseError.message,
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
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