import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { InboxMessage } from "@/types/inbox";

export async function getMessages(
  conversationId: string,
): Promise<InboxMessage[]> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select(`
      id,
      platform_message_id,
      sender_platform_id,
      recipient_platform_id,
      direction,
      message_type,
      message_text,
      attachment_url,
      platform_created_at,
      created_at
    `)
    .eq("conversation_id", conversationId)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error(
      "Unable to load messages:",
      error,
    );

    throw new Error(
      "Unable to load messages.",
    );
  }

  return (data ?? []) as InboxMessage[];
}