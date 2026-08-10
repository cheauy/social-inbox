import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  InboxMessage,
} from "@/types/inbox";

export const MESSAGE_PAGE_SIZE = 50;

export type MessageCursor = {
  createdAt: string;
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
   * Stable cursor:
   * created_at DESC, id DESC
   *
   * If two messages share the same created_at value,
   * the id tie-breaker prevents duplicates or skipped rows.
   */
  if (before) {
    query = query.or(
      [
        `created_at.lt.${before.createdAt}`,
        `and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
      ].join(","),
    );
  }

  const {
    data,
    error,
  } = await query
    .order("created_at", {
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
            createdAt:
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
