import "server-only";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export type FacebookMessageStatusEvent = {
  sender?: {
    id?: string;
  };

  recipient?: {
    id?: string;
  };

  /*
   * Messenger webhook timestamps are milliseconds.
   */
  timestamp?: number;

  delivery?: {
    mids?: string[];
    watermark?: number;
    seq?: number;
  };

  read?: {
    watermark?: number;
    seq?: number;
  };
};

function toIsoFromMilliseconds(
  value?: number,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return new Date().toISOString();
  }

  return new Date(
    value,
  ).toISOString();
}

async function getConversationForStatusEvent({
  customerId,
  pageId,
}: {
  customerId: string;
  pageId: string;
}) {
  const {
    data: socialAccount,
    error: socialAccountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id
    `)
    .eq(
      "platform",
      "facebook",
    )
    .eq(
      "platform_account_id",
      pageId,
    )
    .eq(
      "is_active",
      true,
    )
    .maybeSingle();

  if (socialAccountError) {
    throw new Error(
      socialAccountError.message,
    );
  }

  if (!socialAccount) {
    console.warn(
      "[Facebook status] Social account was not found.",
      {
        pageId,
      },
    );

    return null;
  }

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq(
      "business_id",
      socialAccount.business_id,
    )
    .eq(
      "platform",
      "facebook",
    )
    .eq(
      "platform_user_id",
      customerId,
    )
    .maybeSingle();

  if (contactError) {
    throw new Error(
      contactError.message,
    );
  }

  if (!contact) {
    console.warn(
      "[Facebook status] Contact was not found.",
      {
        customerId,
      },
    );

    return null;
  }

  const {
    data: conversation,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq(
      "social_account_id",
      socialAccount.id,
    )
    .eq(
      "contact_id",
      contact.id,
    )
    .maybeSingle();

  if (conversationError) {
    throw new Error(
      conversationError.message,
    );
  }

  if (!conversation) {
    console.warn(
      "[Facebook status] Conversation was not found.",
      {
        customerId,
      },
    );

    return null;
  }

  return conversation;
}

async function markDelivered({
  conversationId,
  mids,
  watermark,
  eventTimestamp,
}: {
  conversationId: string;
  mids: string[];
  watermark?: number;
  eventTimestamp?: number;
}) {
  const deliveredAt =
    toIsoFromMilliseconds(
      eventTimestamp ??
        watermark,
    );

  /*
   * Best case:
   * Meta gives us exact message IDs.
   *
   * Updating by MID avoids touching Facebook comment replies.
   */
  if (mids.length > 0) {
    const {
      error,
    } = await supabaseAdmin
      .from("messages")
      .update({
        delivery_status:
          "delivered",

        delivered_at:
          deliveredAt,
      })
      .eq(
        "conversation_id",
        conversationId,
      )
      .eq(
        "direction",
        "outgoing",
      )
      .is(
        "seen_at",
        null,
      )
      .in(
        "platform_message_id",
        mids,
      );

    if (error) {
      throw new Error(
        error.message,
      );
    }
  }

  /*
   * Some delivery notifications can also contain a watermark.
   *
   * Only rows that already have delivery_status are eligible.
   * Tenh Chat sets delivery_status='sent' only for Messenger sends,
   * so Facebook comment replies remain excluded.
   */
  if (watermark) {
    const watermarkIso =
      toIsoFromMilliseconds(
        watermark,
      );

    const {
      error,
    } = await supabaseAdmin
      .from("messages")
      .update({
        delivery_status:
          "delivered",

        delivered_at:
          deliveredAt,
      })
      .eq(
        "conversation_id",
        conversationId,
      )
      .eq(
        "direction",
        "outgoing",
      )
      .not(
        "delivery_status",
        "is",
        null,
      )
      .is(
        "seen_at",
        null,
      )
      .lte(
        "platform_created_at",
        watermarkIso,
      );

    if (error) {
      throw new Error(
        error.message,
      );
    }
  }
}

async function markSeen({
  conversationId,
  watermark,
  eventTimestamp,
}: {
  conversationId: string;
  watermark: number;
  eventTimestamp?: number;
}) {
  const watermarkIso =
    toIsoFromMilliseconds(
      watermark,
    );

  const seenAt =
    toIsoFromMilliseconds(
      eventTimestamp ??
        watermark,
    );

  /*
   * Messenger read notifications use a watermark:
   * messages at/before it have been read.
   *
   * delivery_status IS NOT NULL is our Messenger-only guard.
   * Comment replies are left with delivery_status = NULL.
   */
  const {
    error,
  } = await supabaseAdmin
    .from("messages")
    .update({
      delivery_status:
        "seen",

      seen_at:
        seenAt,
    })
    .eq(
      "conversation_id",
      conversationId,
    )
    .eq(
      "direction",
      "outgoing",
    )
    .not(
      "delivery_status",
      "is",
      null,
    )
    .lte(
      "platform_created_at",
      watermarkIso,
    );

  if (error) {
    throw new Error(
      error.message,
    );
  }
}

export async function processFacebookMessageStatus(
  event:
    FacebookMessageStatusEvent,
) {
  const configuredPageId =
    process.env
      .FACEBOOK_PAGE_ID
      ?.trim();

  if (!configuredPageId) {
    throw new Error(
      "FACEBOOK_PAGE_ID is missing.",
    );
  }

  const senderId =
    event.sender?.id?.trim() ??
    "";

  const recipientId =
    event.recipient?.id?.trim() ??
    "";

  /*
   * For delivery/read notifications the customer normally
   * appears as sender and the Page as recipient.
   *
   * Support either orientation so the handler stays robust.
   */
  let customerId = "";

  if (
    recipientId ===
    configuredPageId
  ) {
    customerId =
      senderId;
  } else if (
    senderId ===
    configuredPageId
  ) {
    customerId =
      recipientId;
  } else {
    console.warn(
      "[Facebook status] Event is not for the configured Page.",
      {
        senderId,
        recipientId,
        configuredPageId,
      },
    );

    return;
  }

  if (!customerId) {
    return;
  }

  const conversation =
    await getConversationForStatusEvent(
      {
        customerId,
        pageId:
          configuredPageId,
      },
    );

  if (!conversation) {
    return;
  }

  if (event.delivery) {
    const mids =
      (
        event.delivery
          .mids ??
        []
      )
        .map(
          (mid) =>
            mid.trim(),
        )
        .filter(Boolean);

    await markDelivered({
      conversationId:
        conversation.id,

      mids,

      watermark:
        event.delivery
          .watermark,

      eventTimestamp:
        event.timestamp,
    });

    console.log(
      "[Facebook status] DELIVERED",
      {
        conversationId:
          conversation.id,
        mids,
        watermark:
          event.delivery
            .watermark,
      },
    );
  }

  if (
    event.read?.watermark
  ) {
    await markSeen({
      conversationId:
        conversation.id,

      watermark:
        event.read
          .watermark,

      eventTimestamp:
        event.timestamp,
    });

    console.log(
      "[Facebook status] SEEN",
      {
        conversationId:
          conversation.id,
        watermark:
          event.read
            .watermark,
      },
    );
  }
}