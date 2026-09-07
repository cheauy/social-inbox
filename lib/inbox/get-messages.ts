import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  InboxMessage,
} from "@/types/inbox";

export const MESSAGE_PAGE_SIZE = 50;

/*
 * `sentAt` is the platform's own timestamp, not the row's insert time. The two
 * agree for a message that arrived by webhook and disagree for every message
 * pulled in by the recovery pass, which writes them in whatever order it
 * fetched them.
 */
export type MessageCursor = {
  sentAt: string;
  id: string;
};

export type MessagePage = {
  messages: InboxMessage[];
  hasMore: boolean;
  nextCursor: MessageCursor | null;
};

type GetMessagePageInput = {
  conversationId: string;
  before?: MessageCursor | null;
  limit?: number;
};

function normalizePageSize(
  value: number | undefined,
) {
  if (
    !Number.isFinite(value) ||
    !value
  ) {
    return MESSAGE_PAGE_SIZE;
  }

  return Math.min(
    100,
    Math.max(
      1,
      Math.floor(value),
    ),
  );
}

export async function getMessagePage({
  conversationId,
  before = null,
  limit = MESSAGE_PAGE_SIZE,
}: GetMessagePageInput): Promise<MessagePage> {
  const normalizedConversationId =
    conversationId.trim();

  if (!normalizedConversationId) {
    return {
      messages: [],
      hasMore: false,
      nextCursor: null,
    };
  }

  const pageSize =
    normalizePageSize(limit);

  let query =
    supabaseAdmin
      .from("messages")
      .select("*")
      .eq(
        "conversation_id",
        normalizedConversationId,
      );

  /*
   * Ordered by when the message was sent, not when TENH stored it.
   *
   * These are the same thing for a message that arrives by webhook, and
   * different for every message the recovery pass pulls in -- it fetches them
   * per conversation, so a 12:58 message can be written after a 1:01 one. The
   * list was sorted by insert time while the bubbles showed platform time, so
   * a recovered conversation displayed its messages out of order, with the
   * timestamps visibly disagreeing with the sequence.
   *
   * platform_created_at is set on every message in the table, so there is no
   * null case to fall back on.
   *
   * Stable cursor: platform_created_at DESC, id DESC. The id tie-breaker
   * matters more here than it did -- a recovery pass can give several messages
   * the same platform timestamp, and without it they would repeat or vanish
   * across page boundaries.
   */
  if (before) {
    query = query.or(
      [
        `platform_created_at.lt.${before.sentAt}`,
        `and(platform_created_at.eq.${before.sentAt},id.lt.${before.id})`,
      ].join(","),
    );
  }

  const {
    data,
    error,
  } = await query
    .order("platform_created_at", {
      ascending: false,
    })
    .order("id", {
      ascending: false,
    })
    .limit(
      pageSize + 1,
    );

  if (error) {
    console.error(
      "Unable to load message page:",
      {
        conversationId:
          normalizedConversationId,
        before,
        pageSize,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    );

    throw new Error(
      `Unable to load messages: ${error.message}`,
    );
  }

  const rows =
    (data ?? []) as unknown as InboxMessage[];

  const hasMore =
    rows.length > pageSize;

  /*
   * Database query is newest → oldest so LIMIT is efficient.
   * The UI renders oldest → newest, therefore reverse only the
   * rows included in this page.
   */
  const pageMessages =
    rows
      .slice(
        0,
        pageSize,
      )
      .reverse();

  const oldestMessage =
    pageMessages[0] ?? null;

  return {
    messages:
      pageMessages,
    hasMore,
    nextCursor:
      hasMore &&
      oldestMessage
        ? {
            sentAt:
              oldestMessage.platform_created_at ??
              oldestMessage.created_at,
            id:
              oldestMessage.id,
          }
        : null,
  };
}

/*
 * Existing Inbox page helper.
 *
 * V2.7 changes this from "load every message" to
 * "load only the newest page".
 */
export async function getMessages(
  conversationId: string,
): Promise<InboxMessage[]> {
  console.log(
    "Loading newest messages for:",
    conversationId,
  );

  const page =
    await getMessagePage({
      conversationId,
      limit:
        MESSAGE_PAGE_SIZE,
    });

  return page.messages;
}
