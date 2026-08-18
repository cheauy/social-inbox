import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    savedReplyId: string;
  }>;
};

function clean(
  value: string | null | undefined,
) {
  const result = value?.trim();
  return result ? result : null;
}

function shortcut(
  value: string | null | undefined,
) {
  const result = clean(value);

  if (!result) {
    return null;
  }

  return (
    result.startsWith("/")
      ? result
      : `/${result}`
  ).toLowerCase();
}

export async function PATCH(
  request: NextRequest,
  context: Context,
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
  const { savedReplyId } =
    await context.params;
  const normalizedSavedReplyId =
    savedReplyId?.trim();

  if (!normalizedSavedReplyId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Saved reply ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  let body: {
    title?: string;
    shortcut?: string | null;
    messageText?: string;
    category?: string | null;
    sortIndex?: number;
    isActive?: boolean;
  };

  try {
    body =
      (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const updates: Record<
    string,
    unknown
  > = {
    updated_at:
      new Date().toISOString(),
  };

  if (body.title !== undefined) {
    const title = body.title.trim();

    if (!title) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Saved reply title cannot be empty.",
        },
        { status: 400 },
      );
    }

    if (title.length > 120) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Saved reply title must be 120 characters or fewer.",
        },
        { status: 400 },
      );
    }

    updates.title = title;
  }

  if (body.shortcut !== undefined) {
    updates.shortcut =
      shortcut(body.shortcut);
  }

  if (
    body.messageText !== undefined
  ) {
    const messageText =
      body.messageText.trim();

    if (!messageText) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Saved reply message cannot be empty.",
        },
        { status: 400 },
      );
    }

    if (messageText.length > 10_000) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Saved reply message is too long.",
        },
        { status: 400 },
      );
    }

    updates.message_text =
      messageText;
  }

  if (body.category !== undefined) {
    updates.category =
      clean(body.category);
  }

  if (body.sortIndex !== undefined) {
    if (!Number.isFinite(body.sortIndex)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "sortIndex must be a number.",
        },
        { status: 400 },
      );
    }

    updates.sort_index = Math.max(
      0,
      Math.trunc(body.sortIndex),
    );
  }

  if (body.isActive !== undefined) {
    updates.is_active =
      body.isActive;
  }

  const { data, error } =
    await supabaseAdmin
      .from("saved_replies")
      .update(updates)
      .eq(
        "id",
        normalizedSavedReplyId,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .select(
        "id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at",
      )
      .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error.code === "23505"
            ? "A saved reply with this title or shortcut already exists."
            : "Unable to update saved reply.",
      },
      {
        status:
          error.code === "23505"
            ? 409
            : 500,
      },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Saved reply was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    success: true,
    savedReply: data,
  });
}

export async function DELETE(
  _request: NextRequest,
  context: Context,
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
  const { savedReplyId } =
    await context.params;
  const normalizedSavedReplyId =
    savedReplyId?.trim();

  if (!normalizedSavedReplyId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Saved reply ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: deleted,
    error,
  } = await supabaseAdmin
    .from("saved_replies")
    .delete()
    .eq(
      "id",
      normalizedSavedReplyId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to delete saved reply.",
      },
      {
        status: 500,
      },
    );
  }

  if (!deleted) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Saved reply was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    success: true,
  });
}
