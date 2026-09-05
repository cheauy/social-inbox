import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import { authorizeInboxBusinessAccess } from "@/lib/inbox/get-inbox-resource-access";
import { DEFAULT_SAVED_REPLY_SEED_MARKER } from "@/lib/settings/ensure-workspace-default-content";
import {
  parseAttachments,
  SAVED_REPLY_MEDIA_BUCKET,
  validateAttachments,
} from "@/lib/settings/saved-reply-attachments";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/require-permission";

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


/*
 * Sign every attachment across every reply in one round trip.
 *
 * The bucket is private, so a thumbnail needs a signed link. Fetching one per
 * attachment from the browser meant a picker of twenty replies opened with
 * dozens of requests in flight, which is what made it feel slow. createSignedUrls
 * takes the whole list at once, and the links ride back with the replies.
 *
 * Ten minutes is long enough to open the panel, scroll it and send, and short
 * enough that a copied link is not worth much.
 */
async function withSignedAttachmentUrls(
  replies: Record<string, unknown>[],
) {
  const paths: string[] = [];

  for (const reply of replies) {
    for (const attachment of parseAttachments(
      reply.attachments,
    )) {
      paths.push(attachment.path);
    }
  }

  if (paths.length === 0) {
    return replies;
  }

  const { data, error } =
    await supabaseAdmin.storage
      .from(SAVED_REPLY_MEDIA_BUCKET)
      .createSignedUrls(paths, 60 * 10);

  if (error) {
    /*
     * Without links the thumbnails fall back to placeholders, which is worth
     * far more than failing the list the agent came for.
     */
    console.error(
      `Unable to sign quick reply media — ${error.message}`,
    );

    return replies;
  }

  const byPath = new Map<string, string>();

  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) {
      byPath.set(entry.path, entry.signedUrl);
    }
  }

  return replies.map((reply) => ({
    ...reply,
    attachments: parseAttachments(
      reply.attachments,
    ).map((attachment) => ({
      ...attachment,
      url:
        byPath.get(attachment.path) ?? null,
    })),
  }));
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

  const requestedBusinessId =
    request.nextUrl.searchParams
      .get("businessId")
      ?.trim() ?? "";

  let businessId =
    currentMember.business_id;

  if (
    requestedBusinessId &&
    requestedBusinessId !== currentMember.business_id
  ) {
    const access =
      await authorizeInboxBusinessAccess(
        requestedBusinessId,
      );

    if (!access.success) {
      return NextResponse.json(
        {
          success: false,
          error: access.error,
        },
        {
          status: access.status,
        },
      );
    }

    businessId = access.businessId;
  }

  const activeOnly =
    request.nextUrl.searchParams.get(
      "activeOnly",
    ) === "true";

  let query = supabaseAdmin
    .from("saved_replies")
    .select(
      "id,business_id,title,shortcut,message_text,category,attachments,sort_index,is_active,created_at,updated_at",
    )
    .eq(
      "business_id",
      businessId,
    )
    .neq("title", DEFAULT_SAVED_REPLY_SEED_MARKER)
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

  const savedReplies =
    await withSignedAttachmentUrls(
      (data ?? []) as Record<
        string,
        unknown
      >[],
    );

  return NextResponse.json({
    success: true,
    savedReplies,
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
  const permissionGuard =
    await requirePermission("tags_quick_replies", "manage");

  if (!permissionGuard.success) {
    return permissionGuard.response;
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
    attachments?: unknown;
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

  if (title === DEFAULT_SAVED_REPLY_SEED_MARKER) {
    return NextResponse.json(
      {
        success: false,
        error: "This quick reply title is reserved by TENH.",
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

  /*
   * Media is validated against the caller's own workspace before it is stored.
   * The paths arrive from the browser, so the prefix check is what stops a
   * reply being pointed at another workspace's files, and the count rules are
   * what stop a reply promising a delivery the channels cannot make.
   */
  const attachments = parseAttachments(
    body.attachments,
  );

  const attachmentError = validateAttachments(
    attachments,
    currentMember.business_id,
  );

  if (attachmentError) {
    return NextResponse.json(
      {
        success: false,
        error: attachmentError,
      },
      { status: 400 },
    );
  }

  const { data, error } =
    await supabaseAdmin
      .from("saved_replies")
      .insert({
        business_id:
          currentMember.business_id,
        attachments,
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
        "id,business_id,title,shortcut,message_text,category,attachments,sort_index,is_active,created_at,updated_at",
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
