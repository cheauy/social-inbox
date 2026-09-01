"use client";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";

import { ConversationList } from "@/components/inbox/conversation-list";
import { CustomerProfile } from "@/components/inbox/customer-profile";
import { CustomerTimelineModal } from "@/components/inbox/customer-timeline-modal";
import type { InboxViewProps } from "@/components/inbox/inbox-view-types";
import { MessagePanel } from "@/components/inbox/message-panel";
import type {
  ReplyAttachment,
  ReplyAttachmentKind,
} from "@/components/inbox/reply-box";

import {
  useInboxRealtime,
} from "@/lib/inbox/use-inbox-realtime";

import {
  useBrowserNotifications,
} from "@/lib/inbox/use-browser-notifications";

import {
  useAgentPresence,
} from "@/lib/inbox/use-agent-presence";

import type {
  ConversationStatus,
  CustomerTag,
  InboxConversation,
  InboxMessage,
} from "@/types/inbox";





const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_CACHE_MAX_CONVERSATIONS = 25;
const PROFILE_CACHE_MAX_CONVERSATIONS = 50;

type OptimisticSendStatus =
  | "sending"
  | "sent"
  | "failed";

type OptimisticInboxMessage =
  InboxMessage & {
    __optimistic_status?:
      OptimisticSendStatus;
    __optimistic_created_at?:
      number;
  };

type PendingOptimisticSend = {
  tempId: string;
  conversationId: string;
  message: string;
  endpoint: string;
  requestBody:
    Record<string, unknown>;
  isCommentConversation:
    boolean;
  commentId:
    | string
    | null;
};

type PendingOptimisticAttachmentSend = {
  tempId: string;
  conversationId: string;
  recipientId: string;
  file: File;
  kind: ReplyAttachmentKind;
  previewUrl: string;
  messageText: string;
  endpoint: string;
};


type InboxConversationPlatform =
  | "facebook"
  | "telegram";

type PlatformAwareConversation =
  InboxConversation & {
    platform?: string | null;
    social_account:
      | (InboxConversation["social_account"] & {
          platform?: string | null;
        })
      | null;
  };

type BusinessAwareConversation =
  InboxConversation & {
    business_id?: string | null;
  };

function getConversationBusinessId(
  conversation: InboxConversation,
): string | null {
  const businessAware =
    conversation as BusinessAwareConversation;

  return (
    businessAware.business_id ??
    conversation.contact?.business_id ??
    null
  );
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.name === "AbortError"
  );
}

function getLoadedConversationPlatform(
  conversation: InboxConversation,
): InboxConversationPlatform | null {
  const platformAware =
    conversation as
      PlatformAwareConversation;

  const platform =
    platformAware.platform ??
    platformAware.social_account
      ?.platform ??
    null;

  if (platform === "telegram") {
    return "telegram";
  }

  if (platform === "facebook") {
    return "facebook";
  }

  return null;
}


/*
 * V2.9 — multi-agent action toast.
 *
 * conversation_activity already contains the actor, action type,
 * description and metadata. We convert those rows into compact,
 * human-readable team updates without adding another realtime channel.
 */
