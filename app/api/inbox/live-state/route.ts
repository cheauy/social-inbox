import { withTenantReadScope } from "@/lib/server/tenant-read-scope";
import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getInboxConversationScope,
  getConversations,
} from "@/lib/inbox/get-conversations";
import { DISCOVERY_BATCH, validSyncCursor, type InboxSyncCursor } from "@/lib/inbox/live-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hiddenPersonalAccountIds } from "@/lib/telegram-personal/visibility";
import { chunkIds } from "@/lib/supabase/chunk-ids";
import type {
  ConversationStatus,
  CustomerTag,
  TeamMember,
} from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveStateBody = {
  conversationIds?: string[];
  cursor?: InboxSyncCursor;
  channelId?: string;
  workspaceId?: string;
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

async function handlePOST(
  request: NextRequest,
) {
  const syncStartedAt = new Date();
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

  if (!body || typeof body !== "object" || (body.cursor !== undefined && !validSyncCursor(body.cursor))) {
    return NextResponse.json({ success: false, error: "Invalid sync request." }, { status: 400 });
  }
  const conversationIds = normalizeIds(body.conversationIds);


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
        hydratedConversations: [],
        accessibleBusinessIds: [],
        activeChannelIds: [],
        hasMore: false,
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, max-age=0",
        },
      },
    );
  }

  const { data: channels, error: channelError } = await supabaseAdmin.from("social_accounts")
    .select("id,platform,facebook_token_status,telegram_token_status")
    .in("business_id", scope.accessibleBusinessIds).eq("is_active", true);
  if (channelError) return NextResponse.json({ success: false, error: "Unable to verify Inbox channels." }, { status: 503 });
  const hiddenPersonal = await hiddenPersonalAccountIds(scope.accessibleBusinessIds, scope.userId);
  const channelIds = (channels ?? []).filter(channel => !hiddenPersonal.includes(channel.id)).filter(channel => channel.platform === "telegram"
    ? channel.telegram_token_status === "verified" : channel.platform === "telegram_personal" ? true : channel.facebook_token_status !== "disconnected").map(channel => channel.id);
  if (!channelIds.length) return NextResponse.json({ success: true, conversations: [], hydratedConversations: [], accessibleBusinessIds: scope.accessibleBusinessIds, activeChannelIds: [], hasMore: false }, { headers: { "Cache-Control": "private, no-store" } });

  // The old endpoint only knew IDs already on the screen. An empty list or a
  // brand-new customer could therefore NEVER recover from a missed INSERT.
  // Page recent changes by (updated_at, id), with overlap after each drain.
  const cursor = body.cursor ?? { updatedAt: new Date(syncStartedAt.getTime() - 120_000).toISOString() };
  let discoveryQuery = supabaseAdmin.from("conversations").select("id,updated_at")
    .in("business_id", scope.accessibleBusinessIds).in("social_account_id", channelIds)
    .gte("updated_at", cursor.updatedAt);
  if (cursor.id) discoveryQuery = discoveryQuery.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`);
  const { data: discoveryData, error: discoveryError } = await discoveryQuery
    .order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(DISCOVERY_BATCH + 1);
  if (discoveryError) return NextResponse.json({ success: false, error: "Unable to discover Inbox changes." }, { status: 503 });
  const hasMore = (discoveryData?.length ?? 0) > DISCOVERY_BATCH;
  const discovered = (discoveryData ?? []).slice(0, DISCOVERY_BATCH);
  const lastDiscovered = discovered[discovered.length - 1];
  const nextCursor: InboxSyncCursor = hasMore && lastDiscovered
    ? { updatedAt: lastDiscovered.updated_at, id: lastDiscovered.id }
    : { updatedAt: new Date(Math.max(Date.parse(cursor.updatedAt) || 0, syncStartedAt.getTime() - 10_000)).toISOString() };
  const hydratedConversations = discovered.length ? await getConversations(scope.accessibleBusinessIds, {
    conversationIds: discovered.map(row => row.id),
    channelId: typeof body.channelId === "string" ? body.channelId : null,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
  }) : [];
  const queryIds = [...new Set([...conversationIds, ...hydratedConversations.map(row => row.id)])];

  /*
   * Batched because conversationIds comes straight from the client: it is every
   * conversation the Inbox currently has on screen, so it grows with the
   * customer's data. Sent as one .in() filter it built a request URL past the
   * 16KB header limit and undici refused it, which arrived here as a 500 and,
   * in the browser, as "Unable to synchronize Inbox state".
   */
  const conversationBatches = await Promise.all(
    chunkIds(queryIds).map((batch) =>
      supabaseAdmin
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
        .in("id", batch)
        .in("social_account_id", channelIds)
        .in(
          "business_id",
          scope.accessibleBusinessIds,
        ),
    ),
  );

  const conversationError =
    conversationBatches.find(
      (batch) => batch.error,
    )?.error ?? null;

  const conversationData = conversationError
    ? null
    : conversationBatches.flatMap(
        (batch) => batch.data ?? [],
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
    const contactTagBatches = await Promise.all(
      chunkIds(contactIds).map((batch) =>
        supabaseAdmin
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
          .in("contact_id", batch),
      ),
    );

    const contactTagError =
      contactTagBatches.find(
        (batch) => batch.error,
      )?.error ?? null;

    const contactTagData = contactTagError
      ? null
      : contactTagBatches.flatMap(
          (batch) => batch.data ?? [],
        );

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
      hydratedConversations,
      cursor: nextCursor,
      hasMore,
      accessibleBusinessIds: scope.accessibleBusinessIds,
      activeChannelIds: channelIds,
      syncedAt: syncStartedAt.toISOString(),
    },
    {
      headers: {
        "Cache-Control":
          "private, no-store, max-age=0",
      },
    },
  );
}

export const POST = withTenantReadScope(async (request: NextRequest) => {
  try { return await handlePOST(request); }
  catch { return NextResponse.json({ success: false, error: "Unable to synchronize Inbox state. Please retry." }, { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
});
