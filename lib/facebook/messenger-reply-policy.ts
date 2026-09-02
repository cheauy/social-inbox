import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

type MessengerPolicyMessageRow = {
  direction?: string | null;
  platform_created_at?: string | null;
  created_at?: string | null;
  raw_payload?: unknown;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function cleanString(
  value: unknown,
) {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

function getRowTimestampMs(
  row: MessengerPolicyMessageRow,
) {
  const value =
    row.platform_created_at ??
    row.created_at ??
    null;

  if (!value) {
    return Number.NaN;
  }

  return Date.parse(value);
}

function isFacebookCommentPayload(
  rawPayload: unknown,
) {
  if (!isRecord(rawPayload)) {
    return false;
  }

  const source =
    cleanString(rawPayload.source)
      ?.toLowerCase() ?? "";
  const tenhSource =
    cleanString(rawPayload.tenh_source)
      ?.toLowerCase() ?? "";

  return (
    cleanString(rawPayload.item)
      ?.toLowerCase() === "comment" ||
    Boolean(cleanString(rawPayload.comment_id)) ||
    source === "facebook_comment_reply" ||
    tenhSource.includes("comment_reply") ||
    tenhSource === "facebook_page_reply"
  );
}

function isDirectFacebookMessengerInbound(
  rawPayload: unknown,
) {
  if (!isRecord(rawPayload)) {
    return false;
  }

  const message = rawPayload.message;

  if (!isRecord(message)) {
    return false;
  }

  return (
    Boolean(cleanString(message.mid)) &&
    message.is_echo !== true
  );
}

function isDirectFacebookMessengerOutgoing(
  row: MessengerPolicyMessageRow,
) {
  if (row.direction !== "outgoing") {
    return false;
  }

  if (
    isFacebookCommentPayload(
      row.raw_payload,
    )
  ) {
    return false;
  }

  if (isRecord(row.raw_payload)) {
    const message =
      row.raw_payload.message;

    if (
      isRecord(message) &&
      message.is_echo === true
    ) {
      return true;
    }
  }

  /*
   * TENH's own Messenger send route stores Meta's compact
   * { recipient_id, message_id } result as raw_payload. Optimistic rows are
   * client-only and never reach this server helper.
   */
  return true;
}

export type FacebookMessengerReplyPolicy = {
  hasRecentDirectCustomerMessage: boolean;
  latestDirectIncomingAt: string | null;
  latestIncomingCommentAt: string | null;
  latestDirectOutgoingAt: string | null;
  waitingForCustomerReply: boolean;
};

export async function getFacebookMessengerReplyPolicy(
  conversationId: string,
): Promise<FacebookMessengerReplyPolicy> {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("messages")
    .select(
      "direction,platform_created_at,created_at,raw_payload",
    )
    .eq(
      "conversation_id",
      conversationId,
    )
    .order("created_at", {
      ascending: false,
    })
    .limit(100);

  if (error) {
    throw new Error(
      `Unable to inspect the Facebook messaging window: ${error.message}`,
    );
  }

  const rows =
    (data ?? []) as MessengerPolicyMessageRow[];

  let latestDirectIncoming:
    MessengerPolicyMessageRow | null = null;
  let latestIncomingComment:
    MessengerPolicyMessageRow | null = null;
  let latestDirectOutgoing:
    MessengerPolicyMessageRow | null = null;

  for (const row of rows) {
    if (
      !latestDirectIncoming &&
      row.direction === "incoming" &&
      isDirectFacebookMessengerInbound(
        row.raw_payload,
      )
    ) {
      latestDirectIncoming = row;
    }

    if (
      !latestIncomingComment &&
      row.direction === "incoming" &&
      isFacebookCommentPayload(
        row.raw_payload,
      )
    ) {
      latestIncomingComment = row;
    }

    if (
      !latestDirectOutgoing &&
      isDirectFacebookMessengerOutgoing(
        row,
      )
    ) {
      latestDirectOutgoing = row;
    }

    if (
      latestDirectIncoming &&
      latestIncomingComment &&
      latestDirectOutgoing
    ) {
      break;
    }
  }

  const latestDirectIncomingAt =
    latestDirectIncoming
      ? latestDirectIncoming.platform_created_at ??
        latestDirectIncoming.created_at ??
        null
      : null;
  const latestIncomingCommentAt =
    latestIncomingComment
      ? latestIncomingComment.platform_created_at ??
        latestIncomingComment.created_at ??
        null
      : null;
  const latestDirectOutgoingAt =
    latestDirectOutgoing
      ? latestDirectOutgoing.platform_created_at ??
        latestDirectOutgoing.created_at ??
        null
      : null;

  const latestDirectIncomingAtMs =
    latestDirectIncoming
      ? getRowTimestampMs(
          latestDirectIncoming,
        )
      : Number.NaN;
  const latestIncomingCommentAtMs =
    latestIncomingComment
      ? getRowTimestampMs(
          latestIncomingComment,
        )
      : Number.NaN;
  const latestDirectOutgoingAtMs =
    latestDirectOutgoing
      ? getRowTimestampMs(
          latestDirectOutgoing,
        )
      : Number.NaN;

  const hasRecentDirectCustomerMessage =
    Number.isFinite(
      latestDirectIncomingAtMs,
    ) &&
    Date.now() - latestDirectIncomingAtMs >= 0 &&
    Date.now() - latestDirectIncomingAtMs <
      24 * 60 * 60 * 1000;

  /*
   * Safe private-reply state:
   * - a Facebook comment is the newest customer interaction that can start a
   *   private reply,
   * - TENH already sent one direct Messenger message after that comment,
   * - the customer has not opened a current Messenger window by replying.
   *
   * This never groups customers by name and never guesses identity; it uses
   * only rows already tied to this exact conversation.
   */
  const waitingForCustomerReply =
    !hasRecentDirectCustomerMessage &&
    Number.isFinite(
      latestIncomingCommentAtMs,
    ) &&
    Number.isFinite(
      latestDirectOutgoingAtMs,
    ) &&
    latestDirectOutgoingAtMs >=
      latestIncomingCommentAtMs;

  return {
    hasRecentDirectCustomerMessage,
    latestDirectIncomingAt,
    latestIncomingCommentAt,
    latestDirectOutgoingAt,
    waitingForCustomerReply,
  };
}