type MultiAgentToast = {
  id: string;
  activityType: string;
  message: string;
  actorName: string | null;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function capitalizeFirst(
  value: string,
) {
  if (!value) {
    return value;
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function buildMultiAgentToast(
  row: Record<string, unknown>,
): MultiAgentToast | null {
  const activityType =
    typeof row.activity_type === "string"
      ? row.activity_type
      : "";

  const actorName =
    typeof row.actor_name === "string" &&
    row.actor_name.trim()
      ? row.actor_name.trim()
      : "A teammate";

  const description =
    typeof row.description === "string"
      ? row.description.trim()
      : "";

  const title =
    typeof row.title === "string"
      ? row.title.trim()
      : "";

  const metadata = isRecord(row.metadata)
    ? row.metadata
    : {};

  let message = description;

  if (
    activityType === "status_changed" &&
    typeof metadata.newStatus === "string"
  ) {
    message = `${actorName} changed status to ${capitalizeFirst(
      metadata.newStatus,
    )}`;
  } else if (activityType === "assigned") {
    const newAssignee = isRecord(metadata.newAssignee)
      ? metadata.newAssignee
      : isRecord(metadata.assignedTo)
        ? metadata.assignedTo
        : null;
    const assigneeName =
      newAssignee &&
      typeof newAssignee.name === "string" &&
      newAssignee.name.trim()
        ? newAssignee.name.trim()
        : null;

    if (assigneeName) {
      message = `${actorName} assigned this conversation to ${assigneeName}`;
    }
  } else if (activityType === "unassigned") {
    message = `${actorName} unassigned this conversation`;
  } else if (activityType === "pinned") {
    message = `${actorName} pinned this conversation`;
  } else if (activityType === "unpinned") {
    message = `${actorName} unpinned this conversation`;
  } else if (
    activityType === "tag_added" ||
    activityType === "tag_removed"
  ) {
    const tag = isRecord(metadata.tag)
      ? metadata.tag
      : null;

    const tagName =
      tag &&
      typeof tag.name === "string" &&
      tag.name.trim()
        ? tag.name.trim()
        : null;

    if (tagName) {
      message =
        activityType === "tag_added"
          ? `${actorName} added ${tagName} tag`
          : `${actorName} removed ${tagName} tag`;
    }
  } else if (
    activityType === "customer_updated" ||
    activityType === "customer_profile_updated"
  ) {
    message =
      `${actorName} updated customer information`;
  } else if (
    activityType === "note_added" ||
    activityType === "internal_note_added"
  ) {
    message =
      `${actorName} added a customer note`;
  } else if (
    activityType === "note_updated" ||
    activityType === "internal_note_updated"
  ) {
    message =
      `${actorName} updated a customer note`;
  } else if (
    activityType === "note_deleted" ||
    activityType === "internal_note_deleted"
  ) {
    message =
      `${actorName} deleted a customer note`;
  }

  if (!message && title) {
    const normalizedTitle =
      title.toLowerCase().startsWith(
        actorName.toLowerCase(),
      )
        ? title
        : `${actorName} ${title}`;

    message = normalizedTitle;
  }

  if (!message) {
    return null;
  }

  return {
    id:
      typeof row.id === "string" &&
      row.id
        ? row.id
        : `${activityType}-${Date.now()}`,
    activityType,
    message,
    actorName,
  };
}

function sortLiveConversations(
  conversations: InboxConversation[],
) {
  return [...conversations].sort(
    (first, second) => {
      const firstPinned =
        Boolean(
          (first as {
            is_pinned?: boolean;
          }).is_pinned,
        );

      const secondPinned =
        Boolean(
          (second as {
            is_pinned?: boolean;
          }).is_pinned,
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

function getRealtimeMessagePreview(
  row: Record<string, unknown>,
) {
  const rawPayload = isRecord(row.raw_payload)
    ? row.raw_payload
    : null;

  if (rawPayload?.tenh_location) {
    return "Sent a location";
  }

  if (rawPayload?.tenh_animation) {
    return "Sent a GIF";
  }

  const messageType =
    typeof row.message_type === "string"
      ? row.message_type
      : "message";

  if (messageType === "sticker") {
    return "Sent a sticker";
  }

  if (
    typeof row.message_text === "string" &&
    row.message_text.trim()
  ) {
    return row.message_text.trim();
  }

  if (messageType === "image") {
    return "Sent a photo";
  }

  if (messageType === "video") {
    return "Sent a video";
  }

  if (messageType === "audio") {
    return "Sent a voice message";
  }

  if (
    messageType === "file" ||
    messageType === "document"
  ) {
    return "Sent a file";
  }

  return "New message";
}

export function InboxView({
  conversations,
  activeConversationId,
  messages,
  activeStatus,
  statusCounts,
  teamMembers,
  currentBusinessId,
  accessibleBusinessIds,
}: InboxViewProps) {

  const router = useRouter();
  const searchParams =
  useSearchParams();

  /*
   * The header-selected workspace scopes Group Chat / Analytics / Integrations
   * / Settings. Inbox is intentionally different: All Channels can contain
   * conversations from every active subscription, so opening a customer must
   * never mutate the global workspace selection. Conversation APIs authorize
   * against the conversation's own business_id on the server.
   */
  const [
    activeBusinessId,
    setActiveBusinessId,
  ] = useState(currentBusinessId);

  const activeBusinessIdRef =
    useRef(currentBusinessId);

  useEffect(() => {
    activeBusinessIdRef.current =
      currentBusinessId;
    setActiveBusinessId(
      currentBusinessId,
    );
  }, [currentBusinessId]);

const requestedConversationId =
  searchParams.get("conversation");

  /*
   * V3.11.16.8 — smooth conversation selection.
   * Keep the active thread in client state so selecting a row does not
   * require a Next.js route navigation / server rerender.
   */
  const [
    clientSelectedConversationId,
    setClientSelectedConversationId,
  ] = useState<string | null>(() =>
    requestedConversationId ??
    null,
  );

  const desiredConversationIdRef =
    useRef<string | null>(
      clientSelectedConversationId,
    );

  const [
    loadingConversationMessages,
    setLoadingConversationMessages,
  ] = useState(false);

  const [
    conversationMessagesError,
    setConversationMessagesError,
  ] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] =
    useState<string | null>(null);

  const [
    editingTelegramMessageId,
    setEditingTelegramMessageId,
  ] = useState<string | null>(
    null,
  );

  const [
    telegramActionNotice,
    setTelegramActionNotice,
  ] = useState<string | null>(
    null,
  );

  const telegramActionNoticeTimerRef =
    useRef<number | null>(
      null,
    );

  const [
  replyingToCommentId,
  setReplyingToCommentId,
] = useState<string | null>(
  null,
);

  const [
    replyingToTelegramMessageId,
    setReplyingToTelegramMessageId,
  ] = useState<string | null>(
    null,
  );

  const [
  customerPanelVisible,
  setCustomerPanelVisible,
] = useState(false);

const [markingUnread, setMarkingUnread] =
  useState(false);

const [historyOpen, setHistoryOpen] =
  useState(false);

const [pinning, setPinning] =
  useState(false);

const [pinError, setPinError] =
  useState<string | null>(null);

/*
 * Short-lived optimistic barriers. They prevent an older router.refresh
 * payload from undoing a pin/tag change while the database/realtime event is
 * catching up, but release automatically once authoritative data matches.
 */
const pinOverrideRef =
  useRef<
    Map<
      string,
      { isPinned: boolean; expiresAt: number }
    >
  >(new Map());

const contactTagsOverrideRef =
  useRef<
    Map<
      string,
      { tags: CustomerTag[]; expiresAt: number }
    >
  >(new Map());

const assignmentOverrideRef =
  useRef<
    Map<
      string,
      { assignedTo: string | null; expiresAt: number }
    >
  >(new Map());

const statusOverrideRef =
  useRef<
    Map<
      string,
      { status: ConversationStatus; expiresAt: number }
    >
  >(new Map());

const collaborationSyncInFlightRef =
  useRef(false);

/*
 * If the optional collaborative fallback route is missing in a local/stale
 * deployment, disable only the polling safety net for this page load. Supabase
 * Realtime stays active, so Inbox collaboration keeps working without flooding
 * the console with 404/HTML JSON parse errors every three seconds.
 */
const collaborationFallbackUnavailableRef =
  useRef(false);
const collaborationFallbackWarningShownRef =
  useRef(false);

/*
 * V3.11.18 — a manually-unread conversation stays unread while the agent
 * remains inside that same thread. Leaving the thread releases the hold, so
 * opening it again can acknowledge it normally.
 */
const manualUnreadConversationIdsRef =
  useRef<Set<string>>(new Set());

/*
 * V3.11.25 — remember a successful manual-unread count after leaving the
 * thread. This prevents a stale router/server payload from visually resetting
 * the badge to 0 before the agent intentionally reopens that conversation.
 */
const persistedManualUnreadCountsRef =
  useRef<Map<string, number>>(new Map());

/*
 * V3.11.30.1 — read barrier per conversation.
 *
 * A successful/optimistic read records the newest message timestamp that was
 * acknowledged. Later stale server props or out-of-order conversation realtime
 * rows are not allowed to resurrect an unread badge or roll the preview time
 * backwards. A genuinely newer incoming message clears the barrier.
 */
const readBarrierMessageTimeRef =
  useRef<Map<string, number>>(new Map());

const previousActiveConversationIdRef =
  useRef<string | null>(null);

  const [updatingStatus, setUpdatingStatus] =
    useState(false);
  const [statusError, setStatusError] =
    useState<string | null>(null);

  const [assigning, setAssigning] =
    useState(false);
  const [assignmentError, setAssignmentError] =
    useState<string | null>(null);

  /*
   * Realtime V2 local state.
   *
   * Server props remain the initial/enriched source of truth.
   * Realtime updates these arrays directly so incoming messages
   * do not require router.refresh().
   */
  const [
    liveConversations,
    setLiveConversations,
  ] = useState(conversations);

  const [
    liveMessages,
    setLiveMessages,
  ] = useState(messages);

  /*
   * Keep current live data available to long-running fallback timers without
   * restarting those timers on every message/conversation state update.
   */
  const liveMessagesRef = useRef(liveMessages);
  const liveConversationsRef = useRef(liveConversations);

  useEffect(() => {
    liveMessagesRef.current = liveMessages;
  }, [liveMessages]);

  useEffect(() => {
    liveConversationsRef.current = liveConversations;
  }, [liveConversations]);

  /*
   * Keep quick-tag changes visible immediately across the Inbox.
   * CustomerTagSelector dispatches this event after the API confirms an add/remove,
   * so the conversation list/profile/composer update without router.refresh().
   */
  useEffect(() => {
    function handleContactTagsChanged(event: Event) {
      const detail = (
        event as CustomEvent<{
          contactId?: string;
          tags?: CustomerTag[];
        }>
      ).detail;

      const contactId = detail?.contactId?.trim();
      const tags = Array.isArray(detail?.tags)
        ? detail.tags
        : null;

      if (!contactId || !tags) {
        return;
      }

      const normalizedTags = Array.from(
        new Map(
          tags.map((tag) => [tag.id, tag]),
        ).values(),
      );

      contactTagsOverrideRef.current.set(
        contactId,
        {
          tags: normalizedTags,
          expiresAt: Date.now() + 6_000,
        },
      );

      setLiveConversations((current) =>
        current.map((conversation) => {
          if (conversation.contact?.id !== contactId) {
            return conversation;
          }

          return {
            ...conversation,
            contact: {
              ...conversation.contact,
              tags: normalizedTags,
            },
          };
        }),
      );
    }

    window.addEventListener(
      "tenh-contact-tags-changed",
      handleContactTagsChanged,
    );

    return () => {
      window.removeEventListener(
        "tenh-contact-tags-changed",
        handleContactTagsChanged,
      );
    };
  }, []);

  type ConversationMessagePage = {
    messages: InboxMessage[];
    hasMore: boolean;
    fetchedAt: number;
    lastAccessedAt: number;
  };

  const conversationMessageCacheRef =
    useRef<
      Record<
        string,
        ConversationMessagePage
      >
    >({});

  const conversationMessageRequestRef =
    useRef<
      Record<
        string,
        Promise<ConversationMessagePage>
          | undefined
      >
    >({});

  const conversationMessageAbortRef =
    useRef<
      Record<
        string,
        AbortController | undefined
      >
    >({});

  const getCachedConversationPage =
    useCallback(
      (conversationId: string) => {
        const cached =
          conversationMessageCacheRef
            .current[conversationId];

        if (!cached) {
          return null;
        }

        cached.lastAccessedAt =
          Date.now();

        return cached;
      },
      [],
    );

  const setCachedConversationPage =
    useCallback(
      (
        conversationId: string,
        page: Omit<
          ConversationMessagePage,
          "lastAccessedAt"
        > & {
          lastAccessedAt?: number;
        },
      ) => {
        const now = Date.now();

        conversationMessageCacheRef
          .current[conversationId] = {
            ...page,
            lastAccessedAt:
              page.lastAccessedAt ??
              now,
          };

        const entries =
          Object.entries(
            conversationMessageCacheRef
              .current,
          );

        if (
          entries.length <=
          MESSAGE_CACHE_MAX_CONVERSATIONS
        ) {
          return;
        }

        entries
          .sort(
            (first, second) =>
              first[1].lastAccessedAt -
              second[1].lastAccessedAt,
          )
          .slice(
            0,
            entries.length -
              MESSAGE_CACHE_MAX_CONVERSATIONS,
          )
          .forEach(([id]) => {
            delete conversationMessageCacheRef
              .current[id];
          });
      },
      [],
    );

  const abortConversationRequestsExcept =
    useCallback(
      (conversationId: string | null) => {
        for (
          const [id, controller] of
          Object.entries(
            conversationMessageAbortRef
              .current,
          )
        ) {
          if (
            id !== conversationId &&
            controller
          ) {
            controller.abort();
            delete conversationMessageAbortRef
              .current[id];
            delete conversationMessageRequestRef
              .current[id];
          }
        }
      },
      [],
    );

  useEffect(() => {
    return () => {
      for (
        const controller of
        Object.values(
          conversationMessageAbortRef
            .current,
        )
      ) {
        controller?.abort();
      }

      conversationMessageAbortRef.current =
        {};
      conversationMessageRequestRef.current =
        {};
    };
  }, []);

  /*
   * V2.7 — older-message pagination.
   *
   * The server now sends only the newest page. Older pages are
   * prepended on demand as the agent scrolls upward.
   */
  const [
    hasMoreOlderMessages,
    setHasMoreOlderMessages,
  ] = useState(
    messages.length >=
      MESSAGE_PAGE_SIZE,
  );

  const [
    loadingOlderMessages,
    setLoadingOlderMessages,
  ] = useState(false);

  const [
    olderMessagesError,
    setOlderMessagesError,
  ] = useState<string | null>(
    null,
  );

  const loadOlderInFlightRef =
    useRef(false);

  /*
   * V2.5.2 — browser/desktop notifications.
   *
   * Permission is only requested from the bell button in
   * ConversationList, so browsers receive a real user gesture.
   */
  const {
    notifyIncomingMessage,
  } = useBrowserNotifications();

  const pendingSendsRef =
    useRef<
      Record<
        string,
        PendingOptimisticSend
      >
    >({});

  const pendingAttachmentSendsRef =
    useRef<
      Record<
        string,
        PendingOptimisticAttachmentSend
      >
    >({});


  const telegramTypingLastSentRef =
    useRef<
      Record<string, number>
    >({});


  /*
   * V3.11.5 — conversation platform cache.
   *
   * Newer Inbox payloads may already contain conversation.platform or
   * social_account.platform. Older enriched payloads do not, so TENH resolves
   * it once from a small authenticated route and caches the result per thread.
   * This avoids replacing the existing conversation loader just to add
   * Telegram text sending.
   */
  const conversationPlatformCacheRef =
    useRef<
      Record<
        string,
        InboxConversationPlatform
      >
    >({});

  /*
   * V2.5.1
   * Prevent a duplicated realtime INSERT from incrementing
   * the unread count more than once.
   */
  const handledIncomingMessageIdsRef =
    useRef<Set<string>>(
      new Set(),
    );

  /*
   * V3.11.32 — remember the latest incoming-message signal per thread.
   * Supabase can deliver the messages INSERT and conversations UPDATE in
   * either order, so this lets us distinguish a real new-message unread
   * update from a teammate manually choosing Mark as unread.
   */
  const recentIncomingConversationAtRef =
    useRef<Map<string, number>>(
      new Map(),
    );

  /*
   * Prevent multiple read PATCH requests for the same
   * active conversation while realtime events arrive.
   */
  const readInFlightRef =
    useRef<Set<string>>(
      new Set(),
    );

  /*
   * A local Mark as unread PATCH may briefly race with another realtime
   * read=0 event. Keep only that exact local write protected; once the write
   * completes, a teammate's later read/unread change is authoritative and
   * must update every browser live.
   */
  const unreadWriteInFlightRef =
    useRef<Set<string>>(
      new Set(),
    );

  /*
   * V2.8 — multi-agent enriched-data refresh.
   *
   * Messages and conversation rows are already applied directly from
   * Realtime. Customer profile/tag changes need the server-enriched
   * conversation payload, so we debounce one router.refresh() when a
   * matching conversation_activity row arrives.
   */
  const multiAgentRefreshTimerRef =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);


  /*
   * V2.9 — live team action toast.
   */
  const [
    multiAgentToast,
    setMultiAgentToast,
  ] = useState<MultiAgentToast | null>(
    null,
  );

  const multiAgentToastTimerRef =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);

  const seenActivityToastIdsRef =
    useRef<Set<string>>(
      new Set(),
    );

 const resolvedActiveConversationId =
  useMemo(() => {
    if (
      clientSelectedConversationId &&
      liveConversations.some(
        (conversation) =>
          conversation.id ===
          clientSelectedConversationId,
      )
    ) {
      return clientSelectedConversationId;
    }

    if (
      requestedConversationId &&
      liveConversations.some(
        (conversation) =>
          conversation.id ===
          requestedConversationId,
      )
    ) {
      return requestedConversationId;
    }

    /*
     * Do not auto-select the first conversation. The Inbox stays empty until
     * an agent explicitly clicks a row or the URL explicitly contains a
     * conversation id. This is important after channel/status/Smart View
     * actions in the left panel.
     */
    return null;
  }, [
    clientSelectedConversationId,
    liveConversations,
    requestedConversationId,
  ]);

const activeConversation =
  useMemo(
    () =>
      liveConversations.find(
        (conversation) =>
          conversation.id ===
          resolvedActiveConversationId,
      ) ?? null,
    [
      liveConversations,
      resolvedActiveConversationId,
    ],
  );

useEffect(() => {
  const previousId =
    previousActiveConversationIdRef.current;

  /*
   * Do not release a manual-unread hold when the selected id is temporarily
   * null during a client/server refresh. Release it only after TENH has
   * actually switched to another conversation. This prevents the unread badge
   * from appearing and then disappearing while the agent stays in the chat.
   */
  if (
    previousId &&
    resolvedActiveConversationId &&
    previousId !== resolvedActiveConversationId
  ) {
    manualUnreadConversationIdsRef.current.delete(
      previousId,
    );
  }

  if (resolvedActiveConversationId) {
    previousActiveConversationIdRef.current =
      resolvedActiveConversationId;
  }
}, [resolvedActiveConversationId]);

const customerProfileConversationCacheRef =
  useRef<
    Map<string, InboxConversation>
  >(new Map());

useEffect(() => {
  for (
    const conversation of
      liveConversations
  ) {
    if (!conversation.contact) {
      continue;
    }

    customerProfileConversationCacheRef
      .current.delete(
        conversation.id,
      );
    customerProfileConversationCacheRef
      .current.set(
        conversation.id,
        conversation,
      );
  }

  while (
    customerProfileConversationCacheRef
      .current.size >
    PROFILE_CACHE_MAX_CONVERSATIONS
  ) {
    const oldestId =
      customerProfileConversationCacheRef
        .current.keys()
        .next().value;

    if (!oldestId) {
      break;
    }

    customerProfileConversationCacheRef
      .current.delete(oldestId);
  }
}, [liveConversations]);

/*
 * V3.11.20 — profile-switch hardening.
 * The right panel follows the selected conversation immediately and can fall
 * back to the last enriched snapshot for that exact conversation while a
 * realtime/server refresh is replacing the conversation list. It never shows
 * another customer's profile as a loading placeholder.
 */
const customerProfileConversation =
  activeConversation ??
  (resolvedActiveConversationId
    ? customerProfileConversationCacheRef
        .current.get(
          resolvedActiveConversationId,
        ) ?? null
    : null);

useEffect(() => {
  setEditingTelegramMessageId(
    null,
  );
  setReplyingToTelegramMessageId(
    null,
  );
  setReply("");
  setSendError(null);
}, [resolvedActiveConversationId]);

const realtimeBusinessIds =
  useMemo(
    () =>
      Array.from(
        new Set(
          accessibleBusinessIds
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ),
    [accessibleBusinessIds],
  );


/*
 * V2.6 — agent presence + typing indicator.
 *
 * Presence is scoped to the current business. Each signed-in
 * teammate publishes which conversation they are viewing.
 * Typing uses the existing reply state and is debounced inside
 * the hook so we do not send a Presence update on every keypress.
 */
const {
  viewingAgents,
  typingAgents,
  teamPresence,
  status: agentPresenceStatus,
} = useAgentPresence({
  businessId:
    activeConversation
      ? getConversationBusinessId(
          activeConversation,
        ) ?? activeBusinessId
      : activeBusinessId,
  conversationId:
    resolvedActiveConversationId,
  teamMembers,
  typingText: reply,
});


/*
 * V3.11.15 — TENH agent typing -> Telegram customer.
 * Telegram Bot API does not provide customer typing updates back to bots.
 */
useEffect(() => {
  const conversation =
    activeConversation;

  if (
    !conversation ||
    conversation.source_type ===
      "comment" ||
    !reply.trim()
  ) {
    return;
  }

  let disposed = false;

  const timer =
    window.setTimeout(
      async () => {
        let platform:
          InboxConversationPlatform;

        try {
          platform =
            await resolveConversationPlatform(
              conversation,
            );
        } catch {
          return;
        }

        if (
          disposed ||
          platform !==
            "telegram"
        ) {
          return;
        }

        const now =
          Date.now();

        const lastSent =
          telegramTypingLastSentRef
            .current[
              conversation.id
            ] ?? 0;

        if (
          now - lastSent <
          3500
        ) {
          return;
        }

        telegramTypingLastSentRef
          .current[
            conversation.id
          ] = now;

        try {
          await fetch(
            "/api/telegram/typing",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body:
                JSON.stringify({
                  conversationId:
                    conversation.id,
                }),
            },
          );
        } catch {
          // Best effort only.
        }
      },
      450,
    );

  return () => {
    disposed = true;
    window.clearTimeout(
      timer,
    );
  };
}, [
  reply,
  activeConversation?.id,
]);

async function markConversationReadRealtime(
  conversationId: string,
) {
  if (
    manualUnreadConversationIdsRef.current.has(
      conversationId,
    ) ||
    readInFlightRef.current.has(
      conversationId,
    )
  ) {
    return;
  }

  const readConversation =
    liveConversations.find(
      (conversation) =>
        conversation.id ===
        conversationId,
    );

  const readMessageTime =
    readConversation?.last_message_at
      ? new Date(
          readConversation.last_message_at,
        ).getTime()
      : 0;

  if (
    Number.isFinite(readMessageTime) &&
    readMessageTime > 0
  ) {
    readBarrierMessageTimeRef.current.set(
      conversationId,
      Math.max(
        readBarrierMessageTimeRef.current.get(
          conversationId,
        ) ?? 0,
        readMessageTime,
      ),
    );
  }

  readInFlightRef.current.add(
    conversationId,
  );

  /*
   * Keep the active conversation visually at zero unread
   * while the server PATCH is completing.
   */
  setLiveConversations(
    (current) =>
      current.map(
        (conversation) =>
          conversation.id ===
          conversationId
            ? {
                ...conversation,
                unread_count: 0,
              }
            : conversation,
      ),
  );

  try {
    const response =
      await fetch(
        `/api/conversations/${conversationId}/read`,
        {
          method: "PATCH",
        },
      );

    const responseText =
      await response.text();

    const result =
      responseText.trim()
        ? (JSON.parse(
            responseText,
          ) as {
            success?: boolean;
            error?: string;
          })
        : {
            success:
              response.ok,
          };

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to mark conversation read.",
      );
    }
  } catch (error) {
    readBarrierMessageTimeRef.current.delete(
      conversationId,
    );

    console.error(
      "Unable to mark realtime conversation read:",
      error,
    );

    /*
     * Re-sync if the optimistic zero could not be saved.
     */
    router.refresh();
  } finally {
    readInFlightRef.current.delete(
      conversationId,
    );
  }
}

useEffect(() => {
  return () => {
    if (
      multiAgentRefreshTimerRef
        .current
    ) {
      clearTimeout(
        multiAgentRefreshTimerRef
          .current,
      );

      multiAgentRefreshTimerRef.current =
        null;
    }

    if (
      multiAgentToastTimerRef
        .current
    ) {
      clearTimeout(
        multiAgentToastTimerRef
          .current,
      );

      multiAgentToastTimerRef.current =
        null;
    }
  };
}, []);

function scheduleMultiAgentRefresh() {
  if (
    multiAgentRefreshTimerRef
      .current
  ) {
    clearTimeout(
      multiAgentRefreshTimerRef
        .current,
    );
  }

  multiAgentRefreshTimerRef.current =
    setTimeout(
      () => {
        multiAgentRefreshTimerRef.current =
          null;

        router.refresh();
      },
      120,
    );
}


function showMultiAgentToast(
  row: Record<string, unknown>,
) {
  const toast =
    buildMultiAgentToast(row);

  if (!toast) {
    return;
  }

  if (
    seenActivityToastIdsRef.current.has(
      toast.id,
    )
  ) {
    return;
  }

  seenActivityToastIdsRef.current.add(
    toast.id,
  );

  if (
    seenActivityToastIdsRef.current.size >
    500
  ) {
    seenActivityToastIdsRef.current.clear();
    seenActivityToastIdsRef.current.add(
      toast.id,
    );
  }

  setMultiAgentToast(toast);

  if (
    multiAgentToastTimerRef.current
  ) {
    clearTimeout(
      multiAgentToastTimerRef.current,
    );
  }

  multiAgentToastTimerRef.current =
    setTimeout(
      () => {
        setMultiAgentToast(null);
        multiAgentToastTimerRef.current =
          null;
      },
      4500,
    );
}

function normalizeCustomerTags(
  tags: CustomerTag[],
) {
  const unique = new Map<string, CustomerTag>();

  for (const tag of tags) {
    if (tag?.id) {
      unique.set(tag.id, tag);
    }
  }

  return Array.from(unique.values());
}

type CollaborativeInboxConversationState = {
  id: string;
  business_id: string;
  contact_id: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  pinned_by: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_member: InboxConversation["assigned_member"];
  status: ConversationStatus;
  status_updated_at: string | null;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
  updated_at: string | null;
  tags: CustomerTag[];
};

type CollaborativeInboxStateResponse = {
  success?: boolean;
  error?: string;
  conversations?: CollaborativeInboxConversationState[];
};

function updateContactTagsLive(
  contactId: string,
  tags: CustomerTag[],
  remember = true,
) {
  const normalizedTags = normalizeCustomerTags(tags);

  if (remember) {
    contactTagsOverrideRef.current.set(
      contactId,
      {
        tags: normalizedTags,
        expiresAt: Date.now() + 6_000,
      },
    );
  }

  setLiveConversations((current) =>
    current.map((conversation) => {
      if (conversation.contact?.id !== contactId) {
        return conversation;
      }

      return {
        ...conversation,
        contact: {
          ...conversation.contact,
          tags: normalizedTags,
        },
      };
    }),
  );
}

function applyRealtimeTagActivity(
  row: Record<string, unknown>,
) {
  const activityType =
    typeof row.activity_type === "string"
      ? row.activity_type
      : "";

  if (
    activityType !== "tag_added" &&
    activityType !== "tag_removed"
  ) {
    return;
  }

  const contactId =
    typeof row.contact_id === "string"
      ? row.contact_id
      : null;

  if (!contactId) {
    return;
  }

  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : null;
  const rawTag =
    metadata?.tag && typeof metadata.tag === "object"
      ? (metadata.tag as Record<string, unknown>)
      : null;
  const tagId =
    typeof rawTag?.id === "string"
      ? rawTag.id
      : null;

  if (!tagId) {
    return;
  }

  const override =
    contactTagsOverrideRef.current.get(contactId);
  const currentTags =
    override?.tags ??
    liveConversations.find(
      (conversation) => conversation.contact?.id === contactId,
    )?.contact?.tags ??
    [];

  if (activityType === "tag_removed") {
    updateContactTagsLive(
      contactId,
      currentTags.filter((tag) => tag.id !== tagId),
    );
    return;
  }

  const existingTag = currentTags.find(
    (tag) => tag.id === tagId,
  );
  const now = new Date().toISOString();
  const incomingTag: CustomerTag =
    existingTag ?? {
      id: tagId,
      business_id:
        typeof row.business_id === "string"
          ? row.business_id
          : activeBusinessId,
      name:
        typeof rawTag?.name === "string"
          ? rawTag.name
          : "Tag",
      color:
        typeof rawTag?.color === "string"
          ? rawTag.color
          : "#64748b",
      sort_index: 0,
      description: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

  updateContactTagsLive(
    contactId,
    [
      ...currentTags.filter((tag) => tag.id !== tagId),
      incomingTag,
    ],
  );
}

useInboxRealtime({
  businessIds:
    realtimeBusinessIds,

  onRealtimeEvent: (
    event,
  ) => {
    /*
     * V2.8 — customer/tag/note changes are stored in
     * conversation_activity by the existing APIs.
     *
     * These changes affect nested server-enriched data, so another
     * agent's browser refreshes the server props automatically.
     * V2.7 merges the refreshed newest-message page into local state,
     * therefore already-loaded older pages are preserved.
     */
    if (
      event.table ===
      "conversation_activity"
    ) {
      if (
        event.eventType !==
        "INSERT"
      ) {
        return;
      }

      const activityType =
        typeof event.newRow
          .activity_type ===
          "string"
          ? event.newRow
              .activity_type
          : "";

      const activityConversationId =
        typeof event.newRow
          .conversation_id ===
          "string"
          ? event.newRow
              .conversation_id
          : null;

      /*
       * V2.9 — show an action toast only when the activity belongs
       * to the conversation currently open in this browser.
       */
      if (
        activityConversationId &&
        activityConversationId ===
          resolvedActiveConversationId
      ) {
        showMultiAgentToast(
          event.newRow,
        );
      }

      if (
        activityType === "tag_added" ||
        activityType === "tag_removed"
      ) {
        applyRealtimeTagActivity(event.newRow);
      }

      const needsEnrichedRefresh =
        activityType ===
          "tag_added" ||
        activityType ===
          "tag_removed" ||
        activityType ===
          "customer_updated" ||
        activityType ===
          "note_added" ||
        activityType ===
          "note_updated" ||
        activityType ===
          "note_deleted";

      if (
        needsEnrichedRefresh
      ) {
        scheduleMultiAgentRefresh();
      }

      return;
    }

    if (
      event.table ===
      "messages"
    ) {
      const row =
        event.eventType ===
        "DELETE"
          ? event.oldRow
          : event.newRow;

      const messageId =
        typeof row.id ===
        "string"
          ? row.id
          : null;

      const conversationId =
        typeof row.conversation_id ===
        "string"
          ? row.conversation_id
          : null;

      if (
        !messageId ||
        !conversationId
      ) {
        return;
      }

      const messageDirection =
        typeof row.direction ===
        "string"
          ? row.direction
          : null;

      const isIncomingInsert =
        event.eventType ===
          "INSERT" &&
        messageDirection ===
          "incoming";

      /*
       * V2.5.1 — update the conversation list immediately
       * from the incoming message INSERT. The later
       * conversations UPDATE remains the authoritative
       * database value and will reconcile the count.
       */
      if (
        isIncomingInsert &&
        !handledIncomingMessageIdsRef.current.has(
          messageId,
        )
      ) {
        handledIncomingMessageIdsRef.current.add(
          messageId,
        );

        recentIncomingConversationAtRef.current.set(
          conversationId,
          Date.now(),
        );

        if (
          recentIncomingConversationAtRef.current.size >
          500
        ) {
          const cutoff = Date.now() - 30_000;
          for (const [id, receivedAt] of recentIncomingConversationAtRef.current) {
            if (receivedAt < cutoff) {
              recentIncomingConversationAtRef.current.delete(id);
            }
          }
        }

        if (
          handledIncomingMessageIdsRef.current.size >
          1000
        ) {
          handledIncomingMessageIdsRef.current.clear();
          handledIncomingMessageIdsRef.current.add(
            messageId,
          );
        }

        const isActiveIncoming =
          conversationId ===
          resolvedActiveConversationId;
        const keepActiveUnread =
          isActiveIncoming &&
          manualUnreadConversationIdsRef.current.has(
            conversationId,
          );

        const preview =
          getRealtimeMessagePreview(
            row,
          );

        /*
         * V2.5.2 — show a native browser notification only
         * when Tenh Chat is hidden/unfocused. The hook also
         * guarantees this only runs after the agent explicitly
         * enables notifications.
         */
        const notificationConversation =
          liveConversations.find(
            (conversation) =>
              conversation.id ===
              conversationId,
          );

        notifyIncomingMessage({
          messageId,
          conversationId,
          customerName:
            notificationConversation
              ?.contact
              ?.full_name
              ?.trim() ||
            "Facebook customer",
          body: preview,
        });

        const lastMessageAt =
          typeof row.platform_created_at ===
          "string"
            ? row.platform_created_at
            : typeof row.created_at ===
                "string"
              ? row.created_at
              : new Date().toISOString();

        const incomingMessageTime =
          new Date(lastMessageAt).getTime();
        const existingReadBarrier =
          readBarrierMessageTimeRef.current.get(
            conversationId,
          ) ?? 0;

        if (
          existingReadBarrier > 0 &&
          Number.isFinite(incomingMessageTime) &&
          incomingMessageTime >
            existingReadBarrier + 1000
        ) {
          readBarrierMessageTimeRef.current.delete(
            conversationId,
          );
        }

        setLiveConversations(
          (current) =>
            sortLiveConversations(
              current.map(
                (conversation) => {
                  if (
                    conversation.id !==
                    conversationId
                  ) {
                    return conversation;
                  }

                  return {
                    ...conversation,
                    last_message_text:
                      preview,
                    last_message_at:
                      lastMessageAt,
                    unread_count:
                      isActiveIncoming &&
                      !keepActiveUnread
                        ? 0
                        : Math.max(
                            keepActiveUnread ? 1 : 0,
                            (conversation.unread_count ??
                              0) + 1,
                          ),
                  };
                },
              ),
            ),
        );
      }

      /*
       * V3.11.18 — keep the left list preview/time correct for both platforms.
       * INSERT updates outgoing previews too; UPDATE covers Telegram edits;
       * DELETE shows a deterministic deleted preview. Older realtime events
       * are not allowed to overwrite a newer message preview.
       */
      {
        const eventTimestampValue =
          typeof row.platform_created_at === "string"
            ? row.platform_created_at
            : typeof row.created_at === "string"
              ? row.created_at
              : null;
        const eventTimestamp = eventTimestampValue
          ? new Date(eventTimestampValue).getTime()
          : Date.now();
        const eventPreview =
          event.eventType === "DELETE"
            ? "Message deleted"
            : getRealtimeMessagePreview(row);

        setLiveConversations((current) =>
          sortLiveConversations(
            current.map((conversation) => {
              if (conversation.id !== conversationId) {
                return conversation;
              }

              const currentTimestamp =
                conversation.last_message_at
                  ? new Date(conversation.last_message_at).getTime()
                  : 0;

              if (
                Number.isFinite(currentTimestamp) &&
                currentTimestamp > 0 &&
                eventTimestamp + 1000 < currentTimestamp
              ) {
                return conversation;
              }

              return {
                ...conversation,
                last_message_text: eventPreview,
                last_message_at:
                  eventTimestampValue ??
                  conversation.last_message_at ??
                  new Date().toISOString(),
              };
            }),
          ),
        );
      }

      /*
       * V3.11.17 — keep an already-cached inactive thread fresh.
       * Realtime messages should not force us to throw away a warm cache.
       * Merge INSERT/UPDATE/DELETE directly into that cached page, then the
       * next conversation switch can render immediately with current data.
       */
      if (
        conversationId !==
        resolvedActiveConversationId
      ) {
        const cached =
          getCachedConversationPage(
            conversationId,
          );

        if (cached) {
          let nextMessages =
            cached.messages;

          if (
            event.eventType ===
            "DELETE"
          ) {
            nextMessages =
              cached.messages.filter(
                (message) =>
                  message.id !==
                  messageId,
              );
          } else {
            const incoming =
              row as unknown as InboxMessage;

            const existingIndex =
              cached.messages.findIndex(
                (message) =>
                  message.id ===
                  messageId,
              );

            if (existingIndex >= 0) {
              nextMessages =
                cached.messages.map(
                  (message) =>
                    message.id ===
                    messageId
                      ? ({
                          ...message,
                          ...incoming,
                          attachment_url:
                            incoming.attachment_url ??
                            message.attachment_url,
                        } as InboxMessage)
                      : message,
                );
            } else {
              nextMessages = [
                ...cached.messages,
                incoming,
              ];
            }

            nextMessages =
              [...nextMessages].sort(
                (first, second) => {
                  const timeDifference =
                    new Date(
                      first.created_at,
                    ).getTime() -
                    new Date(
                      second.created_at,
                    ).getTime();

                  return timeDifference !== 0
                    ? timeDifference
                    : first.id.localeCompare(
                        second.id,
                      );
                },
              );
          }

          setCachedConversationPage(
            conversationId,
            {
              messages:
                nextMessages,
              hasMore:
                cached.hasMore,
              fetchedAt:
                Date.now(),
            },
          );
        }

        return;
      }

      if (
        event.eventType ===
        "DELETE"
      ) {
        setLiveMessages(
          (current) =>
            current.filter(
              (message) =>
                message.id !==
                messageId,
            ),
        );

        return;
      }

      setLiveMessages(
        (current) => {
          const existingIndex =
            current.findIndex(
              (message) =>
                message.id ===
                messageId,
            );

          if (
            existingIndex === -1
          ) {
            const realDirection =
              typeof row.direction ===
              "string"
                ? row.direction
                : null;

            const realMessageText =
              typeof row.message_text ===
              "string"
                ? row.message_text
                : null;

            const realCreatedAt =
              typeof row.created_at ===
              "string"
                ? new Date(
                    row.created_at,
                  ).getTime()
                : Date.now();

            const optimisticIndex =
              realDirection ===
                "outgoing" &&
              realMessageText
                ? current.findIndex(
                    (message) => {
                      const optimistic =
                        message as OptimisticInboxMessage;

                      if (
                        !optimistic.__optimistic_status ||
                        message.conversation_id !==
                          conversationId ||
                        message.message_text !==
                          realMessageText
                      ) {
                        return false;
                      }

                      const optimisticTime =
                        optimistic.__optimistic_created_at ??
                        new Date(
                          message.created_at,
                        ).getTime();

                      return (
                        Math.abs(
                          realCreatedAt -
                            optimisticTime,
                        ) <
                        120_000
                      );
                    },
                  )
                : -1;

            if (
              optimisticIndex >= 0
            ) {
              const optimisticMessage =
                current[
                  optimisticIndex
                ];

              const optimisticId =
                optimisticMessage.id;

              delete pendingSendsRef
                .current[
                  optimisticId
                ];

              delete pendingAttachmentSendsRef
                .current[
                  optimisticId
                ];

              const localAttachmentUrl =
                optimisticMessage.attachment_url
                  ?.startsWith("blob:")
                  ? optimisticMessage.attachment_url
                  : null;

              const replacement = {
                ...row,
                attachment_url:
                  row.attachment_url ??
                  localAttachmentUrl,
              } as unknown as typeof current[number];

              return [
                ...current.filter(
                  (
                    _message,
                    index,
                  ) =>
                    index !==
                    optimisticIndex,
                ),
                replacement,
              ].sort(
                (
                  first,
                  second,
                ) =>
                  new Date(
                    first.created_at,
                  ).getTime() -
                  new Date(
                    second.created_at,
                  ).getTime(),
              );
            }

            return [
              ...current,
              row as unknown as typeof current[number],
            ].sort(
              (first, second) =>
                new Date(
                  first.created_at,
                ).getTime() -
                new Date(
                  second.created_at,
                ).getTime(),
            );
          }

          return current.map(
            (message) => {
              if (
                message.id !==
                messageId
              ) {
                return message;
              }

              const localAttachmentUrl =
                message.attachment_url
                  ?.startsWith("blob:")
                  ? message.attachment_url
                  : null;

              return {
                ...message,
                ...row,
                attachment_url:
                  row.attachment_url ??
                  localAttachmentUrl,
              } as unknown as typeof message;
            },
          );
        },
      );

      return;
    }

    if (
      event.table ===
      "conversations"
    ) {
      const row =
        event.eventType ===
        "DELETE"
          ? event.oldRow
          : event.newRow;

      const conversationId =
        typeof row.id ===
        "string"
          ? row.id
          : null;

      if (!conversationId) {
        return;
      }

      if (
        event.eventType ===
        "DELETE"
      ) {
        setLiveConversations(
          (current) =>
            current.filter(
              (conversation) =>
                conversation.id !==
                conversationId,
            ),
        );

        return;
      }

      const realtimeMergeRow = {
        ...row,
      } as Record<string, unknown>;

      const pinOverride =
        pinOverrideRef.current.get(conversationId);
      const rowPinned =
        typeof row.is_pinned === "boolean"
          ? row.is_pinned
          : null;

      if (rowPinned !== null && pinOverride) {
        if (
          pinOverride.expiresAt > Date.now() &&
          rowPinned !== pinOverride.isPinned
        ) {
          delete realtimeMergeRow.is_pinned;
          delete realtimeMergeRow.pinned_at;
          delete realtimeMergeRow.pinned_by;
        } else {
          pinOverrideRef.current.delete(conversationId);
        }
      }

      const assignmentOverride =
        assignmentOverrideRef.current.get(conversationId);
      const rowHasAssignment =
        Object.prototype.hasOwnProperty.call(row, "assigned_to");
      const rowAssignedTo =
        typeof row.assigned_to === "string"
          ? row.assigned_to
          : null;
      let protectAssignedMember = false;

      if (rowHasAssignment && assignmentOverride) {
        if (
          assignmentOverride.expiresAt > Date.now() &&
          rowAssignedTo !== assignmentOverride.assignedTo
        ) {
          delete realtimeMergeRow.assigned_to;
          delete realtimeMergeRow.assigned_at;
          protectAssignedMember = true;
        } else {
          assignmentOverrideRef.current.delete(conversationId);
        }
      }

      const statusOverride =
        statusOverrideRef.current.get(conversationId);
      const rowStatus =
        typeof row.status === "string"
          ? (row.status as ConversationStatus)
          : null;

      if (rowStatus && statusOverride) {
        if (
          statusOverride.expiresAt > Date.now() &&
          rowStatus !== statusOverride.status
        ) {
          delete realtimeMergeRow.status;
          delete realtimeMergeRow.status_updated_at;
        } else {
          statusOverrideRef.current.delete(conversationId);
        }
      }

      if (
        rowPinned !== null &&
        activeConversation?.id === conversationId &&
        Boolean(activeConversation.is_pinned) !== rowPinned &&
        !(pinOverride && pinOverride.isPinned === rowPinned)
      ) {
        const actorMemberId =
          typeof row.pinned_by === "string"
            ? row.pinned_by
            : null;
        const actorName =
          (actorMemberId
            ? teamMembers.find((member) => member.id === actorMemberId)
                ?.full_name
            : null) ?? "A teammate";
        const changedAt =
          typeof row.updated_at === "string"
            ? row.updated_at
            : Date.now().toString();

        showMultiAgentToast({
          id: `pin-live-${conversationId}-${changedAt}`,
          activity_type: rowPinned ? "pin_live" : "unpin_live",
          actor_name: actorName,
          description: rowPinned
            ? `${actorName} pinned this conversation`
            : `${actorName} unpinned this conversation`,
        });
      }

      const existingConversation =
        liveConversations.find(
          (conversation) =>
            conversation.id === conversationId,
        ) ?? null;

      const rowUnreadCount =
        typeof row.unread_count === "number"
          ? row.unread_count
          : null;
      const existingLastMessageTime =
        existingConversation?.last_message_at
          ? new Date(existingConversation.last_message_at).getTime()
          : 0;
      const rowLastMessageValue =
        typeof row.last_message_at === "string"
          ? row.last_message_at
          : null;
      const rowLastMessageTime = rowLastMessageValue
        ? new Date(rowLastMessageValue).getTime()
        : 0;
      const recentIncomingAt =
        recentIncomingConversationAtRef.current.get(conversationId) ?? 0;
      const hasRecentIncomingSignal =
        recentIncomingAt > 0 &&
        Date.now() - recentIncomingAt < 5_000;
      const rowAdvancesMessage =
        Number.isFinite(rowLastMessageTime) &&
        Number.isFinite(existingLastMessageTime) &&
        rowLastMessageTime > 0 &&
        (existingLastMessageTime === 0 ||
          rowLastMessageTime > existingLastMessageTime + 1_000);
      const unreadComesFromNewMessage =
        rowUnreadCount !== null &&
        rowUnreadCount > 0 &&
        (hasRecentIncomingSignal || rowAdvancesMessage);
      const isSharedManualUnreadUpdate =
        rowUnreadCount !== null &&
        rowUnreadCount > 0 &&
        !unreadComesFromNewMessage;

      if (unreadComesFromNewMessage && hasRecentIncomingSignal) {
        recentIncomingConversationAtRef.current.delete(conversationId);
      }

      /*
       * V3.11.32 — unread is shared team state. A teammate's manual Mark as
       * unread changes only unread_count, not the latest message. Keep that
       * unread marker even when this browser already has the thread open.
       */
      if (isSharedManualUnreadUpdate) {
        manualUnreadConversationIdsRef.current.add(conversationId);
        persistedManualUnreadCountsRef.current.set(
          conversationId,
          Math.max(1, rowUnreadCount ?? 1),
        );
        readBarrierMessageTimeRef.current.delete(conversationId);
      }

      /*
       * A read=0 written by another teammate must also win immediately. The
       * only exception is while this browser is in the middle of its own
       * Mark as unread PATCH, where the later local write is intentional.
       */
      if (
        rowUnreadCount === 0 &&
        !unreadWriteInFlightRef.current.has(conversationId)
      ) {
        manualUnreadConversationIdsRef.current.delete(conversationId);
        persistedManualUnreadCountsRef.current.delete(conversationId);
      }

      setLiveConversations(
        (current) => {
          const exists =
            current.some(
              (conversation) =>
                conversation.id ===
                conversationId,
            );

          /*
           * INSERT is enriched by the fallback router refresh.
           * Do not add the raw row because it has no contact join.
           */
          if (!exists) {
            return current;
          }

          const isActiveConversation =
            conversationId ===
            resolvedActiveConversationId;

          /*
           * Only a real incoming-message unread should be auto-acknowledged
           * while the thread is open. A teammate's manual Mark as unread must
           * stay visible live to everyone.
           */
          const shouldAcknowledgeRead =
            isActiveConversation &&
            unreadComesFromNewMessage &&
            !manualUnreadConversationIdsRef.current.has(
              conversationId,
            );

          const normalizedRow =
            shouldAcknowledgeRead
              ? {
                  ...realtimeMergeRow,
                  unread_count: 0,
                }
              : realtimeMergeRow;

          const persistedManualUnreadCount =
            persistedManualUnreadCountsRef.current.get(
              conversationId,
            ) ?? 0;

          const keepManuallyUnread =
            manualUnreadConversationIdsRef.current.has(
              conversationId,
            ) ||
            persistedManualUnreadCount > 0;

          const next =
            current.map(
              (conversation) => {
                if (
                  conversation.id !==
                  conversationId
                ) {
                  return conversation;
                }

                const currentLastMessageTime =
                  conversation.last_message_at
                    ? new Date(
                        conversation.last_message_at,
                      ).getTime()
                    : 0;
                const rowLastMessageValue =
                  typeof row.last_message_at ===
                  "string"
                    ? row.last_message_at
                    : null;
                const rowLastMessageTime =
                  rowLastMessageValue
                    ? new Date(
                        rowLastMessageValue,
                      ).getTime()
                    : 0;
                const rowIsOlderThanLocal =
                  Number.isFinite(
                    currentLastMessageTime,
                  ) &&
                  Number.isFinite(
                    rowLastMessageTime,
                  ) &&
                  currentLastMessageTime > 0 &&
                  rowLastMessageTime > 0 &&
                  rowLastMessageTime + 1000 <
                    currentLastMessageTime;

                let merged = {
                  ...conversation,
                  ...normalizedRow,
                  ...(rowIsOlderThanLocal
                    ? {
                        last_message_at:
                          conversation.last_message_at,
                        last_message_text:
                          conversation.last_message_text,
                        unread_count:
                          conversation.unread_count,
                      }
                    : {}),
                } as unknown as typeof conversation;

                if (rowHasAssignment && !protectAssignedMember) {
                  merged = {
                    ...merged,
                    assigned_member: rowAssignedTo
                      ? teamMembers.find(
                          (member) => member.id === rowAssignedTo,
                        ) ?? null
                      : null,
                  };
                }

                if (keepManuallyUnread) {
                  return {
                    ...merged,
                    unread_count: Math.max(
                      1,
                      persistedManualUnreadCount,
                      typeof merged.unread_count === "number"
                        ? merged.unread_count
                        : conversation.unread_count ?? 0,
                    ),
                  };
                }

                const readBarrier =
                  readBarrierMessageTimeRef.current.get(
                    conversationId,
                  ) ?? 0;
                const mergedMessageTime =
                  merged.last_message_at
                    ? new Date(
                        merged.last_message_at,
                      ).getTime()
                    : 0;

                if (
                  readBarrier > 0 &&
                  Number.isFinite(mergedMessageTime)
                ) {
                  if (
                    mergedMessageTime <=
                    readBarrier + 1000
                  ) {
                    return {
                      ...merged,
                      unread_count: 0,
                    };
                  }

                  readBarrierMessageTimeRef.current.delete(
                    conversationId,
                  );
                }

                return merged;
              },
            );

          return sortLiveConversations(
            next,
          );
        },
      );

      if (
        conversationId ===
          resolvedActiveConversationId &&
        unreadComesFromNewMessage &&
        !manualUnreadConversationIdsRef.current.has(
          conversationId,
        )
      ) {
        void markConversationReadRealtime(
          conversationId,
        );
      }
    }
  },

  /*
   * Only brand-new conversations need joined server data.
   * Normal messages/updates stay completely local.
   */
  onFallbackRefresh: () => {
    router.refresh();
  },
});

/*
 * Realtime is the fast path. This lightweight server-authoritative sync is the
 * safety net for deployments where a Supabase Realtime publication/policy is
 * delayed or unavailable. It keeps pin, assignment and customer tags aligned
 * for Owners and teammates without refreshing the page or replacing messages.
 */
const collaborationConversationIdsKey = useMemo(
  () =>
    liveConversations
      .map((conversation) => conversation.id)
      .sort()
      .join("|"),
  [liveConversations],
);

useEffect(() => {
  const conversationIds =
    collaborationConversationIdsKey
      ? collaborationConversationIdsKey.split("|")
      : [];

  if (conversationIds.length === 0) {
    return;
  }

  let cancelled = false;
  let timer: number | null = null;

  async function syncCollaborativeState() {
    if (
      cancelled ||
      collaborationFallbackUnavailableRef.current ||
      collaborationSyncInFlightRef.current ||
      document.visibilityState === "hidden" ||
      !navigator.onLine
    ) {
      return;
    }

    collaborationSyncInFlightRef.current = true;

    try {
      const response = await fetch(
        "/api/inbox/live-state",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            conversationIds,
          }),
        },
      );

      const text = await response.text();
      const contentType =
        response.headers.get("content-type") ?? "";

      if (response.status === 404) {
        collaborationFallbackUnavailableRef.current = true;

        if (!collaborationFallbackWarningShownRef.current) {
          collaborationFallbackWarningShownRef.current = true;
          console.warn(
            "Collaborative Inbox fallback route is unavailable. Realtime remains active; restart Next.js after adding app/api/inbox/live-state/route.ts.",
          );
        }

        return;
      }

      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(
          `Collaborative Inbox fallback returned ${response.status} ${response.statusText || ""} with a non-JSON response.`,
        );
      }

      let result: CollaborativeInboxStateResponse | null = null;

      if (text.trim()) {
        try {
          result = JSON.parse(text) as CollaborativeInboxStateResponse;
        } catch {
          throw new Error(
            "Collaborative Inbox fallback returned invalid JSON.",
          );
        }
      }

      if (
        !response.ok ||
        !result?.success ||
        !Array.isArray(result.conversations)
      ) {
        throw new Error(
          result?.error ??
            "Unable to synchronize Inbox state.",
        );
      }

      if (cancelled) {
        return;
      }

      const stateByConversationId = new Map(
        result.conversations.map((state) => [state.id, state]),
      );

      setLiveConversations((current) =>
        sortLiveConversations(
          current.map((conversation) => {
            const state = stateByConversationId.get(conversation.id);

            if (!state) {
              return conversation;
            }

            let nextConversation: InboxConversation = {
              ...conversation,
            };

            /*
             * Realtime is the fast path, but this server-authoritative fallback
             * must also advance the conversation preview/time when a message
             * INSERT event is missed. Without this, the left list appears stale
             * until a manual browser refresh. Never roll a newer local preview
             * backwards.
             */
            const localPreviewTime = conversation.last_message_at
              ? new Date(conversation.last_message_at).getTime()
              : 0;
            const serverPreviewTime = state.last_message_at
              ? new Date(state.last_message_at).getTime()
              : 0;

            if (
              Number.isFinite(serverPreviewTime) &&
              serverPreviewTime > 0 &&
              (!Number.isFinite(localPreviewTime) ||
                localPreviewTime === 0 ||
                serverPreviewTime >= localPreviewTime)
            ) {
              nextConversation = {
                ...nextConversation,
                last_message_text:
                  state.last_message_text ??
                  nextConversation.last_message_text,
                last_message_at: state.last_message_at,
              };
            }

            /*
             * V3.11.32 fallback for shared read/unread state. Realtime remains
             * the fast path, while this 3-second authoritative sync guarantees
             * that every teammate still converges if a realtime UPDATE is lost.
             */
            const serverUnreadCount = Math.max(
              0,
              typeof state.unread_count === "number"
                ? state.unread_count
                : conversation.unread_count ?? 0,
            );
            const localLastMessageTime = conversation.last_message_at
              ? new Date(conversation.last_message_at).getTime()
              : 0;
            const serverLastMessageTime = state.last_message_at
              ? new Date(state.last_message_at).getTime()
              : 0;
            const recentIncomingAt =
              recentIncomingConversationAtRef.current.get(conversation.id) ?? 0;
            const fallbackHasRecentIncoming =
              recentIncomingAt > 0 &&
              Date.now() - recentIncomingAt < 5_000;
            const fallbackMessageAdvanced =
              Number.isFinite(serverLastMessageTime) &&
              Number.isFinite(localLastMessageTime) &&
              serverLastMessageTime > 0 &&
              (localLastMessageTime === 0 ||
                serverLastMessageTime > localLastMessageTime + 1_000);
            const fallbackUnreadFromMessage =
              serverUnreadCount > 0 &&
              (fallbackHasRecentIncoming || fallbackMessageAdvanced);
            const fallbackManualUnread =
              serverUnreadCount > 0 &&
              !fallbackUnreadFromMessage;

            if (fallbackManualUnread) {
              manualUnreadConversationIdsRef.current.add(conversation.id);
              persistedManualUnreadCountsRef.current.set(
                conversation.id,
                Math.max(1, serverUnreadCount),
              );
              readBarrierMessageTimeRef.current.delete(conversation.id);
              nextConversation = {
                ...nextConversation,
                unread_count: Math.max(1, serverUnreadCount),
              };
            } else if (serverUnreadCount === 0) {
              if (!unreadWriteInFlightRef.current.has(conversation.id)) {
                manualUnreadConversationIdsRef.current.delete(conversation.id);
                persistedManualUnreadCountsRef.current.delete(conversation.id);
                nextConversation = {
                  ...nextConversation,
                  unread_count: 0,
                };
              }
            } else {
              nextConversation = {
                ...nextConversation,
                unread_count: serverUnreadCount,
              };
            }

            const pinOverride =
              pinOverrideRef.current.get(conversation.id);

            if (
              pinOverride &&
              pinOverride.expiresAt > Date.now() &&
              state.is_pinned !== pinOverride.isPinned
            ) {
              nextConversation = {
                ...nextConversation,
                is_pinned: pinOverride.isPinned,
                pinned_at: pinOverride.isPinned
                  ? nextConversation.pinned_at ?? new Date().toISOString()
                  : null,
                pinned_by: pinOverride.isPinned
                  ? nextConversation.pinned_by
                  : null,
              };
            } else {
              pinOverrideRef.current.delete(conversation.id);
              nextConversation = {
                ...nextConversation,
                is_pinned: state.is_pinned,
                pinned_at: state.pinned_at,
                pinned_by: state.pinned_by,
              };
            }

            const assignmentOverride =
              assignmentOverrideRef.current.get(conversation.id);

            if (
              assignmentOverride &&
              assignmentOverride.expiresAt > Date.now() &&
              state.assigned_to !== assignmentOverride.assignedTo
            ) {
              // Keep the in-flight local assignment until its API request settles.
            } else {
              assignmentOverrideRef.current.delete(conversation.id);
              nextConversation = {
                ...nextConversation,
                assigned_to: state.assigned_to,
                assigned_at: state.assigned_at,
                assigned_member: state.assigned_member,
              };
            }

            const statusOverride =
              statusOverrideRef.current.get(conversation.id);

            if (
              statusOverride &&
              statusOverride.expiresAt > Date.now() &&
              state.status !== statusOverride.status
            ) {
              // Keep the in-flight local status until its API request settles.
            } else {
              statusOverrideRef.current.delete(conversation.id);
              nextConversation = {
                ...nextConversation,
                status: state.status,
              };
            }

            if (
              state.contact_id &&
              nextConversation.contact?.id === state.contact_id
            ) {
              const tagOverride =
                contactTagsOverrideRef.current.get(state.contact_id);

              if (
                tagOverride &&
                tagOverride.expiresAt > Date.now()
              ) {
                const serverTagIds = new Set(
                  state.tags.map((tag) => tag.id),
                );
                const overrideTagIds = new Set(
                  tagOverride.tags.map((tag) => tag.id),
                );
                const serverMatchesOverride =
                  serverTagIds.size === overrideTagIds.size &&
                  Array.from(overrideTagIds).every((tagId) =>
                    serverTagIds.has(tagId),
                  );

                if (serverMatchesOverride) {
                  contactTagsOverrideRef.current.delete(state.contact_id);
                  nextConversation = {
                    ...nextConversation,
                    contact: {
                      ...nextConversation.contact,
                      tags: normalizeCustomerTags(state.tags),
                    },
                  };
                } else {
                  nextConversation = {
                    ...nextConversation,
                    contact: {
                      ...nextConversation.contact,
                      tags: tagOverride.tags,
                    },
                  };
                }
              } else {
                contactTagsOverrideRef.current.delete(state.contact_id);
                nextConversation = {
                  ...nextConversation,
                  contact: {
                    ...nextConversation.contact,
                    tags: normalizeCustomerTags(state.tags),
                  },
                };
              }
            }

            return nextConversation;
          }),
        ),
      );
    } catch (error) {
      // Realtime remains active; a temporary sync failure must never break Inbox.
      console.warn(
        "Unable to run collaborative Inbox fallback sync:",
        error,
      );
    } finally {
      collaborationSyncInFlightRef.current = false;
    }
  }

  function scheduleNext() {
    if (
      cancelled ||
      collaborationFallbackUnavailableRef.current
    ) {
      return;
    }

    timer = window.setTimeout(async () => {
      await syncCollaborativeState();
      scheduleNext();
    }, 3000);
  }

  function handleVisibilityOrFocus() {
    if (document.visibilityState === "visible") {
      void syncCollaborativeState();
    }
  }

  void syncCollaborativeState();
  scheduleNext();

  window.addEventListener("focus", handleVisibilityOrFocus);
  window.addEventListener("online", handleVisibilityOrFocus);
  document.addEventListener("visibilitychange", handleVisibilityOrFocus);

  return () => {
    cancelled = true;

    if (timer !== null) {
      window.clearTimeout(timer);
    }

    window.removeEventListener("focus", handleVisibilityOrFocus);
    window.removeEventListener("online", handleVisibilityOrFocus);
    document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
  };
}, [
  collaborationConversationIdsKey,
]);

