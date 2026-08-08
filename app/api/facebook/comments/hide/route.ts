import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

type HideCommentBody = {
  commentId?: string;
  hidden?: boolean;
};

export async function POST(
  request: NextRequest,
) {
  try {
    const body =
      (await request.json()) as HideCommentBody;

    const commentId =
      body.commentId?.trim();

    const hidden =
      body.hidden ?? true;

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

    const response =
      await fetch(
        `https://graph.facebook.com/${graphVersion}/${commentId}`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            is_hidden: hidden,
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
    comment_is_hidden:
      hidden,
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

    if (
      !response.ok ||
      result.success === false
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.error?.message ??
            "Unable to update Facebook comment visibility.",
        },
        {
          status:
            response.status || 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      hidden,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to update Facebook comment.",
      },
      {
        status: 500,
      },
    );
  }
}