import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  CustomerTag,
  InboxConversation,
} from "@/types/inbox";

type ContactTagRow = {
  contact_id: string;
  tag: CustomerTag | CustomerTag[] | null;
};

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
        business_id,
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

  const conversations =
    (data ?? []) as unknown as InboxConversation[];

  const contactIds = conversations
    .map(
      (conversation) =>
        conversation.contact?.id,
    )
    .filter(
      (contactId): contactId is string =>
        Boolean(contactId),
    );

  if (contactIds.length === 0) {
    return conversations.map(
      (conversation) => {
        if (!conversation.contact) {
          return conversation;
        }

        return {
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [],
          },
        };
      },
    );
  }

  const {
    data: contactTagRows,
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
      "Unable to load customer tags:",
      contactTagError,
    );

    throw new Error(
      "Unable to load customer tags.",
    );
  }

  const tagsByContact = new Map<
    string,
    CustomerTag[]
  >();

  for (
    const row of
      (contactTagRows ??
        []) as unknown as ContactTagRow[]
  ) {
    const tag = Array.isArray(row.tag)
      ? row.tag[0]
      : row.tag;

    if (!tag) {
      continue;
    }

    const existingTags =
      tagsByContact.get(row.contact_id) ?? [];

    existingTags.push(tag);

    tagsByContact.set(
      row.contact_id,
      existingTags,
    );
  }

  return conversations.map(
    (conversation) => {
      if (!conversation.contact) {
        return conversation;
      }

      const tags =
        tagsByContact.get(
          conversation.contact.id,
        ) ?? [];

      tags.sort(
        (first, second) =>
          first.sort_index -
            second.sort_index ||
          first.name.localeCompare(
            second.name,
          ),
      );

      return {
        ...conversation,
        contact: {
          ...conversation.contact,
          tags,
        },
      };
    },
  );
}