useEffect(() => {
  setLiveConversations((current) => {
    const currentById = new Map(
      current.map((conversation) => [conversation.id, conversation]),
    );

    const next = conversations.map((conversation) => {
      const previous =
        currentById.get(
          conversation.id,
        );
      const persistedManualUnreadCount =
        persistedManualUnreadCountsRef.current.get(
          conversation.id,
        ) ?? 0;

      const serverLastMessageTime =
        conversation.last_message_at
          ? new Date(
              conversation.last_message_at,
            ).getTime()
          : 0;
      const localLastMessageTime =
        previous?.last_message_at
          ? new Date(
              previous.last_message_at,
            ).getTime()
          : 0;
      const serverIsOlderThanLocal =
        Boolean(previous) &&
        Number.isFinite(
          serverLastMessageTime,
        ) &&
        Number.isFinite(
          localLastMessageTime,
        ) &&
        serverLastMessageTime > 0 &&
        localLastMessageTime > 0 &&
        serverLastMessageTime + 1000 <
          localLastMessageTime;

      let mergedConversation =
        serverIsOlderThanLocal && previous
          ? {
              ...conversation,
              last_message_at:
                previous.last_message_at,
              last_message_text:
                previous.last_message_text,
              unread_count:
                previous.unread_count,
            }
          : conversation;

      const pinOverride =
        pinOverrideRef.current.get(conversation.id);

      if (pinOverride) {
        if (pinOverride.expiresAt <= Date.now()) {
          pinOverrideRef.current.delete(conversation.id);
        } else if (conversation.is_pinned === pinOverride.isPinned) {
          pinOverrideRef.current.delete(conversation.id);
        } else {
          mergedConversation = {
            ...mergedConversation,
            is_pinned: pinOverride.isPinned,
            pinned_at: pinOverride.isPinned
              ? previous?.pinned_at ??
                mergedConversation.pinned_at ??
                new Date().toISOString()
              : null,
            pinned_by: pinOverride.isPinned
              ? previous?.pinned_by ?? mergedConversation.pinned_by
              : null,
          };
        }
      }

      const assignmentOverride =
        assignmentOverrideRef.current.get(conversation.id);

      if (assignmentOverride) {
        if (assignmentOverride.expiresAt <= Date.now()) {
          assignmentOverrideRef.current.delete(conversation.id);
        } else if (
          conversation.assigned_to === assignmentOverride.assignedTo
        ) {
          assignmentOverrideRef.current.delete(conversation.id);
        } else {
          const optimisticMember = assignmentOverride.assignedTo
            ? teamMembers.find(
                (member) => member.id === assignmentOverride.assignedTo,
              ) ?? mergedConversation.assigned_member
            : null;

          mergedConversation = {
            ...mergedConversation,
            assigned_to: assignmentOverride.assignedTo,
            assigned_at: assignmentOverride.assignedTo
              ? previous?.assigned_at ??
                mergedConversation.assigned_at ??
                new Date().toISOString()
              : null,
            assigned_member: optimisticMember,
          };
        }
      }

      const statusOverride =
        statusOverrideRef.current.get(conversation.id);

      if (statusOverride) {
        if (statusOverride.expiresAt <= Date.now()) {
          statusOverrideRef.current.delete(conversation.id);
        } else if (conversation.status === statusOverride.status) {
          statusOverrideRef.current.delete(conversation.id);
        } else {
          mergedConversation = {
            ...mergedConversation,
            status: statusOverride.status,
          };
        }
      }

      const contactId = mergedConversation.contact?.id ?? null;
      if (contactId) {
        const tagOverride =
          contactTagsOverrideRef.current.get(contactId);

        if (tagOverride) {
          if (tagOverride.expiresAt <= Date.now()) {
            contactTagsOverrideRef.current.delete(contactId);
          } else {
            const serverTagIds = new Set(
              (conversation.contact?.tags ?? []).map((tag) => tag.id),
            );
            const overrideTagIds = new Set(
              tagOverride.tags.map((tag) => tag.id),
            );
            const serverMatchesOverride =
              serverTagIds.size === overrideTagIds.size &&
              Array.from(overrideTagIds).every((tagId) =>
                serverTagIds.has(tagId),
              );

            if (serverMatchesOverride) {
              contactTagsOverrideRef.current.delete(contactId);
            } else if (mergedConversation.contact) {
              mergedConversation = {
                ...mergedConversation,
                contact: {
                  ...mergedConversation.contact,
                  tags: tagOverride.tags,
                },
              };
            }
          }
        }
      }

      if (
        manualUnreadConversationIdsRef.current.has(
          conversation.id,
        ) ||
        persistedManualUnreadCount > 0
      ) {
        return {
          ...mergedConversation,
          unread_count: Math.max(
            1,
            persistedManualUnreadCount,
            previous?.unread_count ?? 0,
            mergedConversation.unread_count ?? 0,
          ),
        };
      }

      const readBarrier =
        readBarrierMessageTimeRef.current.get(
          conversation.id,
        ) ?? 0;
      const mergedMessageTime =
        mergedConversation.last_message_at
          ? new Date(
              mergedConversation.last_message_at,
            ).getTime()
          : 0;

      if (
        readBarrier > 0 &&
        Number.isFinite(mergedMessageTime)
      ) {
        if (
          mergedMessageTime <=
          readBarrier + 1000
        ) {
          mergedConversation = {
            ...mergedConversation,
            unread_count: 0,
          };
        } else {
          readBarrierMessageTimeRef.current.delete(
            conversation.id,
          );
        }
      }

      return mergedConversation;
    });

    /*
     * Status/channel/view navigation can legitimately omit the currently
     * selected row from fresh server props. Keep only that selected row in
     * local state so MessagePanel remains mounted; ConversationList applies
     * the active left-panel scope before rendering rows.
     */
    const selectedId =
      desiredConversationIdRef.current;

    if (
      selectedId &&
      !next.some((conversation) => conversation.id === selectedId)
    ) {
      const selectedPrevious = currentById.get(selectedId);

      if (selectedPrevious) {
        const persistedManualUnreadCount =
          persistedManualUnreadCountsRef.current.get(selectedId) ?? 0;

        next.push({
          ...selectedPrevious,
          unread_count: Math.max(
            selectedPrevious.unread_count ?? 0,
            persistedManualUnreadCount,
          ),
        });
      }
    }

    return sortLiveConversations(next);
  });
}, [
  conversations,
]);

