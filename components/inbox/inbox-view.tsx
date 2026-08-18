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
  InboxConversation,
  InboxMessage,
} from "@/types/inbox";





const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_CACHE_MAX_CONVERSATIONS = 25;
const MESSAGE_CACHE_STALE_MS = 15_000;
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
}: InboxViewProps) {

  const router = useRouter();
  const searchParams =
  useSearchParams();

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
   * Prevent multiple read PATCH requests for the same
   * active conversation while realtime events arrive.
   */
  const readInFlightRef =
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

const realtimeBusinessId =
  useMemo(
    () =>
      activeConversation
        ?.contact
        ?.business_id ??
      liveConversations.find(
        (conversation) =>
          Boolean(
            conversation.contact
              ?.business_id,
          ),
      )?.contact
        ?.business_id ??
      null,
    [
      activeConversation,
      liveConversations,
    ],
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
  status: agentPresenceStatus,
} = useAgentPresence({
  businessId:
    realtimeBusinessId,
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

useInboxRealtime({
  businessId:
    realtimeBusinessId,

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

          const rowUnreadCount =
            typeof row.unread_count ===
            "number"
              ? row.unread_count
              : null;

          const isActiveConversation =
            conversationId ===
            resolvedActiveConversationId;

          /*
           * The webhook correctly increments unread_count first.
           * If the agent is already viewing this conversation,
           * never flash that unread badge locally. We immediately
           * acknowledge it as read after the authoritative
           * conversation UPDATE arrives.
           */
          const shouldAcknowledgeRead =
            isActiveConversation &&
            !manualUnreadConversationIdsRef.current.has(
              conversationId,
            ) &&
            rowUnreadCount !== null &&
            rowUnreadCount > 0;

          const normalizedRow =
            shouldAcknowledgeRead
              ? {
                  ...row,
                  unread_count: 0,
                }
              : row;

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

                const merged = {
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

      const rowUnreadCount =
        typeof row.unread_count ===
        "number"
          ? row.unread_count
          : null;

      if (
        conversationId ===
          resolvedActiveConversationId &&
        !manualUnreadConversationIdsRef.current.has(
          conversationId,
        ) &&
        rowUnreadCount !== null &&
        rowUnreadCount > 0
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
      desiredConversationIdRef.current ??
      clientSelectedConversationId;

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
  clientSelectedConversationId,
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
    (
      conversationId: string,
      updateHistory = false,
    ) => {
      if (
        !liveConversations.some(
          (conversation) =>
            conversation.id ===
            conversationId,
        )
      ) {
        return;
      }

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
         * Show warm cache immediately, then quietly refresh stale data.
         * No loading flash is shown for a conversation the agent has opened.
         */
        if (
          Date.now() -
            cached.fetchedAt >
          MESSAGE_CACHE_STALE_MS
        ) {
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
        }
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
      setMarkingUnread(false);
    }
  }

async function handleTogglePin() {
  if (
    !activeConversation ||
    pinning
  ) {
    return;
  }

  const nextPinned =
    !activeConversation.is_pinned;

  setPinning(true);
  setPinError(null);

  try {
    const response = await fetch(
      `/api/conversations/${activeConversation.id}/pin`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          isPinned: nextPinned,
        }),
      },
    );

    const responseText =
      await response.text();

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
        result = JSON.parse(
          responseText,
        ) as {
          success: boolean;
          error?: string;

          conversation?: {
            id: string;
            is_pinned: boolean;
            pinned_at:
              | string
              | null;
            pinned_by:
              | string
              | null;
          };
        };
      } catch {
        throw new Error(
          "Pin API returned invalid JSON.",
        );
      }
    } else {
      result = {
        success: response.ok,
        error: response.ok
          ? undefined
          : `Pin API returned an empty response (${response.status}).`,
      };
    }

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to update conversation pin.",
      );
    }

    if (
      result.conversation
    ) {
      setLiveConversations(
        (current) =>
          sortLiveConversations(
            current.map(
              (conversation) =>
                conversation.id ===
                result.conversation?.id
                  ? {
                      ...conversation,
                      ...result.conversation,
                    }
                  : conversation,
            ),
          ),
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to update conversation pin.";

    setPinError(message);

    console.error(
      "Unable to update conversation pin:",
      error,
    );
  } finally {
    setPinning(false);
  }
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
      realtimeBusinessId ??
      "",
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
      realtimeBusinessId ??
      "",
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
      nextStatus === activeConversation.status
    ) {
      return;
    }

    setUpdatingStatus(true);
    setStatusError(null);

    try {
      const response = await fetch(
        `/api/conversations/${activeConversation.id}/status`,
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

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to update status.",
        );
      }

      

      if (
        result.conversation
      ) {
        setLiveConversations(
          (current) =>
            sortLiveConversations(
              current.map(
                (conversation) =>
                  conversation.id ===
                  result.conversation?.id
                    ? {
                        ...conversation,
                        ...result.conversation,
                      }
                    : conversation,
              ),
            ),
        );
      }
    } catch (error) {
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
  if (!activeConversation) {
    return;
  }

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

  setAssigning(true);
  setAssignmentError(null);

  try {
    const response = await fetch(
      `/api/conversations/${activeConversation.id}/assignment`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
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
          assigned_to:
            | string
            | null;
          assigned_at:
            | string
            | null;
        };

        activityRecorded?: boolean;
      };

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to assign the conversation.",
      );
    }

    if (
      result.conversation
    ) {
      setLiveConversations(
        (current) =>
          sortLiveConversations(
            current.map(
              (conversation) =>
                conversation.id ===
                result.conversation?.id
                  ? {
                      ...conversation,
                      ...result.conversation,
                    }
                  : conversation,
            ),
          ),
      );
    }
  } catch (assignmentError) {
    setAssignmentError(
      assignmentError instanceof Error
        ? assignmentError.message
        : "Unable to assign the conversation.",
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
        />
      ) : null}
    </div>

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