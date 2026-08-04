import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  ConversationActivity,
} from "@/types/inbox";

export async function getConversationActivity(
  conversationId: string,
): Promise<ConversationActivity[]> {
  const { data, error } =
    await supabaseAdmin
      .from("conversation_activity")
      .select(`
        id,
        business_id,
        conversation_id,
        contact_id,
        actor_member_id,
        activity_type,
        title,
        description,
        customer_name,
        actor_name,
        actor_profile_picture_url,
        metadata,
        created_at
      `)
      .eq(
        "conversation_id",
        conversationId,
      )
      .order("created_at", {
        ascending: false,
      });

  if (error) {
    console.error(
      "Unable to load conversation activity:",
      error,
    );

    throw new Error(
      "Unable to load conversation activity.",
    );
  }

  return (
    data ?? []
  ) as ConversationActivity[];
}