useEffect(() => {
  /*
   * Merge the newest server page into local state instead of
   * replacing it. This preserves older pages that V2.7 already
   * loaded when another action triggers router.refresh().
   */
  setLiveMessages(
    (current) => {
      if (
        !resolvedActiveConversationId
      ) {
        return [];
      }

      const merged =
        new Map<
          string,
          InboxMessage
        >();

      for (
        const message of current
      ) {
        if (
          message.conversation_id ===
          resolvedActiveConversationId
        ) {
          merged.set(
            message.id,
            message,
          );
        }
      }

      for (
        const message of messages
      ) {
        if (
          message.conversation_id !==
          resolvedActiveConversationId
        ) {
          continue;
        }

        const existing =
          merged.get(
            message.id,
          );

        const localAttachmentUrl =
          existing
            ?.attachment_url
            ?.startsWith(
              "blob:",
            )
            ? existing
                .attachment_url
            : null;

        merged.set(
          message.id,
          {
            ...existing,
            ...message,
            attachment_url:
              message.attachment_url ??
              localAttachmentUrl,
          } as InboxMessage,
        );
      }

      return Array.from(
        merged.values(),
      ).sort(
        (first, second) => {
          const timeDifference =
            new Date(
              first.created_at,
            ).getTime() -
            new Date(
              second.created_at,
            ).getTime();

          if (
            timeDifference !== 0
          ) {
            return timeDifference;
          }

          return first.id.localeCompare(
            second.id,
          );
        },
      );
    },
  );
}, [
  messages,
  resolvedActiveConversationId,
]);

