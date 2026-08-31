import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getInboxConversationScope,
} from "@/lib/inbox/get-conversations";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  ConversationStatus,
  CustomerTag,
  TeamMember,
} from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveStateBody = {
  conversationIds?: string[];
};

/*
 * Small health response so this App Router endpoint can be verified directly
 * after a dev-server restart without changing any Inbox state.
 */
export async function GET() {
  return NextResponse.json(
    {
      success: true,
      route: "inbox-live-state",
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, max-age=0",
      },
    },
  );
}

type ContactTagRow = {
  contact_id: string;
  tag:
    | CustomerTag
    | CustomerTag[]
    | null;
};

type ConversationRow = {
  id: string;
  business_id: string;
  contact_id: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  pinned_by: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  status: ConversationStatus;
  status_updated_at: string | null;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
  updated_at: string | null;
  assigned_member:
    | TeamMember
    | TeamMember[]
    | null;
};

function getSingleResult<T>(
  value: T | T[] | null,
): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function normalizeIds(
  values: unknown,
): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter(
          (value): value is string =>
            typeof value === "string",
        )
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 500);
}

export async function POST(
  request: NextRequest,
) {
  let body: LiveStateBody;

  try {
    body =
      (await request.json()) as LiveStateBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const conversationIds =
    normalizeIds(body.conversationIds);

  if (conversationIds.length === 0) {
    return NextResponse.json(
      {
        success: true,
        conversations: [],
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, max-age=0",
        },
      },
    );
  }

  let scope;

  try {
    scope =
      await getInboxConversationScope();
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify Inbox access.",
      },
      { status: 401 },
    );
  }

  if (
    scope.accessibleBusinessIds.length ===
    0
  ) {
    return NextResponse.json(
      {
        success: true,
        conversations: [],
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, max-age=0",
        },
      },
    );
  }

  const {
    data: conversationData,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      contact_id,
      is_pinned,
      pinned_at,
      pinned_by,
      assigned_to,
      assigned_at,
      status,
      status_updated_at,
      unread_count,
      last_message_text,
      last_message_at,
      updated_at,
      assigned_member:team_members!conversations_assigned_to_fkey (
        id,
        business_id,
        full_name,
        email,
        role,
        profile_picture_url
      )
    `)
    .in("id", conversationIds)
    .in(
      "business_id",
      scope.accessibleBusinessIds,
    );

  if (conversationError) {
    console.error(
      "Unable to load collaborative Inbox state:",
      conversationError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to synchronize Inbox state.",
      },
      { status: 500 },
    );
  }

  const conversations =
    (conversationData ?? []) as unknown as ConversationRow[];

  const contactIds = Array.from(
    new Set(
      conversations
        .map(
          (conversation) =>
            conversation.contact_id,
        )
        .filter(
          (contactId): contactId is string =>
            Boolean(contactId),
        ),
    ),
  );

  const tagsByContact =
    new Map<string, CustomerTag[]>();

  if (contactIds.length > 0) {
    const {
      data: contactTagData,
      error: contactTagError,
    } = await supabaseAdmin
      .from("contact_tags")
      .select(`
        contact_id,
        tag:tags (
          id,
          business_id,
          name,
          color,
          sort_index,
          description,
          is_active,
          created_at,
          updated_at
        )
      `)
      .in("contact_id", contactIds);

    if (contactTagError) {
      console.error(
        "Unable to load collaborative customer tags:",
        contactTagError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to synchronize customer tags.",
        },
        { status: 500 },
      );
    }

    const allowedBusinessIds =
      new Set(
        scope.accessibleBusinessIds,
      );

    for (
      const row of
        (contactTagData ?? []) as unknown as ContactTagRow[]
    ) {
      const tag =
        getSingleResult(row.tag);

      if (
        !tag ||
        !allowedBusinessIds.has(
          tag.business_id,
        )
      ) {
        continue;
      }

      const current =
        tagsByContact.get(row.contact_id) ?? [];

      current.push(tag);
      tagsByContact.set(
        row.contact_id,
        current,
      );
    }
  }

  const responseConversations =
    conversations.map((conversation) => {
      const tags =
        conversation.contact_id
          ? [
              ...(tagsByContact.get(
                conversation.contact_id,
              ) ?? []),
            ]
          : [];

      tags.sort(
        (first, second) =>
          first.sort_index -
            second.sort_index ||
          first.name.localeCompare(
            second.name,
          ),
      );

      return {
        id: conversation.id,
        business_id:
          conversation.business_id,
        contact_id:
          conversation.contact_id,
        is_pinned:
          Boolean(conversation.is_pinned),
        pinned_at:
          conversation.pinned_at,
        pinned_by:
          conversation.pinned_by,
        assigned_to:
          conversation.assigned_to,
        assigned_at:
          conversation.assigned_at,
        status:
          conversation.status,
        status_updated_at:
          conversation.status_updated_at,
        unread_count:
          Math.max(0, conversation.unread_count ?? 0),
        last_message_text:
          conversation.last_message_text,
        last_message_at:
          conversation.last_message_at,
        assigned_member:
          getSingleResult(
            conversation.assigned_member,
          ),
        updated_at:
          conversation.updated_at,
        tags,
      };
    });

  return NextResponse.json(
    {
      success: true,
      conversations:
        responseConversations,
      syncedAt:
        new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, max-age=0",
      },
    },
  );
}
