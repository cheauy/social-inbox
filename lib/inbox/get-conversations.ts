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

type ActiveMembershipRow = {
  business_id: string;
};

type SubscriptionStateRow = {
  id: string;
  business_id: string;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at?: string | null;
};

const OPERATIONAL_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperationalSubscription(subscription: SubscriptionStateRow | null) {
  if (!subscription) {
    // Preserve legacy/unmanaged workspaces until they are migrated.
    return true;
  }

  if (!OPERATIONAL_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return false;
  }

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

async function loadLatestSubscriptions(businessIds: string[]) {
  if (businessIds.length === 0) {
    return new Map<string, SubscriptionStateRow>();
  }

  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select(
      "id,business_id,status,current_period_end,trial_ends_at,created_at",
    )
    .in("business_id", businessIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Unable to verify TENH subscription access: ${error.message}`,
    );
  }

  const latest = new Map<string, SubscriptionStateRow>();

  for (const row of (data ?? []) as SubscriptionStateRow[]) {
    if (!latest.has(row.business_id)) {
      latest.set(row.business_id, row);
    }
  }

  return latest;
}

export type InboxConversationScope = {
  currentBusinessId: string;
  accessibleBusinessIds: string[];
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

/*
 * V3.11.31.39 — All Channels scope.
 *
 * The channel selector can contain channels from more than one TENH
 * subscription. "All Channels" therefore needs every subscription the
 * signed-in user still actively belongs to, not only the workspace saved in
 * the active-business cookie.
 *
 * Removed/inactive memberships are intentionally excluded here. Their
 * channels may remain visible in the selector as a red access notice, but
 * their conversations must never be returned by All Channels.
 */
export async function getInboxConversationScope(): Promise<
  InboxConversationScope
> {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    throw new Error(
      authResult.error,
    );
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("team_members")
    .select("business_id")
    .eq(
      "user_id",
      authResult.user.id,
    )
    .eq("is_active", true)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    console.error(
      "Unable to load Inbox subscription scope:",
      error,
    );

    throw new Error(
      "Unable to load your accessible TENH subscriptions.",
    );
  }

  const memberBusinessIds =
    Array.from(
      new Set(
        ((data ?? []) as ActiveMembershipRow[])
          .map((membership) => membership.business_id)
          .filter(Boolean),
      ),
    );

  const subscriptions = await loadLatestSubscriptions(memberBusinessIds);

  const accessibleBusinessIds = memberBusinessIds.filter((businessId) =>
    isOperationalSubscription(subscriptions.get(businessId) ?? null),
  );

  return {
    currentBusinessId:
      authResult.member.business_id,
    accessibleBusinessIds,
  };
}

export async function getConversations(
  businessIds?: string[],
): Promise<
  InboxConversation[]
> {
  let scopedBusinessIds =
    Array.from(
      new Set(
        (businessIds ?? [])
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    );

  if (
    scopedBusinessIds.length ===
    0
  ) {
    const scope =
      await getInboxConversationScope();

    scopedBusinessIds =
      scope.accessibleBusinessIds;
  }

  if (
    scopedBusinessIds.length ===
    0
  ) {
    return [];
  }

  const subscriptionByBusiness =
    await loadLatestSubscriptions(scopedBusinessIds);

  /*
   * Disabled channels keep their TENH history but must not appear in Inbox
   * or All Channels. Resolve the currently enabled social_account ids first
   * and scope the conversation query to those ids only.
   */
  const {
    data: activeChannelData,
    error: activeChannelError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select("id,platform,facebook_token_status,telegram_token_status")
    .in(
      "business_id",
      scopedBusinessIds,
    )
    .eq("is_active", true);

  if (activeChannelError) {
    console.error(
      "Unable to load active Inbox channels:",
      activeChannelError,
    );

    throw new Error(
      "Unable to load active TENH channels.",
    );
  }

  const activeChannelIds =
    (activeChannelData ?? [])
      .filter((channel) => {
        if (channel.platform === "telegram") {
          return channel.telegram_token_status === "verified";
        }

        if (channel.platform === "facebook") {
          // Legacy connected Facebook rows may have a NULL token status. Only
          // an explicit full Disconnect releases/removes them from Inbox.
          return channel.facebook_token_status !== "disconnected";
        }

        return true;
      })
      .map((channel) =>
        String(channel.id ?? "").trim(),
      )
      .filter(Boolean);

  if (activeChannelIds.length === 0) {
    return [];
  }

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
        platform,
        platform_account_id
      )
    `)
    .in(
      "business_id",
      scopedBusinessIds,
    )
    .in(
      "social_account_id",
      activeChannelIds,
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

  const conversationsWithSubscription =
    conversations.map((conversation) => ({
      ...conversation,
      subscription_id:
        subscriptionByBusiness.get(conversation.business_id)?.id ?? null,
    }));

  const contactIds =
    Array.from(
      new Set(
        conversationsWithSubscription
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
      conversationsWithSubscription.map(
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

  const allowedBusinessIds =
    new Set(
      scopedBusinessIds,
    );

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
     * supabaseAdmin bypasses RLS. Only keep tags from subscriptions included
     * in the authenticated user's active Inbox scope.
     */
    if (
      !allowedBusinessIds.has(
        tag.business_id,
      )
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
    conversationsWithSubscription.map(
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