/*
 * V3.11.16.8 — latest-page cache + prefetch.
 * Conversation rows can warm the next thread on hover/focus, then selection
 * swaps local state immediately while the URL is updated with History API.
 */
const loadConversationMessagePage =
  useCallback(
    async (
      conversationId: string,
      options?: {
        forceRefresh?: boolean;
      },
    ): Promise<ConversationMessagePage> => {
      const forceRefresh =
        options?.forceRefresh ??
        false;

      const cached =
        getCachedConversationPage(
          conversationId,
        );

      if (
        cached &&
        !forceRefresh
      ) {
        return cached;
      }

      const pending =
        conversationMessageRequestRef
          .current[conversationId];

      if (pending) {
        return pending;
      }

      const controller =
        new AbortController();

      conversationMessageAbortRef
        .current[conversationId] =
        controller;

      const request = (async () => {
        const params =
          new URLSearchParams({
            limit:
              String(
                MESSAGE_PAGE_SIZE,
              ),
          });

        const response = await fetch(
          `/api/conversations/${conversationId}/messages?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            signal:
              controller.signal,
          },
        );

        const responseText =
          await response.text();

        const result =
          responseText.trim()
            ? (JSON.parse(
                responseText,
              ) as {
                success?: boolean;
                error?: string;
                messages?: InboxMessage[];
                hasMore?: boolean;
              })
            : {
                success:
                  response.ok,
              };

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ??
              "Unable to load conversation messages.",
          );
        }

        const nextMessages =
          (Array.isArray(
            result.messages,
          )
            ? result.messages
            : []
          )
            .filter(
              (message) =>
                message.conversation_id ===
                conversationId,
            )
            .sort(
              (first, second) => {
                const timeDifference =
                  new Date(
                    first.created_at,
                  ).getTime() -
                  new Date(
                    second.created_at,
                  ).getTime();

                if (
                  timeDifference !== 0
                ) {
                  return timeDifference;
                }

                return first.id.localeCompare(
                  second.id,
                );
              },
            );

        const now = Date.now();
        const page: ConversationMessagePage = {
          messages:
            nextMessages,
          hasMore:
            typeof result.hasMore ===
              "boolean"
              ? result.hasMore
              : nextMessages.length >=
                MESSAGE_PAGE_SIZE,
          fetchedAt:
            now,
          lastAccessedAt:
            now,
        };

        setCachedConversationPage(
          conversationId,
          page,
        );

        return page;
      })();

      conversationMessageRequestRef
        .current[conversationId] =
        request;

      try {
        return await request;
      } finally {
        if (
          conversationMessageAbortRef
            .current[conversationId] ===
          controller
        ) {
          delete conversationMessageAbortRef
            .current[conversationId];
        }

        if (
          conversationMessageRequestRef
            .current[conversationId] ===
          request
        ) {
          delete conversationMessageRequestRef
            .current[conversationId];
        }
      }
    },
    [
      getCachedConversationPage,
      setCachedConversationPage,
    ],
  );

const prefetchConversation =
  useCallback(
    (
      conversationId: string,
    ) => {
      if (
        conversationId ===
          resolvedActiveConversationId ||
        getCachedConversationPage(
          conversationId,
        )
      ) {
        return;
      }

      void loadConversationMessagePage(
        conversationId,
      ).catch((error) => {
        if (
          isAbortError(error)
        ) {
          return;
        }

        // Prefetch is best-effort. A click will retry and surface loading.
      });
    },
    [
      getCachedConversationPage,
      loadConversationMessagePage,
      resolvedActiveConversationId,
    ],
  );

const selectConversationSmoothly =
  useCallback(
    async (
      conversationId: string,
      updateHistory = false,
    ) => {
      const targetConversation =
        liveConversations.find(
          (conversation) =>
            conversation.id ===
            conversationId,
        );

      if (!targetConversation) {
        return;
      }

      // Keep the global workspace selection unchanged. The selected thread's
      // own business id is resolved and authorized by Inbox APIs.

      if (
        conversationId ===
          desiredConversationIdRef.current &&
        conversationId ===
          resolvedActiveConversationId
      ) {
        return;
      }

      const currentConversationId =
        resolvedActiveConversationId;

      /*
       * Reopening a conversation that was manually marked unread is the
       * deliberate acknowledgement point. Clear only the destination's
       * persisted marker so the normal automatic /read flow can run.
       */
      if (
        currentConversationId !== conversationId
      ) {
        manualUnreadConversationIdsRef.current.delete(
          conversationId,
        );
        persistedManualUnreadCountsRef.current.delete(
          conversationId,
        );
      }

      if (
        currentConversationId &&
        currentConversationId !== conversationId
      ) {
        manualUnreadConversationIdsRef.current.delete(
          currentConversationId,
        );
      }

      if (
        currentConversationId &&
        !loadingConversationMessages
      ) {
        const scopedCurrentMessages =
          liveMessages.filter(
            (message) =>
              message.conversation_id ===
              currentConversationId,
          );

        if (
          scopedCurrentMessages.length ===
            liveMessages.length
        ) {
          const existing =
            getCachedConversationPage(
              currentConversationId,
            );

          setCachedConversationPage(
            currentConversationId,
            {
              messages:
                scopedCurrentMessages,
              hasMore:
                hasMoreOlderMessages,
              fetchedAt:
                existing?.fetchedAt ??
                Date.now(),
            },
          );
        }
      }

      /*
       * V3.11.17 — a rapid A -> B -> C switch should not leave old selected
       * message requests consuming bandwidth or racing the new selection.
       * Keep a request for the destination conversation if it was prefetched.
       */
      abortConversationRequestsExcept(
        conversationId,
      );

      desiredConversationIdRef.current =
        conversationId;
      setClientSelectedConversationId(
        conversationId,
      );
      setOlderMessagesError(null);
      setConversationMessagesError(
        null,
      );
      setLoadingOlderMessages(false);
      loadOlderInFlightRef.current =
        false;

      const cached =
        getCachedConversationPage(
          conversationId,
        );

      if (cached) {
        setLiveMessages(
          cached.messages,
        );
        setHasMoreOlderMessages(
          cached.hasMore,
        );
        setLoadingConversationMessages(
          false,
        );

        /*
         * Show warm cache immediately, but always verify the newest server
         * page on an explicit conversation click. Realtime can be briefly
         * disconnected and a 15-second cache is long enough to hide the true
         * latest message on the first open. The refresh is quiet and keeps
         * optimistic local attachments/messages intact.
         */
        void loadConversationMessagePage(
          conversationId,
          {
            forceRefresh: true,
          },
        )
          .then((page) => {
            if (
              desiredConversationIdRef
                .current !==
              conversationId
            ) {
              return;
            }

            setLiveMessages(
              (current) => {
                const currentById =
                  new Map(
                    current.map(
                      (message) => [
                        message.id,
                        message,
                      ],
                    ),
                  );

                const merged =
                  page.messages.map(
                    (message) => {
                      const existing =
                        currentById.get(
                          message.id,
                        );

                      const localAttachmentUrl =
                        existing?.attachment_url?.startsWith(
                          "blob:",
                        )
                          ? existing.attachment_url
                          : null;

                      return {
                        ...existing,
                        ...message,
                        attachment_url:
                          message.attachment_url ??
                          localAttachmentUrl,
                      } as InboxMessage;
                    },
                  );

                for (
                  const message of current
                ) {
                  if (
                    message.id.startsWith(
                      "optimistic:",
                    ) &&
                    !merged.some(
                      (candidate) =>
                        candidate.id ===
                        message.id,
                    )
                  ) {
                    merged.push(message);
                  }
                }

                return merged.sort(
                  (first, second) => {
                    const timeDifference =
                      new Date(
                        first.created_at,
                      ).getTime() -
                      new Date(
                        second.created_at,
                      ).getTime();

                    return timeDifference !== 0
                      ? timeDifference
                      : first.id.localeCompare(
                          second.id,
                        );
                  },
                );
              },
            );

            setHasMoreOlderMessages(
              page.hasMore,
            );
          })
          .catch((error) => {
            if (
              isAbortError(error)
            ) {
              return;
            }

            // Cached data remains usable if the quiet refresh fails.
            console.warn(
              "Unable to refresh cached conversation messages:",
              error,
            );
          });
      } else {
        setLiveMessages([]);
        setHasMoreOlderMessages(
          false,
        );
        setLoadingConversationMessages(
          true,
        );

        void loadConversationMessagePage(
          conversationId,
        )
          .then((page) => {
            if (
              desiredConversationIdRef
                .current !==
              conversationId
            ) {
              return;
            }

            setLiveMessages(
              page.messages,
            );
            setHasMoreOlderMessages(
              page.hasMore,
            );
          })
          .catch((error) => {
            if (
              isAbortError(error)
            ) {
              return;
            }

            if (
              desiredConversationIdRef
                .current !==
              conversationId
            ) {
              return;
            }

            setConversationMessagesError(
              error instanceof Error
                ? error.message
                : "Unable to load conversation messages.",
            );
          })
          .finally(() => {
            if (
              desiredConversationIdRef
                .current ===
              conversationId
            ) {
              setLoadingConversationMessages(
                false,
              );
            }
          });
      }

      if (
        updateHistory &&
        typeof window !==
          "undefined"
      ) {
        const params =
          new URLSearchParams(
            window.location.search,
          );

        params.set(
          "conversation",
          conversationId,
        );

        const query =
          params.toString();

        window.history.pushState(
          null,
          "",
          query
            ? `/dashboard/inbox?${query}`
            : "/dashboard/inbox",
        );
      }
    },
    [
      abortConversationRequestsExcept,
      getCachedConversationPage,
      hasMoreOlderMessages,
      liveConversations,
      liveMessages,
      loadConversationMessagePage,
      loadingConversationMessages,
      resolvedActiveConversationId,
      setCachedConversationPage,
      activeBusinessId,
      searchParams,
    ],
  );

const clearConversationSelection =
  useCallback(() => {
    const currentConversationId =
      resolvedActiveConversationId;

    if (currentConversationId) {
      manualUnreadConversationIdsRef.current.delete(
        currentConversationId,
      );
    }

    if (
      currentConversationId &&
      !loadingConversationMessages
    ) {
      const scopedMessages = liveMessages.filter(
        (message) =>
          message.conversation_id === currentConversationId,
      );

      if (scopedMessages.length === liveMessages.length) {
        const existing = getCachedConversationPage(
          currentConversationId,
        );
        setCachedConversationPage(
          currentConversationId,
          {
            messages: scopedMessages,
            hasMore: hasMoreOlderMessages,
            fetchedAt: existing?.fetchedAt ?? Date.now(),
          },
        );
      }
    }

    abortConversationRequestsExcept(null);
    desiredConversationIdRef.current = null;
    setClientSelectedConversationId(null);
    setLiveMessages([]);
    setHasMoreOlderMessages(false);
    setLoadingConversationMessages(false);
    setConversationMessagesError(null);
    setOlderMessagesError(null);

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.delete("conversation");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        query ? `/dashboard/inbox?${query}` : "/dashboard/inbox",
      );
    }
  }, [
    abortConversationRequestsExcept,
    getCachedConversationPage,
    hasMoreOlderMessages,
    liveMessages,
    loadingConversationMessages,
    resolvedActiveConversationId,
    setCachedConversationPage,
  ]);

const retryConversationMessages =
  useCallback(() => {
    const conversationId =
      desiredConversationIdRef
        .current ??
      resolvedActiveConversationId;

    if (!conversationId) {
      return;
    }

    delete conversationMessageCacheRef
      .current[conversationId];

    conversationMessageAbortRef
      .current[conversationId]
      ?.abort();
    delete conversationMessageAbortRef
      .current[conversationId];
    delete conversationMessageRequestRef
      .current[conversationId];

    setConversationMessagesError(
      null,
    );
    setLoadingConversationMessages(
      true,
    );

    void loadConversationMessagePage(
      conversationId,
    )
      .then((page) => {
        if (
          desiredConversationIdRef
            .current !==
          conversationId
        ) {
          return;
        }

        setLiveMessages(
          page.messages,
        );
        setHasMoreOlderMessages(
          page.hasMore,
        );
      })
      .catch((error) => {
        if (
          desiredConversationIdRef
            .current !==
          conversationId
        ) {
          return;
        }

        setConversationMessagesError(
          error instanceof Error
            ? error.message
            : "Unable to load conversation messages.",
        );
      })
      .finally(() => {
        if (
          desiredConversationIdRef
            .current ===
          conversationId
        ) {
          setLoadingConversationMessages(
            false,
          );
        }
      });
  }, [
    loadConversationMessagePage,
    resolvedActiveConversationId,
  ]);

/*
 * Keep cache aligned with realtime/optimistic changes for the active thread.
 */
useEffect(() => {
  if (
    !resolvedActiveConversationId ||
    loadingConversationMessages
  ) {
    return;
  }

  const scopedMessages =
    liveMessages.filter(
      (message) =>
        message.conversation_id ===
        resolvedActiveConversationId,
    );

  if (
    scopedMessages.length !==
      liveMessages.length
  ) {
    return;
  }

  const existing =
    getCachedConversationPage(
      resolvedActiveConversationId,
    );

  setCachedConversationPage(
    resolvedActiveConversationId,
    {
      messages:
        scopedMessages,
      hasMore:
        hasMoreOlderMessages,
      fetchedAt:
        existing?.fetchedAt ??
        Date.now(),
    },
  );
}, [
  getCachedConversationPage,
  hasMoreOlderMessages,
  liveMessages,
  loadingConversationMessages,
  resolvedActiveConversationId,
  setCachedConversationPage,
]);

/*
 * Active-thread live safety net.
 *
 * Supabase Realtime remains the fast path. In production, a publication/RLS
 * delay or a transient websocket disconnect can occasionally cause a message
 * INSERT event to be missed. Previously the open chat then stayed stale until
 * the user refreshed the browser. Quietly fetch only the newest message page
 * while a thread is open and merge it into local state. Older loaded pages and
 * optimistic outgoing messages are preserved.
 */
useEffect(() => {
  if (!resolvedActiveConversationId) {
    return;
  }

  const conversationId: string =
    resolvedActiveConversationId;

  let cancelled = false;
  let timer: number | null = null;
  let inFlight = false;

  /*
   * Seed the fallback with messages already loaded for this thread. If the
   * thread has not loaded yet, the first successful fetch becomes the baseline
   * so old history never triggers a burst of alert sounds.
   */
  const fallbackKnownMessageIds = new Set(
    liveMessagesRef.current
      .filter(
        (message) =>
          message.conversation_id === conversationId,
      )
      .map((message) => message.id),
  );
  let fallbackBaselineReady =
    fallbackKnownMessageIds.size > 0;

  const mergeNewestPage = (
    current: InboxMessage[],
    serverMessages: InboxMessage[],
  ) => {
    /*
     * The polling fallback can discover the real outgoing row before the
     * Supabase INSERT event reaches this browser. Reconcile that row with the
     * optimistic bubble exactly like the Realtime path does; otherwise the
     * temporary bubble and the real row are both rendered.
     */
    const merged = [...current];

    for (const serverMessage of serverMessages) {
      const existingIndex = merged.findIndex(
        (message) =>
          message.id === serverMessage.id,
      );

      if (existingIndex >= 0) {
        const existing = merged[existingIndex];
        const localAttachmentUrl =
          existing.attachment_url?.startsWith("blob:")
            ? existing.attachment_url
            : null;

        merged[existingIndex] = {
          ...existing,
          ...serverMessage,
          attachment_url:
            serverMessage.attachment_url ??
            localAttachmentUrl,
        } as InboxMessage;

        continue;
      }

      let optimisticIndex = -1;

      if (
        serverMessage.direction === "outgoing" &&
        serverMessage.message_text
      ) {
        const serverCreatedAt =
          new Date(serverMessage.created_at).getTime();
        let closestDifference =
          Number.POSITIVE_INFINITY;

        for (let index = 0; index < merged.length; index += 1) {
          const candidate = merged[index];
          const optimistic =
            candidate as OptimisticInboxMessage;

          if (
            !optimistic.__optimistic_status ||
            candidate.conversation_id !== conversationId ||
            candidate.direction !== "outgoing" ||
            candidate.message_text !==
              serverMessage.message_text ||
            (candidate.message_type ?? "text") !==
              (serverMessage.message_type ?? "text") ||
            (!pendingSendsRef.current[candidate.id] &&
              !pendingAttachmentSendsRef.current[candidate.id])
          ) {
            continue;
          }

          const optimisticCreatedAt =
            optimistic.__optimistic_created_at ??
            new Date(candidate.created_at).getTime();
          const difference = Math.abs(
            serverCreatedAt - optimisticCreatedAt,
          );

          if (
            difference < 120_000 &&
            difference < closestDifference
          ) {
            optimisticIndex = index;
            closestDifference = difference;
          }
        }
      }

      if (optimisticIndex >= 0) {
        const optimisticMessage =
          merged[optimisticIndex];
        const optimisticId =
          optimisticMessage.id;
        const localAttachmentUrl =
          optimisticMessage.attachment_url?.startsWith("blob:")
            ? optimisticMessage.attachment_url
            : null;

        delete pendingSendsRef.current[
          optimisticId
        ];
        delete pendingAttachmentSendsRef.current[
          optimisticId
        ];

        merged[optimisticIndex] = {
          ...serverMessage,
          attachment_url:
            serverMessage.attachment_url ??
            localAttachmentUrl,
        } as InboxMessage;

        continue;
      }

      merged.push(serverMessage);
    }

    return merged.sort(
      (first, second) => {
        const timeDifference =
          new Date(first.created_at).getTime() -
          new Date(second.created_at).getTime();

        return timeDifference !== 0
          ? timeDifference
          : first.id.localeCompare(second.id);
      },
    );
  };

  async function syncNewestMessages() {
    if (
      cancelled ||
      inFlight ||
      !navigator.onLine
    ) {
      return;
    }

    inFlight = true;

    try {
      const params = new URLSearchParams({
        limit: String(MESSAGE_PAGE_SIZE),
        live: String(Date.now()),
      });
      const response = await fetch(
        `/api/conversations/${conversationId}/messages?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        },
      );
      const responseText = await response.text();
      const result = responseText.trim()
        ? (JSON.parse(responseText) as {
            success?: boolean;
            error?: string;
            messages?: InboxMessage[];
          })
        : { success: response.ok };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to synchronize live messages.",
        );
      }

      const newestMessages = Array.isArray(result.messages)
        ? result.messages.filter(
            (message) =>
              message.conversation_id === conversationId,
          )
        : [];

      if (cancelled) {
        return;
      }

      const newlyDiscoveredIncoming =
        fallbackBaselineReady
          ? newestMessages.filter(
              (message) =>
                message.direction === "incoming" &&
                !fallbackKnownMessageIds.has(message.id) &&
                !handledIncomingMessageIdsRef.current.has(
                  message.id,
                ),
            )
          : [];

      for (const message of newestMessages) {
        fallbackKnownMessageIds.add(message.id);
      }
      fallbackBaselineReady = true;

      for (const message of newlyDiscoveredIncoming) {
        handledIncomingMessageIdsRef.current.add(message.id);
        recentIncomingConversationAtRef.current.set(
          conversationId,
          Date.now(),
        );

        const notificationConversation =
          liveConversationsRef.current.find(
            (conversation) =>
              conversation.id === conversationId,
          );

        notifyIncomingMessage({
          messageId: message.id,
          conversationId,
          customerName:
            notificationConversation?.contact?.full_name?.trim() ||
            "Facebook customer",
          body: getRealtimeMessagePreview(
            message as unknown as Record<string, unknown>,
          ),
        });
      }

      setLiveMessages((current) => {
        const nextMessages = mergeNewestPage(
          current.filter(
            (message) =>
              message.conversation_id ===
              conversationId,
          ),
          newestMessages,
        );

        liveMessagesRef.current = nextMessages;
        return nextMessages;
      });

      /*
       * If Supabase Realtime missed the INSERT, keep the conversation row in
       * sync from the same server-authoritative message page. This prevents the
       * left list preview/time from remaining stale until a browser refresh.
       */
      const latestServerMessage =
        newestMessages[newestMessages.length - 1] ?? null;

      if (latestServerMessage) {
        const latestMessageAt =
          latestServerMessage.platform_created_at ??
          latestServerMessage.created_at;
        const latestMessageTime = new Date(
          latestMessageAt,
        ).getTime();
        const latestPreview = getRealtimeMessagePreview(
          latestServerMessage as unknown as Record<string, unknown>,
        );

        setLiveConversations((current) =>
          sortLiveConversations(
            current.map((conversation) => {
              if (conversation.id !== conversationId) {
                return conversation;
              }

              const currentMessageTime = conversation.last_message_at
                ? new Date(conversation.last_message_at).getTime()
                : 0;

              if (
                Number.isFinite(currentMessageTime) &&
                Number.isFinite(latestMessageTime) &&
                currentMessageTime > latestMessageTime + 1000
              ) {
                return conversation;
              }

              return {
                ...conversation,
                last_message_text: latestPreview,
                last_message_at: latestMessageAt,
              };
            }),
          ),
        );
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn(
          "Unable to run active-thread live message fallback:",
          error,
        );
      }
    } finally {
      inFlight = false;
    }
  }

  function scheduleNext() {
    if (cancelled) {
      return;
    }

    timer = window.setTimeout(async () => {
      await syncNewestMessages();
      scheduleNext();
    }, 2000);
  }

  function syncWhenVisible() {
    if (document.visibilityState === "visible") {
      void syncNewestMessages();
    }
  }

  /*
   * Do not wait for the first timer tick. If the websocket was disconnected
   * before this thread opened, fetch the latest page immediately and then keep
   * the lightweight safety-net poll running in the background.
   */
  void syncNewestMessages();
  scheduleNext();
  window.addEventListener("focus", syncWhenVisible);
  window.addEventListener("online", syncWhenVisible);
  document.addEventListener(
    "visibilitychange",
    syncWhenVisible,
  );

  return () => {
    cancelled = true;

    if (timer !== null) {
      window.clearTimeout(timer);
    }

    window.removeEventListener("focus", syncWhenVisible);
    window.removeEventListener("online", syncWhenVisible);
    document.removeEventListener(
      "visibilitychange",
      syncWhenVisible,
    );
  };
}, [
  notifyIncomingMessage,
  resolvedActiveConversationId,
]);

