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

function isNewerPolicyRow(
  candidate: MessengerPolicyMessageRow,
  current: MessengerPolicyMessageRow | null,
) {
  const candidateMs =
    getRowTimestampMs(candidate);

  if (!Number.isFinite(candidateMs)) {
    return false;
  }

  if (!current) {
    return true;
  }

  const currentMs =
    getRowTimestampMs(current);

  return (
    !Number.isFinite(currentMs) ||
    candidateMs > currentMs
  );
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

const STANDARD_WINDOW_MS =
  24 * 60 * 60 * 1000;
const HUMAN_AGENT_WINDOW_MS =
  7 * 24 * 60 * 60 * 1000;

export type FacebookMessengerWindowState =
  | "standard"
  | "human_agent"
  | "expired"
  | "private_reply_available"
  | "waiting_for_customer_reply"
  | "unknown";

export type FacebookMessengerReplyPolicy = {
  hasRecentDirectCustomerMessage: boolean;
  withinHumanAgentWindow: boolean;
  latestDirectIncomingAt: string | null;
  latestIncomingCommentAt: string | null;
  latestDirectOutgoingAt: string | null;
  waitingForCustomerReply: boolean;
  windowState: FacebookMessengerWindowState;
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
    /*
     * Read a generous recent slice ordered by the platform timestamp first.
     * The policy still fails closed when no trustworthy event can be found,
     * so a very long conversation can never become sendable by accident.
     */
    .order("platform_created_at", {
      ascending: false,
      nullsFirst: false,
    })
    .order("created_at", {
      ascending: false,
    })
    .limit(500);

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
      row.direction === "incoming" &&
      isDirectFacebookMessengerInbound(
        row.raw_payload,
      ) &&
      isNewerPolicyRow(
        row,
        latestDirectIncoming,
      )
    ) {
      latestDirectIncoming = row;
    }

    if (
      row.direction === "incoming" &&
      isFacebookCommentPayload(
        row.raw_payload,
      ) &&
      isNewerPolicyRow(
        row,
        latestIncomingComment,
      )
    ) {
      latestIncomingComment = row;
    }

    if (
      isDirectFacebookMessengerOutgoing(
        row,
      ) &&
      isNewerPolicyRow(
        row,
        latestDirectOutgoing,
      )
    ) {
      latestDirectOutgoing = row;
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

  const nowMs = Date.now();
  const directCustomerMessageAgeMs =
    Number.isFinite(latestDirectIncomingAtMs)
      ? nowMs - latestDirectIncomingAtMs
      : Number.NaN;

  const hasRecentDirectCustomerMessage =
    Number.isFinite(
      directCustomerMessageAgeMs,
    ) &&
    directCustomerMessageAgeMs >= 0 &&
    directCustomerMessageAgeMs <
      STANDARD_WINDOW_MS;

  const withinHumanAgentWindow =
    Number.isFinite(
      directCustomerMessageAgeMs,
    ) &&
    directCustomerMessageAgeMs >=
      STANDARD_WINDOW_MS &&
    directCustomerMessageAgeMs <
      HUMAN_AGENT_WINDOW_MS;

  /*
   * A new Facebook comment creates a separate one-private-reply opportunity.
   * An older Messenger DM must not count as the customer's reply to that new
   * comment. We therefore compare exact timestamps inside this conversation.
   */
  const latestCommentIsNewerThanDirectIncoming =
    Number.isFinite(
      latestIncomingCommentAtMs,
    ) &&
    (!Number.isFinite(
      latestDirectIncomingAtMs,
    ) ||
      latestIncomingCommentAtMs >
        latestDirectIncomingAtMs);

  const pageAlreadySentAfterLatestComment =
    latestCommentIsNewerThanDirectIncoming &&
    Number.isFinite(
      latestDirectOutgoingAtMs,
    ) &&
    latestDirectOutgoingAtMs >=
      latestIncomingCommentAtMs;

  const waitingForCustomerReply =
    latestCommentIsNewerThanDirectIncoming &&
    pageAlreadySentAfterLatestComment;

  let windowState:
    FacebookMessengerWindowState =
      "unknown";

  if (waitingForCustomerReply) {
    windowState =
      "waiting_for_customer_reply";
  } else if (
    latestCommentIsNewerThanDirectIncoming
  ) {
    windowState =
      "private_reply_available";
  } else if (
    hasRecentDirectCustomerMessage
  ) {
    windowState = "standard";
  } else if (withinHumanAgentWindow) {
    windowState = "human_agent";
  } else if (
    Number.isFinite(
      directCustomerMessageAgeMs,
    ) &&
    directCustomerMessageAgeMs >=
      HUMAN_AGENT_WINDOW_MS
  ) {
    windowState = "expired";
  }

  return {
    hasRecentDirectCustomerMessage,
    withinHumanAgentWindow,
    latestDirectIncomingAt,
    latestIncomingCommentAt,
    latestDirectOutgoingAt,
    waitingForCustomerReply,
    windowState,
  };
}
