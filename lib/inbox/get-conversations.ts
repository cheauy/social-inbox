import "server-only";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

import type {
  CustomerTag,
  InboxConversation,
} from "@/types/inbox";

type ContactTagRow = {
  contact_id: string;
  tag:
    | CustomerTag
    | CustomerTag[]
    | null;
};

function sortConversations(
  conversations:
    InboxConversation[],
) {
  return [
    ...conversations,
  ].sort(
    (
      first,
      second,
    ) => {
      const firstPinned =
        Boolean(
          first.is_pinned,
        );

      const secondPinned =
        Boolean(
          second.is_pinned,
        );

      if (
        firstPinned !==
        secondPinned
      ) {
        return firstPinned
          ? -1
          : 1;
      }

      return (
        new Date(
          second.last_message_at ??
            0,
        ).getTime() -
        new Date(
          first.last_message_at ??
            0,
        ).getTime()
      );
    },
  );
}

export async function getConversations(): Promise<
  InboxConversation[]
> {
  /*
   * V3.1.1:
   * supabaseAdmin bypasses RLS, so every Inbox query must be
   * explicitly scoped to the authenticated TENH business.
   */
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    throw new Error(
      authResult.error,
    );
  }

  const businessId =
    authResult.member
      .business_id;

  const {
    data,
    error,
  } = await supabaseAdmin
    .from(
      "conversations",
    )
    .select(`
      id,
      business_id,
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
    .eq(
      "business_id",
      businessId,
    )
    .order(
      "is_pinned",
      {
        ascending: false,
      },
    )
    .order(
      "last_message_at",
      {
        ascending: false,
        nullsFirst: false,
      },
    );

  if (error) {
    console.error(
      "Unable to load conversations:",
      error,
    );

    throw new Error(
      `Unable to load conversations: ${error.message}`,
    );
  }

  const conversations =
    (
      data ?? []
    ) as unknown as
      InboxConversation[];

  const contactIds =
    Array.from(
      new Set(
        conversations
          .map(
            (
              conversation,
            ) =>
              conversation
                .contact?.id,
          )
          .filter(
            (
              contactId,
            ): contactId is string =>
              Boolean(
                contactId,
              ),
          ),
      ),
    );

  if (
    contactIds.length ===
    0
  ) {
    return sortConversations(
      conversations.map(
        (
          conversation,
        ) => {
          if (
            !conversation.contact
          ) {
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
      ),
    );
  }

  const {
    data:
      contactTagRows,
    error:
      contactTagError,
  } = await supabaseAdmin
    .from(
      "contact_tags",
    )
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
    .in(
      "contact_id",
      contactIds,
    );

  if (
    contactTagError
  ) {
    console.error(
      "Unable to load customer tags:",
      contactTagError,
    );

    throw new Error(
      `Unable to load customer tags: ${contactTagError.message}`,
    );
  }

  const tagsByContact =
    new Map<
      string,
      CustomerTag[]
    >();

  for (
    const row of
      (
        contactTagRows ??
        []
      ) as unknown as
        ContactTagRow[]
  ) {
    const tag =
      Array.isArray(
        row.tag,
      )
        ? row.tag[0]
        : row.tag;

    if (!tag) {
      continue;
    }

    /*
     * The contact set is already business-scoped, but also ignore
     * a mismatched tag as a defense-in-depth check.
     */
    if (
      tag.business_id !==
      businessId
    ) {
      continue;
    }

    const existingTags =
      tagsByContact.get(
        row.contact_id,
      ) ?? [];

    existingTags.push(
      tag,
    );

    tagsByContact.set(
      row.contact_id,
      existingTags,
    );
  }

  const enriched =
    conversations.map(
      (
        conversation,
      ) => {
        if (
          !conversation.contact
        ) {
          return conversation;
        }

        const tags =
          tagsByContact.get(
            conversation.contact
              .id,
          ) ?? [];

        tags.sort(
          (
            first,
            second,
          ) =>
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

  return sortConversations(
    enriched,
  );
}