/*
 * Browser Back/Forward changes useSearchParams without a full route reload.
 * Mirror that URL selection into the same smooth client switch path.
 */
useEffect(() => {
  const fallbackId =
    requestedConversationId &&
    liveConversations.some(
      (conversation) =>
        conversation.id ===
        requestedConversationId,
    )
      ? requestedConversationId
      : null;

  if (!fallbackId) {
    /*
     * Left-panel filters/channels intentionally change the URL without a
     * conversation parameter. Keep the client-selected center thread alive.
     * A real browser refresh still starts empty because client state is rebuilt.
     */
    return;
  }

  if (
    fallbackId !==
    clientSelectedConversationId
  ) {
    selectConversationSmoothly(
      fallbackId,
      false,
    );
  }
}, [
  clientSelectedConversationId,
  liveConversations,
  requestedConversationId,
  selectConversationSmoothly,
]);

async function handleLoadOlderMessages(): Promise<boolean> {
  const conversationId =
    resolvedActiveConversationId;

  if (
    !conversationId ||
    !hasMoreOlderMessages ||
    loadingOlderMessages ||
    loadOlderInFlightRef.current
  ) {
    return false;
  }

  /*
   * The array is kept oldest → newest. Optimistic messages are
   * always recent, but skip them defensively when building the
   * database cursor.
   */
  const oldestPersistedMessage =
    liveMessages.find(
      (message) =>
        !message.id.startsWith(
          "optimistic:",
        ) &&
        Boolean(
          message.created_at,
        ),
    ) ?? null;

  if (!oldestPersistedMessage) {
    setHasMoreOlderMessages(
      false,
    );
    return false;
  }

  loadOlderInFlightRef.current =
    true;
  setLoadingOlderMessages(true);
  setOlderMessagesError(null);

  try {
    const searchParams =
      new URLSearchParams({
        beforeCreatedAt:
          oldestPersistedMessage
            .created_at,
        beforeId:
          oldestPersistedMessage.id,
        limit:
          String(
            MESSAGE_PAGE_SIZE,
          ),
      });

    const response =
      await fetch(
        `/api/conversations/${conversationId}/messages?${searchParams.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

    const responseText =
      await response.text();

    const result =
      responseText.trim()
        ? (JSON.parse(
            responseText,
          ) as {
            success?: boolean;
            error?: string;
            messages?: InboxMessage[];
            hasMore?: boolean;
          })
        : {
            success:
              response.ok,
          };

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to load older messages.",
      );
    }

    const olderMessages =
      Array.isArray(
        result.messages,
      )
        ? result.messages
        : [];

    /*
     * The agent may switch threads while this older-page request is in flight.
     * Never prepend Conversation A messages into Conversation B.
     */
    if (
      desiredConversationIdRef
        .current !==
      conversationId
    ) {
      return false;
    }

    setHasMoreOlderMessages(
      Boolean(
        result.hasMore,
      ),
    );

    if (
      olderMessages.length === 0
    ) {
      return false;
    }

    setLiveMessages(
      (current) => {
        const merged =
          new Map<
            string,
            InboxMessage
          >();

        for (
          const message of [
            ...olderMessages,
            ...current,
          ]
        ) {
          const existing =
            merged.get(
              message.id,
            );

          const localAttachmentUrl =
            existing
              ?.attachment_url
              ?.startsWith(
                "blob:",
              )
              ? existing
                  .attachment_url
              : message
                  .attachment_url
                    ?.startsWith(
                      "blob:",
                    )
                ? message
                    .attachment_url
                : null;

          merged.set(
            message.id,
            {
              ...existing,
              ...message,
              attachment_url:
                message
                  .attachment_url ??
                existing
                  ?.attachment_url ??
                localAttachmentUrl,
            } as InboxMessage,
          );
        }

        return Array.from(
          merged.values(),
        ).sort(
          (first, second) => {
            const timeDifference =
              new Date(
                first.created_at,
              ).getTime() -
              new Date(
                second.created_at,
              ).getTime();

            if (
              timeDifference !== 0
            ) {
              return timeDifference;
            }

            return first.id.localeCompare(
              second.id,
            );
          },
        );
      },
    );

    return true;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load older messages.";

    setOlderMessagesError(
      message,
    );

    console.error(
      "Unable to load older messages:",
      error,
    );

    return false;
  } finally {
    loadOlderInFlightRef.current =
      false;
    setLoadingOlderMessages(
      false,
    );
  }
}

useEffect(() => {
  if (
    requestedConversationId &&
    !liveConversations.some(
      (conversation) =>
        conversation.id ===
        requestedConversationId,
    )
  ) {
    desiredConversationIdRef.current =
      null;
    setClientSelectedConversationId(
      null,
    );

    if (
      typeof window !==
      "undefined"
    ) {
      const params =
        new URLSearchParams(
          window.location.search,
        );

      params.delete(
        "conversation",
      );

      const query =
        params.toString();

      window.history.replaceState(
        null,
        "",
        query
          ? `/dashboard/inbox?${query}`
          : "/dashboard/inbox",
      );
    }
  }
}, [
  liveConversations,
  requestedConversationId,
]);

useEffect(() => {
  if (!resolvedActiveConversationId) {
    return;
  }

  const currentConversation =
    liveConversations.find(
      (conversation) =>
        conversation.id ===
        resolvedActiveConversationId,
    );

  if (
    !currentConversation ||
    currentConversation.unread_count === 0 ||
    manualUnreadConversationIdsRef.current.has(
      resolvedActiveConversationId,
    )
  ) {
    return;
  }

  /*
   * Use the same tracked read request used by realtime handling. This prevents
   * a second untracked /read PATCH from racing with Mark unread.
   */
  void markConversationReadRealtime(
    resolvedActiveConversationId,
  );
}, [
  liveConversations,
  resolvedActiveConversationId,
]);

  async function handleMarkUnread() {
    if (!activeConversation) {
      return;
    }

    const conversationId =
      activeConversation.id;

    /* Keep it unread for the entire time this exact thread stays open. */
    readBarrierMessageTimeRef.current.delete(
      conversationId,
    );
    manualUnreadConversationIdsRef.current.add(
      conversationId,
    );
    persistedManualUnreadCountsRef.current.set(
      conversationId,
      Math.max(
        1,
        activeConversation.unread_count ?? 0,
      ),
    );

    setMarkingUnread(true);
    unreadWriteInFlightRef.current.add(conversationId);

    /* Optimistic UI: show the unread badge immediately. */
    setLiveConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              unread_count: Math.max(
                1,
                conversation.unread_count ?? 0,
              ),
            }
          : conversation,
      ),
    );

    try {
      /*
       * If TENH was still finishing the automatic read request from opening
       * this thread, let that tracked request finish first. The unread PATCH is
       * then guaranteed to be the later write instead of losing a race to
       * /read and disappearing a moment later.
       */
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (!readInFlightRef.current.has(conversationId)) {
          break;
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 25);
        });
      }

      const response = await fetch(
        `/api/conversations/${conversationId}/unread`,
        { method: "PATCH" },
      );

      const responseText =
        await response.text();
      const result: {
        success: boolean;
        error?: string;
        conversation?: {
          id: string;
          unread_count: number;
        };
      } = responseText
        ? (JSON.parse(responseText) as {
            success: boolean;
            error?: string;
            conversation?: {
              id: string;
              unread_count: number;
            };
          })
        : { success: response.ok };

      if (!response.ok || !result.success) {
        manualUnreadConversationIdsRef.current.delete(
          conversationId,
        );
        throw new Error(
          result.error ??
            "Unable to mark conversation unread.",
        );
      }

      const authoritativeUnreadCount =
        Math.max(
          1,
          result.conversation?.unread_count ?? 1,
        );

      persistedManualUnreadCountsRef.current.set(
        conversationId,
        authoritativeUnreadCount,
      );

      if (
        manualUnreadConversationIdsRef.current.has(
          conversationId,
        )
      ) {
        setLiveConversations((current) =>
          current.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  unread_count: Math.max(
                    authoritativeUnreadCount,
                    conversation.unread_count ?? 0,
                  ),
                }
              : conversation,
          ),
        );
      }
    } catch (error) {
      manualUnreadConversationIdsRef.current.delete(
        conversationId,
      );
      persistedManualUnreadCountsRef.current.delete(
        conversationId,
      );
      console.error(error);
      /* Re-sync only on failure. */
      router.refresh();
    } finally {
      unreadWriteInFlightRef.current.delete(conversationId);
      setMarkingUnread(false);
    }
  }

async function handleTogglePin() {
  if (!activeConversation || pinning) {
    return;
  }

  const conversationId = activeConversation.id;
  const previousPinState = {
    is_pinned: Boolean(activeConversation.is_pinned),
    pinned_at: activeConversation.pinned_at ?? null,
    pinned_by: activeConversation.pinned_by ?? null,
  };
  const nextPinned = !previousPinState.is_pinned;

  setPinning(true);
  setPinError(null);

  pinOverrideRef.current.set(conversationId, {
    isPinned: nextPinned,
    expiresAt: Date.now() + 15_000,
  });

  setLiveConversations((current) =>
    sortLiveConversations(
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              is_pinned: nextPinned,
              pinned_at: nextPinned
                ? new Date().toISOString()
                : null,
              pinned_by: nextPinned
                ? conversation.pinned_by
                : null,
            }
          : conversation,
      ),
    ),
  );

  try {
    const response = await fetch(
      `/api/conversations/${conversationId}/pin`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isPinned: nextPinned }),
      },
    );

    const responseText = await response.text();
    let result: {
      success: boolean;
      error?: string;
      conversation?: {
        id: string;
        is_pinned: boolean;
        pinned_at: string | null;
        pinned_by: string | null;
      };
    };

    if (responseText.trim()) {
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error("Pin API returned invalid JSON.");
      }
    } else {
      result = {
        success: response.ok,
        error: response.ok
          ? undefined
          : `Pin API returned an empty response (${response.status}).`,
      };
    }

    if (!response.ok || !result.success) {
      throw new Error(
        result.error ?? "Unable to update conversation pin.",
      );
    }

    if (result.conversation) {
      pinOverrideRef.current.set(conversationId, {
        isPinned: result.conversation.is_pinned,
        expiresAt: Date.now() + 15_000,
      });

      setLiveConversations((current) =>
        sortLiveConversations(
          current.map((conversation) =>
            conversation.id === result.conversation?.id
              ? { ...conversation, ...result.conversation }
              : conversation,
          ),
        ),
      );
    }
  } catch (error) {
    const localOverride =
      pinOverrideRef.current.get(conversationId);

    if (localOverride?.isPinned === nextPinned) {
      pinOverrideRef.current.delete(conversationId);
      setLiveConversations((current) =>
        sortLiveConversations(
          current.map((conversation) =>
            conversation.id === conversationId
              ? { ...conversation, ...previousPinState }
              : conversation,
          ),
        ),
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Unable to update conversation pin.";

    setPinError(message);
    console.error("Unable to update conversation pin:", error);
  } finally {
    setPinning(false);
  }
}

function handleContactTagsChange(
  contactId: string,
  tags: CustomerTag[],
) {
  updateContactTagsLive(contactId, tags);
}

function showTelegramActionNotice(
  message: string,
) {
  if (
    telegramActionNoticeTimerRef.current
  ) {
    window.clearTimeout(
      telegramActionNoticeTimerRef.current,
    );
  }

  setTelegramActionNotice(
    message,
  );

  telegramActionNoticeTimerRef.current =
    window.setTimeout(
      () => {
        setTelegramActionNotice(
          null,
        );
        telegramActionNoticeTimerRef.current =
          null;
      },
      2200,
    );
}

function handleCancelTelegramEdit() {
  setEditingTelegramMessageId(
    null,
  );
  setReply("");
  setSendError(null);
}

async function handleEditTelegramMessage(
  messageId: string,
  currentText: string,
) {
  const normalized =
    currentText.trim();

  if (!normalized) {
    setSendError(
      "This Telegram message has no editable text.",
    );
    return;
  }

  setEditingTelegramMessageId(
    messageId,
  );
  setReplyingToTelegramMessageId(
    null,
  );
  setReplyingToCommentId(null);
  setReply(normalized);
  setSendError(null);

  window.requestAnimationFrame(
    () => {
      document
        .querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="Write a reply..."]',
        )
        ?.focus();
    },
  );
}

async function handleDeleteTelegramMessage(
  messageId: string,
) {
  const confirmed =
    window.confirm(
      "Delete this Telegram text message for both sides?",
    );

  if (!confirmed) {
    return;
  }

  setSendError(null);

  try {
    const response =
      await fetch(
        `/api/telegram/messages/${encodeURIComponent(
          messageId,
        )}`,
        {
          method: "DELETE",
        },
      );

    const responseText =
      await response.text();

    const result =
      responseText.trim()
        ? (
            JSON.parse(
              responseText,
            ) as {
              success?: boolean;
              error?: string;
              deletedAt?: string;
            }
          )
        : {};

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to delete Telegram message.",
      );
    }

    setLiveMessages(
      (current) =>
        current.map(
          (message) =>
            message.id ===
            messageId
              ? {
                  ...message,
                  message_text:
                    "Message deleted",
                  raw_payload: {
                    ...(
                      message.raw_payload ??
                      {}
                    ),
                    tenh_deleted: {
                      source:
                        "tenh",
                      deleted_at:
                        result.deletedAt ??
                        new Date().toISOString(),
                    },
                  },
                }
              : message,
        ),
    );

    if (
      editingTelegramMessageId ===
      messageId
    ) {
      setEditingTelegramMessageId(
        null,
      );
      setReply("");
    }

    if (
      replyingToTelegramMessageId ===
      messageId
    ) {
      setReplyingToTelegramMessageId(
        null,
      );
    }

    showTelegramActionNotice(
      "Telegram message deleted successfully",
    );
  } catch (error) {
    setSendError(
      error instanceof Error
        ? error.message
        : "Unable to delete Telegram message.",
    );
  }
}

function handleReplyToTelegramMessage(
  messageId: string,
) {
  setEditingTelegramMessageId(
    null,
  );
  setReply("");
  setReplyingToTelegramMessageId(
    messageId,
  );
  setReplyingToCommentId(null);
  setSendError(null);

  window.requestAnimationFrame(
    () => {
      document
        .querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="Write a reply..."]',
        )
        ?.focus();
    },
  );
}

function handleCancelTelegramReply() {
  setReplyingToTelegramMessageId(
    null,
  );
}

function handleReplyToComment(
  commentId: string,
) {
  setReplyingToCommentId(
    commentId,
  );

  window.requestAnimationFrame(
    () => {
      const input =
        document.querySelector<
          HTMLTextAreaElement
        >(
          'textarea[placeholder="Write a reply..."]',
        );

      input?.focus();
    },
  );
}

function handleCancelCommentReply() {
  setReplyingToCommentId(
    null,
  );

  window.requestAnimationFrame(
    () => {
      const input =
        document.querySelector<
          HTMLTextAreaElement
        >(
          'textarea[placeholder="Write a reply..."]',
        );

      input?.focus();
    },
  );
}


async function markCommentDeletedLocally(
  commentId: string,
) {
  try {
    const response =
      await fetch(
        "/api/facebook/comments/mark-deleted",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            commentId,
            deletedBy:
              "customer",
          }),
        },
      );

    return response.ok;
  } catch {
    return false;
  }
}

function isDeletedCommentError(
  errorMessage?: string,
) {
  if (!errorMessage) {
    return false;
  }

  const normalized =
    errorMessage.toLowerCase();

  return (
    normalized.includes(
      "comment not found",
    ) ||
    normalized.includes(
      "(#100)",
    ) ||
    normalized.includes(
      "error during posting",
    ) ||
    normalized.includes(
      "(#1705)",
    )
  );
}

async function handleLikeComment(
  commentId: string,
  liked: boolean,
): Promise<{
  success: boolean;
  deleted?: boolean;
}> {
  try {
    const response =
      await fetch(
        "/api/facebook/comments/like",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            commentId,
            liked,
          }),
        },
      );

    const responseText =
      await response.text();

    let result: {
      success?: boolean;
      error?: string;
    } = {};

    if (responseText.trim()) {
      try {
        result =
          JSON.parse(
            responseText,
          );
      } catch {
        result = {
          success: false,
          error:
            "Like API returned invalid JSON.",
        };
      }
    }

    if (
      !response.ok ||
      !result.success
    ) {
      if (
        isDeletedCommentError(
          result.error,
        )
      ) {
        await markCommentDeletedLocally(
          commentId,
        );

        router.refresh();

        return {
          success: false,
          deleted: true,
        };
      }

      window.alert(
        result.error ??
          "Unable to update Like.",
      );

      return {
        success: false,
      };
    }

    router.refresh();

    return {
      success: true,
    };
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to update Like.",
    );

    return {
      success: false,
    };
  }
}

async function handleDeleteComment(
  commentId: string,
): Promise<{
  success: boolean;
  deleted?: boolean;
}> {
  const confirmed =
    window.confirm(
      "Delete this Facebook comment?",
    );

  if (!confirmed) {
    return {
      success: false,
    };
  }

  try {
    const response =
      await fetch(
        "/api/facebook/comments/delete",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            commentId,
          }),
        },
      );

    const responseText =
      await response.text();

    let result: {
      success?: boolean;
      error?: string;
    } = {};

    if (responseText.trim()) {
      try {
        result =
          JSON.parse(
            responseText,
          );
      } catch {
        result = {
          success: false,
          error:
            "Delete API returned invalid JSON.",
        };
      }
    }

    if (
      !response.ok ||
      !result.success
    ) {
      if (
        isDeletedCommentError(
          result.error,
        )
      ) {
        await markCommentDeletedLocally(
          commentId,
        );

        router.refresh();

        return {
          success: false,
          deleted: true,
        };
      }

      window.alert(
        result.error ??
          "Unable to delete comment.",
      );

      return {
        success: false,
      };
    }

    router.refresh();

    return {
      success: true,
    };
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to delete comment.",
    );

    return {
      success: false,
    };
  }
}

async function handleHideComment(
  commentId: string,
  hidden: boolean,
): Promise<{
  success: boolean;
  deleted?: boolean;
}> {
  try {
    const response =
      await fetch(
        "/api/facebook/comments/hide",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            commentId,
            hidden,
          }),
        },
      );

    const responseText =
      await response.text();

    let result: {
      success?: boolean;
      error?: string;
    } = {};

    if (responseText.trim()) {
      try {
        result =
          JSON.parse(
            responseText,
          );
      } catch {
        result = {
          success: false,
          error:
            "Hide API returned invalid JSON.",
        };
      }
    }

    if (
      !response.ok ||
      !result.success
    ) {
      if (
        isDeletedCommentError(
          result.error,
        )
      ) {
        await markCommentDeletedLocally(
          commentId,
        );

        router.refresh();

        return {
          success: false,
          deleted: true,
        };
      }

      window.alert(
        result.error ??
          "Unable to update comment visibility.",
      );

      return {
        success: false,
      };
    }

    router.refresh();

    return {
      success: true,
    };
  } catch (error) {
    window.alert(
      error instanceof Error
        ? error.message
        : "Unable to update comment visibility.",
    );

    return {
      success: false,
    };
  }
}

function setOptimisticSendStatus(
  tempId: string,
  status: OptimisticSendStatus,
) {
  setLiveMessages(
    (current) =>
      current.map(
        (message) =>
          message.id ===
          tempId
            ? ({
                ...message,
                __optimistic_status:
                  status,
              } as unknown as typeof message)
            : message,
      ),
  );
}

function createOptimisticMessage({
  tempId,
  conversationId,
  message,
  recipientPlatformId,
}: {
  tempId: string;
  conversationId: string;
  message: string;
  recipientPlatformId: string;
}): InboxMessage {
  const now =
    new Date().toISOString();

  return {
    id: tempId,
    business_id:
      activeConversation
        ? getConversationBusinessId(
            activeConversation,
          ) ?? activeBusinessId
        : activeBusinessId,
    platform_message_id:
      tempId,
    conversation_id:
      conversationId,
    sender_type:
      "page",
    sender_platform_id:
      activeConversation
        ?.social_account
        ?.platform_account_id ??
      "",
    recipient_platform_id:
      recipientPlatformId,
    direction:
      "outgoing",
    message_type:
      "text",
    message_text:
      message,
    attachment_url:
      null,
    is_echo:
      false,
    raw_payload:
      null,
    platform_created_at:
      now,
    created_at:
      now,
    comment_is_liked:
      false,
    comment_is_hidden:
      false,
    comment_is_deleted:
      false,
    comment_deleted_by:
      null,
    __optimistic_status:
      "sending",
    __optimistic_created_at:
      Date.now(),
  } as unknown as InboxMessage;
}

function parseTenhLocationMessage(
  message: string,
) {
  const match =
    message
      .trim()
      .match(
        /^📍\s*Location:\s*https:\/\/www\.google\.com\/maps\?q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/i,
      );

  if (!match) {
    return null;
  }

  const latitude =
    Number(match[1]);
  const longitude =
    Number(match[2]);

  if (
    !Number.isFinite(
      latitude,
    ) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(
      longitude,
    ) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function isTelegramGifFile(
  file: File,
) {
  const mime =
    file.type
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() ??
    "";

  return (
    mime === "image/gif" ||
    file.name
      .toLowerCase()
      .endsWith(".gif")
  );
}

function getAttachmentMessageText(
  kind: ReplyAttachmentKind,
  fileName: string,
) {
  if (kind === "image") {
    return "Sent a photo";
  }

  if (kind === "video") {
    return "Sent a video";
  }

  return fileName.trim()
    ? `Sent a file: ${fileName}`
    : "Sent a file";
}

function createOptimisticAttachmentMessage({
  tempId,
  conversationId,
  recipientPlatformId,
  kind,
  file,
  previewUrl,
  messageText,
}: {
  tempId: string;
  conversationId: string;
  recipientPlatformId: string;
  kind: ReplyAttachmentKind;
  file: File;
  previewUrl: string;
  messageText: string;
}): InboxMessage {
  const now =
    new Date().toISOString();

  return {
    id: tempId,
    business_id:
      activeConversation
        ? getConversationBusinessId(
            activeConversation,
          ) ?? activeBusinessId
        : activeBusinessId,
    platform_message_id:
      tempId,
    conversation_id:
      conversationId,
    sender_type:
      "page",
    sender_platform_id:
      activeConversation
        ?.social_account
        ?.platform_account_id ??
      "",
    recipient_platform_id:
      recipientPlatformId,
    direction:
      "outgoing",
    message_type:
      kind,
    message_text:
      messageText,
    attachment_url:
      previewUrl,
    is_echo:
      false,
    raw_payload: {
      tenh_attachment: {
        type: kind,
        name: file.name,
        mime_type:
          file.type || null,
        size: file.size,
        optimistic: true,
      },
    },
    platform_created_at:
      now,
    created_at:
      now,
    comment_is_liked:
      false,
    comment_is_hidden:
      false,
    comment_is_deleted:
      false,
    comment_deleted_by:
      null,
    delivery_status:
      "sent",
    delivered_at:
      null,
    seen_at:
      null,
    __optimistic_status:
      "sending",
    __optimistic_created_at:
      Date.now(),
  } as unknown as InboxMessage;
}

function updateConversationPreviewOptimistically({
  conversationId,
  message,
  createdAt,
}: {
  conversationId: string;
  message: string;
  createdAt: string;
}) {
  setLiveConversations(
    (current) => {
      const next =
        current.map(
          (conversation) =>
            conversation.id ===
            conversationId
              ? {
                  ...conversation,
                  last_message_text:
                    message,
                  last_message_at:
                    createdAt,
                }
              : conversation,
        );

      return [...next].sort(
        (first, second) => {
          const firstPinned =
            Boolean(
              (
                first as {
                  is_pinned?:
                    boolean;
                }
              ).is_pinned,
            );

          const secondPinned =
            Boolean(
              (
                second as {
                  is_pinned?:
                    boolean;
                }
              ).is_pinned,
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
    },
  );
}

async function resolveConversationPlatform(
  conversation: InboxConversation,
): Promise<InboxConversationPlatform> {
  const loadedPlatform =
    getLoadedConversationPlatform(
      conversation,
    );

  if (loadedPlatform) {
    conversationPlatformCacheRef
      .current[conversation.id] =
      loadedPlatform;

    return loadedPlatform;
  }

  const cached =
    conversationPlatformCacheRef
      .current[conversation.id];

  if (cached) {
    return cached;
  }

  const response =
    await fetch(
      `/api/inbox/conversations/${encodeURIComponent(
        conversation.id,
      )}/channel`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

  const responseText =
    await response.text();

  let result: {
    success?: boolean;
    error?: string;
    platform?:
      | "facebook"
      | "telegram";
  } = {};

  if (responseText.trim()) {
    try {
      result =
        JSON.parse(
          responseText,
        ) as typeof result;
    } catch {
      result = {
        success: false,
        error:
          "The channel API returned invalid JSON.",
      };
    }
  }

  if (
    !response.ok ||
    !result.success ||
    (result.platform !==
      "facebook" &&
      result.platform !==
        "telegram")
  ) {
    throw new Error(
      result.error ??
        "Unable to resolve this conversation channel.",
    );
  }

  conversationPlatformCacheRef
    .current[conversation.id] =
    result.platform;

  return result.platform;
}

async function performOptimisticSend(
  pending:
    PendingOptimisticSend,
) {
  setOptimisticSendStatus(
    pending.tempId,
    "sending",
  );

  setSending(true);
  setSendError(null);

  try {
    const response =
      await fetch(
        pending.endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify(
            pending.requestBody,
          ),
        },
      );

    const responseText =
      await response.text();

    let result: {
      success: boolean;
      error?: string;
    };

    if (
      responseText.trim()
    ) {
      try {
        result =
          JSON.parse(
            responseText,
          ) as {
            success: boolean;
            error?: string;
          };
      } catch {
        result = {
          success: false,
          error:
            "The send API returned invalid JSON.",
        };
      }
    } else {
      result = {
        success:
          response.ok,
        error:
          response.ok
            ? undefined
            : `The send API returned an empty response (${response.status}).`,
      };
    }

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to send the message.",
      );
    }

    setOptimisticSendStatus(
      pending.tempId,
      "sent",
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unable to send the message.";

    setOptimisticSendStatus(
      pending.tempId,
      "failed",
    );

    if (
      pending
        .isCommentConversation &&
      pending.commentId &&
      isDeletedCommentError(
        errorMessage,
      )
    ) {
      await markCommentDeletedLocally(
        pending.commentId,
      );

      setSendError(
        "Comment is deleted by commenter.",
      );

      return;
    }

    setSendError(
      errorMessage,
    );
  } finally {
    setSending(false);
  }
}

async function performOptimisticAttachmentSend(
  pending:
    PendingOptimisticAttachmentSend,
): Promise<boolean> {
  setOptimisticSendStatus(
    pending.tempId,
    "sending",
  );

  setSending(true);
  setSendError(null);

  try {
    const formData =
      new FormData();

    formData.set(
      "conversationId",
      pending.conversationId,
    );
    if (
      pending.endpoint ===
      "/api/facebook/send-attachment"
    ) {
      formData.set(
        "recipientId",
        pending.recipientId,
      );
    }

    formData.set(
      "kind",
      pending.kind,
    );
    formData.set(
      "file",
      pending.file,
      pending.file.name,
    );

    const response =
      await fetch(
        pending.endpoint,
        {
          method: "POST",
          body: formData,
        },
      );

    const responseText =
      await response.text();

    let result: {
      success: boolean;
      error?: string;
      message?: InboxMessage;
    };

    if (responseText.trim()) {
      try {
        result =
          JSON.parse(
            responseText,
          ) as {
            success: boolean;
            error?: string;
            message?: InboxMessage;
          };
      } catch {
        result = {
          success: false,
          error:
            "The attachment API returned invalid JSON.",
        };
      }
    } else {
      result = {
        success: response.ok,
        error:
          response.ok
            ? undefined
            : `The attachment API returned an empty response (${response.status}).`,
      };
    }

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to send the attachment.",
      );
    }

    if (result.message) {
      setLiveMessages(
        (current) =>
          current.map(
            (message) =>
              message.id ===
              pending.tempId
                ? ({
                    ...result.message,
                    attachment_url:
                      pending.previewUrl,
                    __optimistic_status:
                      "sent",
                    __optimistic_created_at:
                      Date.now(),
                  } as unknown as typeof message)
                : message,
          ),
      );
    } else {
      setOptimisticSendStatus(
        pending.tempId,
        "sent",
      );
    }

    delete pendingAttachmentSendsRef
      .current[pending.tempId];

    return true;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unable to send the attachment.";

    setOptimisticSendStatus(
      pending.tempId,
      "failed",
    );
    setSendError(errorMessage);

    return false;
  } finally {
    setSending(false);
  }
}

async function handleSendAttachments(
  attachments: ReplyAttachment[],
): Promise<boolean> {
  if (editingTelegramMessageId) {
    setSendError(
      "Finish or cancel Telegram editing before sending an attachment.",
    );
    return false;
  }

  if (
    replyingToTelegramMessageId &&
    activeConversation
  ) {
    let replyPlatform:
      InboxConversationPlatform;

    try {
      replyPlatform =
        await resolveConversationPlatform(
          activeConversation,
        );
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Unable to resolve this conversation channel.",
      );
      return false;
    }

    if (replyPlatform === "telegram") {
      setSendError(
        "Telegram Reply supports text only. Cancel Reply before sending media.",
      );
      return false;
    }
  }

  if (
    !activeConversation ||
    !activeConversation.contact
  ) {
    return false;
  }

  if (replyingToCommentId) {
    setSendError(
      "Cancel the Facebook comment Reply target before sending an attachment.",
    );
    return false;
  }

  let conversationPlatform:
    InboxConversationPlatform;

  try {
    conversationPlatform =
      await resolveConversationPlatform(
        activeConversation,
      );
  } catch (error) {
    setSendError(
      error instanceof Error
        ? error.message
        : "Unable to resolve this conversation channel.",
    );
    return false;
  }

  if (
    conversationPlatform ===
    "telegram"
  ) {
    const unsupportedVideo =
      attachments.find(
        (attachment) => {
          if (
            attachment.kind !==
            "video"
          ) {
            return false;
          }

          const fileType =
            attachment.file.type
              ?.split(";")[0]
              ?.trim()
              .toLowerCase() ??
            "";
          const lowerName =
            attachment.file.name
              .toLowerCase();

          return !(
            fileType ===
              "video/mp4" ||
            lowerName.endsWith(
              ".mp4",
            )
          );
        },
      );

    if (unsupportedVideo) {
      setSendError(
        "TENH Telegram video currently supports MP4 video only. Please choose an .mp4 file.",
      );
      return false;
    }

    const tooLarge =
      attachments.find(
        (attachment) =>
          attachment.file.size >
          4 * 1024 * 1024,
      );

    if (tooLarge) {
      setSendError(
        "For reliable Vercel delivery, TENH Telegram media uploads are currently limited to 4 MB each.",
      );
      return false;
    }
  }

  let allSucceeded = true;

  for (const attachment of attachments) {
    const randomId =
      typeof crypto !==
        "undefined" &&
      typeof crypto.randomUUID ===
        "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const tempId =
      `optimistic:attachment:${randomId}`;

    const previewUrl =
      URL.createObjectURL(
        attachment.file,
      );

    const messageText =
      conversationPlatform ===
          "telegram" &&
        isTelegramGifFile(
          attachment.file,
        )
        ? "Sent an animation"
        : getAttachmentMessageText(
            attachment.kind,
            attachment.file.name,
          );

    const attachmentEndpoint =
      conversationPlatform ===
        "telegram"
        ? attachment.kind ===
              "image" &&
            !isTelegramGifFile(
              attachment.file,
            )
          ? "/api/telegram/send-photo"
          : "/api/telegram/send-media"
        : "/api/facebook/send-attachment";

    const pending:
      PendingOptimisticAttachmentSend = {
        tempId,
        conversationId:
          activeConversation.id,
        recipientId:
          activeConversation.contact
            .platform_user_id,
        file: attachment.file,
        kind: attachment.kind,
        previewUrl,
        messageText,
        endpoint:
          attachmentEndpoint,
      };

    pendingAttachmentSendsRef
      .current[tempId] =
      pending;

    const optimisticMessage =
      createOptimisticAttachmentMessage({
        tempId,
        conversationId:
          activeConversation.id,
        recipientPlatformId:
          activeConversation.contact
            .platform_user_id,
        kind: attachment.kind,
        file: attachment.file,
        previewUrl,
        messageText,
      });

    setLiveMessages(
      (current) => [
        ...current,
        optimisticMessage,
      ],
    );

    updateConversationPreviewOptimistically({
      conversationId:
        activeConversation.id,
      message:
        messageText,
      createdAt:
        optimisticMessage.created_at,
    });

    const succeeded =
      await performOptimisticAttachmentSend(
        pending,
      );

    if (!succeeded) {
      allSucceeded = false;
    }
  }

  return allSucceeded;
}

async function handleRetryOptimisticMessage(
  tempId: string,
) {
  const attachmentPending =
    pendingAttachmentSendsRef
      .current[tempId];

  if (attachmentPending) {
    await performOptimisticAttachmentSend(
      attachmentPending,
    );
    return;
  }

  const pending =
    pendingSendsRef
      .current[
        tempId
      ];

  if (!pending) {
    return;
  }

  await performOptimisticSend(
    pending,
  );
}

async function handleSendMessage(
  event: FormEvent,
) {
  event.preventDefault();

  const message =
    reply.trim();

  if (
    !message ||
    !activeConversation ||
    !activeConversation.contact
  ) {
    return;
  }

  /*
   * V3.11.30.1 — a conversation can contain both normal Messenger DMs and
   * Facebook comments. Only an explicitly selected comment Reply target uses
   * the public comment reply endpoint. Otherwise the composer sends a normal
   * channel message.
   */
  const isCommentReply =
    Boolean(replyingToCommentId);

  const commentId =
    replyingToCommentId;

  let conversationPlatform:
    InboxConversationPlatform =
      "facebook";

  if (!isCommentReply) {
    try {
      conversationPlatform =
        await resolveConversationPlatform(
          activeConversation,
        );
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Unable to resolve this conversation channel.",
      );
      return;
    }
  }

  if (
    conversationPlatform ===
      "telegram" &&
    editingTelegramMessageId
  ) {
    setSending(true);
    setSendError(null);

    try {
      const response =
        await fetch(
          `/api/telegram/messages/${encodeURIComponent(
            editingTelegramMessageId,
          )}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              text: message,
            }),
          },
        );

      const responseText =
        await response.text();

      const result =
        responseText.trim()
          ? (
              JSON.parse(
                responseText,
              ) as {
                success?: boolean;
                error?: string;
                messageText?: string;
                editedAt?: string;
              }
            )
          : {};

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to edit Telegram message.",
        );
      }

      const editedMessageId =
        editingTelegramMessageId;

      setLiveMessages(
        (current) =>
          current.map(
            (liveMessage) =>
              liveMessage.id ===
              editedMessageId
                ? {
                    ...liveMessage,
                    message_text:
                      result.messageText ??
                      message,
                    raw_payload: {
                      ...(
                        liveMessage.raw_payload ??
                        {}
                      ),
                      tenh_edit: {
                        source: "tenh",
                        edited_at:
                          result.editedAt ??
                          new Date().toISOString(),
                      },
                    },
                  }
                : liveMessage,
          ),
      );

      setLiveConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id ===
              activeConversation.id
                ? {
                    ...conversation,
                    ...(
                      conversation.last_message_text ===
                      liveMessages.find(
                        (liveMessage) =>
                          liveMessage.id ===
                          editedMessageId,
                      )?.message_text
                        ? {
                            last_message_text:
                              result.messageText ??
                              message,
                          }
                        : {}
                    ),
                  }
                : conversation,
          ),
      );

      setReply("");
      setEditingTelegramMessageId(
        null,
      );
      showTelegramActionNotice(
        "Telegram message edited successfully",
      );
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Unable to edit Telegram message.",
      );
    } finally {
      setSending(false);
    }

    return;
  }

  const randomId =
    typeof crypto !==
      "undefined" &&
    typeof crypto.randomUUID ===
      "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  const tempId =
    `optimistic:${randomId}`;

  const telegramLocation =
    !isCommentReply &&
    conversationPlatform ===
      "telegram"
      ? parseTenhLocationMessage(
          message,
        )
      : null;

  if (
    conversationPlatform === "telegram" &&
    replyingToTelegramMessageId &&
    telegramLocation
  ) {
    setSendError(
      "Telegram Reply supports text only. Cancel Reply before sending a location.",
    );
    return;
  }

  const endpoint =
    isCommentReply
      ? "/api/facebook/comments/reply"
      : conversationPlatform ===
          "telegram"
        ? telegramLocation
          ? "/api/telegram/send-location"
          : "/api/telegram/send"
        : "/api/facebook/send";

  const requestBody:
    Record<string, unknown> =
    isCommentReply
      ? {
          conversationId:
            activeConversation.id,
          commentId,
          message,
        }
      : conversationPlatform ===
          "telegram"
        ? telegramLocation
          ? {
              conversationId:
                activeConversation.id,
              latitude:
                telegramLocation.latitude,
              longitude:
                telegramLocation.longitude,
              message,
            }
          : {
              conversationId:
                activeConversation.id,
              message,
              ...(replyingToTelegramMessageId
                ? {
                    replyToMessageId:
                      replyingToTelegramMessageId,
                  }
                : {}),
            }
        : {
            conversationId:
              activeConversation.id,
            recipientId:
              activeConversation
                .contact
                .platform_user_id,
            message,
          };

  const pending:
    PendingOptimisticSend = {
      tempId,
      conversationId:
        activeConversation.id,
      message,
      endpoint,
      requestBody,
      isCommentConversation:
        isCommentReply,
      commentId,
    };

  pendingSendsRef.current[
    tempId
  ] = pending;

  const optimisticMessage =
    createOptimisticMessage({
      tempId,
      conversationId:
        activeConversation.id,
      message,
      recipientPlatformId:
        activeConversation
          .contact
          .platform_user_id,
    });

  setLiveMessages(
    (current) => [
      ...current,
      optimisticMessage,
    ],
  );

  updateConversationPreviewOptimistically({
    conversationId:
      activeConversation.id,
    message,
    createdAt:
      optimisticMessage
        .created_at,
  });

  setReply("");
  setReplyingToCommentId(
    null,
  );
  setReplyingToTelegramMessageId(
    null,
  );
  setEditingTelegramMessageId(
    null,
  );
  setSendError(null);

  await performOptimisticSend(
    pending,
  );
}

  async function handleStatusChange(
    nextStatus: ConversationStatus,
  ) {
    if (
      !activeConversation ||
      updatingStatus ||
      nextStatus === activeConversation.status
    ) {
      return;
    }

    const conversationId = activeConversation.id;
    const previousStatus = activeConversation.status;

    statusOverrideRef.current.set(conversationId, {
      status: nextStatus,
      expiresAt: Date.now() + 8_000,
    });

    setUpdatingStatus(true);
    setStatusError(null);

    setLiveConversations((current) =>
      sortLiveConversations(
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                status: nextStatus,
              }
            : conversation,
        ),
      ),
    );

    try {
      const response = await fetch(
        `/api/conversations/${conversationId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: nextStatus,
          }),
        },
      );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          conversation?: {
            id: string;
            status: ConversationStatus;
          };
          activityRecorded?: boolean;
        };

      if (!response.ok || !result.success || !result.conversation) {
        throw new Error(
          result.error ??
            "Unable to update status.",
        );
      }

      const authoritativeStatus =
        result.conversation.status;

      statusOverrideRef.current.set(conversationId, {
        status: authoritativeStatus,
        expiresAt: Date.now() + 3_000,
      });

      setLiveConversations((current) =>
        sortLiveConversations(
          current.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  status: authoritativeStatus,
                }
              : conversation,
          ),
        ),
      );
    } catch (error) {
      const currentOverride =
        statusOverrideRef.current.get(conversationId);

      if (currentOverride?.status === nextStatus) {
        statusOverrideRef.current.delete(conversationId);

        setLiveConversations((current) =>
          sortLiveConversations(
            current.map((conversation) =>
              conversation.id === conversationId &&
              conversation.status === nextStatus
                ? {
                    ...conversation,
                    status: previousStatus,
                  }
                : conversation,
            ),
          ),
        );
      }

      setStatusError(
        error instanceof Error
          ? error.message
          : "Unable to update status.",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

async function handleAssignmentChange(
  assignedTo: string,
) {
  if (!activeConversation || assigning) {
    return;
  }

  const conversationId = activeConversation.id;
  const nextAssignedTo =
    assignedTo === "unassigned"
      ? null
      : assignedTo;

  if (
    nextAssignedTo ===
    activeConversation.assigned_to
  ) {
    return;
  }

  const previousAssignment = {
    assigned_to: activeConversation.assigned_to,
    assigned_at: activeConversation.assigned_at,
    assigned_member: activeConversation.assigned_member,
  };

  const optimisticMember = nextAssignedTo
    ? teamMembers.find((member) => member.id === nextAssignedTo) ?? null
    : null;

  assignmentOverrideRef.current.set(conversationId, {
    assignedTo: nextAssignedTo,
    expiresAt: Date.now() + 8_000,
  });

  setAssigning(true);
  setAssignmentError(null);

  setLiveConversations((current) =>
    sortLiveConversations(
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              assigned_to: nextAssignedTo,
              assigned_at: nextAssignedTo
                ? new Date().toISOString()
                : null,
              assigned_member: optimisticMember,
            }
          : conversation,
      ),
    ),
  );

  try {
    const response = await fetch(
      `/api/conversations/${conversationId}/assignment`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assignedTo: nextAssignedTo,
        }),
      },
    );

    const result =
      (await response.json()) as {
        success?: boolean;
        error?: string;
        conversation?: {
          id: string;
          assigned_to: string | null;
          assigned_at: string | null;
        };
      };

    if (!response.ok || !result.success) {
      throw new Error(
        result.error ??
          "Unable to assign the conversation.",
      );
    }

    if (result.conversation) {
      const authoritativeMember =
        result.conversation.assigned_to
          ? teamMembers.find(
              (member) =>
                member.id === result.conversation?.assigned_to,
            ) ?? null
          : null;

      assignmentOverrideRef.current.set(conversationId, {
        assignedTo: result.conversation.assigned_to,
        expiresAt: Date.now() + 3_000,
      });

      setLiveConversations((current) =>
        sortLiveConversations(
          current.map((conversation) =>
            conversation.id === result.conversation?.id
              ? {
                  ...conversation,
                  ...result.conversation,
                  assigned_member: authoritativeMember,
                }
              : conversation,
          ),
        ),
      );
    }
  } catch (error) {
    assignmentOverrideRef.current.delete(conversationId);

    setLiveConversations((current) =>
      sortLiveConversations(
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                ...previousAssignment,
              }
            : conversation,
        ),
      ),
    );

    setAssignmentError(
      error instanceof Error
        ? error.message
        : "Unable to assign the conversation.",
    );
  } finally {
    setAssigning(false);
  }
}

async function handleAssignToMe() {
  if (!activeConversation || assigning) {
    return;
  }

  if (activeConversation.assigned_to) {
    return;
  }

  const conversationId = activeConversation.id;

  setAssigning(true);
  setAssignmentError(null);

  try {
    const response = await fetch(
      `/api/conversations/${conversationId}/claim`,
      { method: "PATCH" },
    );

    const text = await response.text();
    const result = text.trim()
      ? (JSON.parse(text) as {
          success?: boolean;
          error?: string;
          conversation?: {
            id: string;
            assigned_to: string | null;
            assigned_at: string | null;
          };
        })
      : null;

    if (!response.ok || !result?.success || !result.conversation) {
      throw new Error(
        result?.error ??
          "Unable to assign this conversation to you.",
      );
    }

    const assignedMember =
      result.conversation.assigned_to
        ? teamMembers.find(
            (member) =>
              member.id === result.conversation?.assigned_to,
          ) ?? null
        : null;

    assignmentOverrideRef.current.set(conversationId, {
      assignedTo: result.conversation.assigned_to,
      expiresAt: Date.now() + 3_000,
    });

    setLiveConversations((current) =>
      sortLiveConversations(
        current.map((conversation) =>
          conversation.id === result.conversation?.id
            ? {
                ...conversation,
                ...result.conversation,
                assigned_member: assignedMember,
              }
            : conversation,
        ),
      ),
    );
  } catch (error) {
    assignmentOverrideRef.current.delete(conversationId);
    setAssignmentError(
      error instanceof Error
        ? error.message
        : "Unable to assign this conversation to you.",
    );
  } finally {
    setAssigning(false);
  }
}

return (
<div className="relative h-[calc(100vh-72px)] w-full overflow-hidden bg-white">
  {multiAgentToast ? (
    <div className="pointer-events-none absolute right-5 top-5 z-[90] w-[min(390px,calc(100%-2.5rem))]">
      <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
            {multiAgentToast.actorName
              ?.trim()
              .charAt(0)
              .toUpperCase() || "T"}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
              Team update
            </p>

            <p className="mt-1 text-sm font-medium leading-5 text-slate-800">
              {multiAgentToast.message}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setMultiAgentToast(null);

              if (
                multiAgentToastTimerRef.current
              ) {
                clearTimeout(
                  multiAgentToastTimerRef.current,
                );

                multiAgentToastTimerRef.current =
                  null;
              }
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Dismiss team update"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  ) : null}

    <div
      className={`grid h-full min-h-0 overflow-hidden ${
       customerPanelVisible
  ? "grid-cols-[500px_minmax(0,1fr)_340px]"
  : "grid-cols-[500px_minmax(0,1fr)]"
      }`}
    >
     <ConversationList
  conversations={liveConversations}
  activeConversationId={
    resolvedActiveConversationId
  }
        activeStatus={activeStatus}
        statusCounts={statusCounts}
        onSelectConversation={
          selectConversationSmoothly
        }
        onPrefetchConversation={
          prefetchConversation
        }
        onClearConversationSelection={
          clearConversationSelection
        }
      />

   <MessagePanel
  key={
    resolvedActiveConversationId ??
    "no-conversation"
  }
  activeConversation={
    activeConversation
  }
  messages={liveMessages}
  loadingConversationMessages={
    loadingConversationMessages
  }
  conversationMessagesError={
    conversationMessagesError
  }
  onRetryConversationMessages={
    retryConversationMessages
  }
  teamMembers={teamMembers}
  hasMoreOlderMessages={
    hasMoreOlderMessages
  }
  loadingOlderMessages={
    loadingOlderMessages
  }
  olderMessagesError={
    olderMessagesError
  }
  onLoadOlderMessages={
    handleLoadOlderMessages
  }
  viewingAgents={viewingAgents}
  typingAgents={typingAgents}
  teamPresence={teamPresence}
  agentPresenceStatus={agentPresenceStatus}
  reply={reply}
  sending={sending}
  sendError={sendError}
  updatingStatus={updatingStatus}
  statusError={statusError}
  assigning={assigning}
  assignmentError={assignmentError}
  markingUnread={markingUnread}
  customerPanelVisible={
    customerPanelVisible
  }

  onReplyChange={setReply}

  onContactTagsChange={handleContactTagsChange}

  onSendMessage={
    handleSendMessage
  }

  onSendAttachments={
    handleSendAttachments
  }

  onStatusChange={(status) =>
    void handleStatusChange(
      status,
    )
  }

  onAssignmentChange={(
    memberId,
  ) =>
    void handleAssignmentChange(
      memberId,
    )
  }

  onMarkUnread={() =>
    void handleMarkUnread()
  }

  onTogglePin={() =>
    void handleTogglePin()
  }

  onOpenHistory={() =>
    setHistoryOpen(true)
  }

  onToggleCustomerPanel={() =>
    setCustomerPanelVisible(
      (current) => !current,
    )
  }

  onLikeComment={
    handleLikeComment
  }

  onHideComment={
    handleHideComment
  }

  onReplyToComment={
    handleReplyToComment
  }

  replyingToCommentId={
    replyingToCommentId
  }

  replyingToTelegramMessageId={
    replyingToTelegramMessageId
  }

  editingTelegramMessageId={
    editingTelegramMessageId
  }

  telegramActionNotice={
    telegramActionNotice
  }

  onReplyToTelegramMessage={
    handleReplyToTelegramMessage
  }

  onEditTelegramMessage={
    handleEditTelegramMessage
  }

  onDeleteTelegramMessage={
    handleDeleteTelegramMessage
  }

  onCancelTelegramEdit={
    handleCancelTelegramEdit
  }

  onCancelTelegramReply={
    handleCancelTelegramReply
  }

  onCancelCommentReply={
    handleCancelCommentReply
  }

  onDeleteComment={
    handleDeleteComment
  }

  onRetryMessage={
    handleRetryOptimisticMessage
  }
/>
      {customerPanelVisible ? (
        <CustomerProfile
          activeConversation={
            customerProfileConversation
          }
          assigning={assigning}
          onAssignToMe={() => {
            void handleAssignToMe();
          }}
          onContactTagsChange={
            handleContactTagsChange
          }
        />
      ) : null}
    </div>


    {historyOpen && activeConversation?.contact ? (
      <CustomerTimelineModal
        contactId={activeConversation.contact.id}
        customerName={
          activeConversation.contact.full_name?.trim() ||
          "Customer"
        }
        onClose={() => setHistoryOpen(false)}
      />
    ) : null}


   {!customerPanelVisible && (
  <button
    type="button"
    onClick={() =>
      setCustomerPanelVisible(true)
    }
    className="absolute right-0 top-1/2 z-50 flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-slate-300 bg-white text-slate-500 shadow-lg transition hover:bg-blue-50 hover:text-blue-700"
    title="Show customer information"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <path
        d="m9 18 6-6-6-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>
)}


  </div>
);
}