import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  InboxMessage,
} from "@/types/inbox";

export async function getMessages(
  conversationId: string,
): Promise<InboxMessage[]> {
  const normalizedConversationId =
    conversationId.trim();

  if (!normalizedConversationId) {
    return [];
  }

  console.log(
  "Loading messages for:",
  conversationId,
);

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq(
      "conversation_id",
      normalizedConversationId,
    )
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error(
      "Unable to load messages:",
      {
        conversationId:
          normalizedConversationId,
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

  

  return (
    data ?? []
  ) as unknown as InboxMessage[];
}

