import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
type LikeCommentBody = {
  commentId?: string;
  liked?: boolean;
};

export async function POST(
  request: NextRequest,
) {
  try {
    const body =
      (await request.json()) as LikeCommentBody;

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

    const endpoint =
      `https://graph.facebook.com/${graphVersion}/${commentId}/likes`;

    const response =
      await fetch(
        endpoint,
        {
          method:
            liked
              ? "POST"
              : "DELETE",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            liked
              ? JSON.stringify({
                  access_token:
                    pageAccessToken,
                })
              : JSON.stringify({
                  access_token:
                    pageAccessToken,
                }),
        },
      );

    const text =
      await response.text();

    let result: {
      success?: boolean;
      error?: {
        message?: string;
      };
    } = {};

    const {
  error: databaseError,
} = await supabaseAdmin
  .from("messages")
  .update({
    comment_is_liked:
      liked,
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

    if (text.trim()) {
      result =
        JSON.parse(text) as typeof result;
    }

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

    return NextResponse.json({
      success: true,
      liked,
    });
  } catch (error) {
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