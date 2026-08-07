import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  CustomerTag,
  InboxConversation,
  MessageDirection,
} from "@/types/inbox";

type ContactTagRow = {
  contact_id: string;
  tag:
    | CustomerTag
    | CustomerTag[]
    | null;
};

type LatestMessageRow = {
  conversation_id: string;
  direction: MessageDirection;
  message_type:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "file"
    | "sticker"
    | "unknown";
  created_at: string;
};

export async function getConversations(): Promise<
  InboxConversation[]
> {
  const { data, error } =
    await supabaseAdmin
      .from("conversations")
      .select(`
        id,
        status,
        unread_count,
        last_message_text,
        last_message_at,
        is_pinned,
        pinned_at,
        pinned_by,
        source_type,
        facebook_post_id,
        facebook_comment_id,
        parent_comment_id,
        assigned_to,
        assigned_at,

        assigned_member:team_members (
          id,
          full_name,
          email,
          role,
          profile_picture_url
        ),

        contact:contacts (
          id,
          business_id,
          full_name,
          profile_picture_url,
          platform_user_id,
          phone,
          email,
          address,
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
       .order("is_pinned", {
      ascending: false,
    })
    .order("pinned_at", {
      ascending: false,
      nullsFirst: false,
    })
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
    (data ??
      []) as unknown as InboxConversation[];

  const conversationIds =
    conversations.map(
      (conversation) =>
        conversation.id,
    );

  const latestMessagesByConversation =
    new Map<
      string,
      LatestMessageRow
    >();

  if (
    conversationIds.length > 0
  ) {
    const {
      data: messageRows,
      error: messageError,
    } = await supabaseAdmin
      .from("messages")
      .select(`
        conversation_id,
        direction,
        message_type,
        created_at
      `)
      .in(
        "conversation_id",
        conversationIds,
      )
      .order("created_at", {
        ascending: false,
      });

    if (messageError) {
      console.error(
        "Unable to load latest conversation messages:",
        messageError,
      );

      throw new Error(
        "Unable to load latest conversation messages.",
      );
    }

    for (
      const row of
        (messageRows ??
          []) as LatestMessageRow[]
    ) {
      if (
        latestMessagesByConversation.has(
          row.conversation_id,
        )
      ) {
        continue;
      }

      latestMessagesByConversation.set(
        row.conversation_id,
        row,
      );
    }
  }

  const conversationsWithLatestMessage =
    conversations.map(
      (conversation) => {
        const latestMessage =
          latestMessagesByConversation.get(
            conversation.id,
          );

        return {
          ...conversation,

          latest_message_type:
            latestMessage?.message_type ??
            null,

          latest_message_direction:
            latestMessage?.direction ??
            null,
        };
      },
    );

  const contactIds =
    conversationsWithLatestMessage
      .map(
        (conversation) =>
          conversation.contact?.id,
      )
      .filter(
        (
          contactId,
        ): contactId is string =>
          Boolean(contactId),
      );

  if (contactIds.length === 0) {
    return conversationsWithLatestMessage.map(
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

  const tagsByContact =
    new Map<
      string,
      CustomerTag[]
    >();

  for (
    const row of
      (contactTagRows ??
        []) as unknown as ContactTagRow[]
  ) {
    const tag =
      Array.isArray(row.tag)
        ? row.tag[0]
        : row.tag;

    if (!tag) {
      continue;
    }

    const existingTags =
      tagsByContact.get(
        row.contact_id,
      ) ?? [];

    existingTags.push(tag);

    tagsByContact.set(
      row.contact_id,
      existingTags,
    );
  }

  return conversationsWithLatestMessage.map(
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