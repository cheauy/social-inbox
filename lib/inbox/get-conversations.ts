import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { InboxConversation } from "@/types/inbox";

export async function getConversations(): Promise<
  InboxConversation[]
> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      status,
      unread_count,
      last_message_text,
      last_message_at,
      assigned_to,
      assigned_at,
      assigned_member:team_members (
        id,
        full_name,
        email,
        role
      ),
      contact:contacts (
        id,
        full_name,
        profile_picture_url,
        platform_user_id,
        phone,
        email,
        company_name,
        customer_note,
        created_at,
        last_contact_at
      ),
      social_account:social_accounts (
        id,
        account_name,
        platform_account_id
      )
    `)
    .order("last_message_at", {
      ascending: false,
      nullsFirst: false,
    });

  if (error) {
    console.error(
      "Unable to load conversations:",
      error,
    );

    throw new Error(
      "Unable to load conversations.",
    );
  }

  return (data ?? []) as unknown as InboxConversation[];
}
