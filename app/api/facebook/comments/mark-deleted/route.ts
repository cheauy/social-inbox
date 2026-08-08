import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

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
    const body =
      (await request.json()) as MarkDeletedBody;

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

    const {
      data: message,
      error: messageLookupError,
    } = await supabaseAdmin
      .from("messages")
      .select(`
        id,
        conversation_id
      `)
      .eq(
        "platform_message_id",
        commentId,
      )
      .maybeSingle();

    if (messageLookupError) {
      throw new Error(
        messageLookupError.message,
      );
    }

    if (!message) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Comment message was not found locally.",
        },
        {
          status: 404,
        },
      );
    }

    const {
      error: messageUpdateError,
    } = await supabaseAdmin
      .from("messages")
      .update({
        comment_is_deleted:
          true,

        comment_deleted_by:
          deletedBy,

        comment_is_liked:
          false,

        comment_is_hidden:
          false,

        message_text:
          deletedText,
      })
      .eq(
        "id",
        message.id,
      );

    if (messageUpdateError) {
      throw new Error(
        messageUpdateError.message,
      );
    }

    if (message.conversation_id) {
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
          message.conversation_id,
        );

      if (
        conversationUpdateError
      ) {
        console.warn(
          "Unable to update conversation preview:",
          conversationUpdateError,
        );
      }
    }

    return NextResponse.json({
      success: true,
      deletedBy,
    });
  } catch (error) {
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