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

async function requireMember() {
  return getCurrentMember();
}

export async function GET(
  request: NextRequest,
) {
  const authResult =
    await requireMember();

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

  const activeOnly =
    request.nextUrl.searchParams.get(
      "activeOnly",
    ) === "true";

  /*
   * V3.11.30: businessId may still be present in old client URLs, but the
   * server deliberately ignores it and uses the authenticated workspace.
   */
  let query = supabaseAdmin
    .from("saved_replies")
    .select(
      "id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at",
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .order("is_active", {
      ascending: false,
    })
    .order("sort_index", {
      ascending: true,
    })
    .order("title", {
      ascending: true,
    });

  if (activeOnly) {
    query = query.eq(
      "is_active",
      true,
    );
  }

  const { data, error } =
    await query;

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load quick replies.",
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    savedReplies: data ?? [],
  });
}

export async function POST(
  request: NextRequest,
) {
  const authResult =
    await requireMember();

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

  let body: {
    /* Kept for backward-compatible client payloads. */
    businessId?: string;
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

  const title = body.title?.trim();
  const messageText =
    body.messageText?.trim();

  if (!title || !messageText) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Title and message are required.",
      },
      {
        status: 400,
      },
    );
  }

  if (title.length > 120) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Saved reply title must be 120 characters or fewer.",
      },
      {
        status: 400,
      },
    );
  }

  if (messageText.length > 10_000) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Saved reply message is too long.",
      },
      {
        status: 400,
      },
    );
  }

  const { data, error } =
    await supabaseAdmin
      .from("saved_replies")
      .insert({
        business_id:
          currentMember.business_id,
        title,
        shortcut: shortcut(
          body.shortcut,
        ),
        message_text: messageText,
        category: clean(
          body.category,
        ),
        sort_index: Math.max(
          0,
          Math.trunc(
            Number.isFinite(
              body.sortIndex,
            )
              ? (body.sortIndex as number)
              : 0,
          ),
        ),
        is_active:
          body.isActive ?? true,
      })
      .select(
        "id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at",
      )
      .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error.code === "23505"
            ? "A saved reply with this title or shortcut already exists."
            : "Unable to create saved reply.",
      },
      {
        status:
          error.code === "23505"
            ? 409
            : 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    savedReply: data,
  });
}
