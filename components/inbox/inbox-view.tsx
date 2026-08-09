"use client";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";

import {
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
};

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
  if (
    typeof row.message_text ===
      "string" &&
    row.message_text.trim()
  ) {
    return row.message_text.trim();
  }

  const messageType =
    typeof row.message_type ===
    "string"
      ? row.message_type
      : "message";

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
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] =
    useState<string | null>(null);

  const [
  replyingToCommentId,
  setReplyingToCommentId,
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

const skipAutomaticReadRef =
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

  

 const resolvedActiveConversationId =
  useMemo(() => {
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

    if (
      activeConversationId &&
      liveConversations.some(
        (conversation) =>
          conversation.id ===
          activeConversationId,
      )
    ) {
      return activeConversationId;
    }

    return (
      liveConversations[0]?.id ??
      null
    );
  }, [
    liveConversations,
    requestedConversationId,
    activeConversationId,
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

async function markConversationReadRealtime(
  conversationId: string,
) {
  if (
    readInFlightRef.current.has(
      conversationId,
    )
  ) {
    return;
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

useInboxRealtime({
  businessId:
    realtimeBusinessId,

  onRealtimeEvent: (
    event,
  ) => {
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
                      isActiveIncoming
                        ? 0
                        : Math.max(
                            0,
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
       * Only the active thread needs its message array updated.
       * Inactive threads are represented by the conversation
       * preview + unread badge until the user opens them.
       */
      if (
        conversationId !==
        resolvedActiveConversationId
      ) {
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
            rowUnreadCount !== null &&
            rowUnreadCount > 0;

          const normalizedRow =
            shouldAcknowledgeRead
              ? {
                  ...row,
                  unread_count: 0,
                }
              : row;

          const next =
            current.map(
              (conversation) =>
                conversation.id ===
                conversationId
                  ? ({
                      ...conversation,
                      ...normalizedRow,
                    } as unknown as typeof conversation)
                  : conversation,
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
  setLiveConversations(
    conversations,
  );
}, [conversations]);

useEffect(() => {
  setLiveMessages(
    messages,
  );
}, [
  messages,
  resolvedActiveConversationId,
]);

useEffect(() => {
  if (
    requestedConversationId &&
    !liveConversations.some(
      (conversation) =>
        conversation.id ===
        requestedConversationId,
    )
  ) {
    router.replace(
      "/dashboard/inbox",
    );
  }
}, [
  liveConversations,
  requestedConversationId,
  router,
]);

useEffect(() => {
  if (!resolvedActiveConversationId) {
    return;
  }

  const activeConversation =
    liveConversations.find(
      (conversation) =>
        conversation.id ===
        resolvedActiveConversationId,
    );

  if (
    !activeConversation ||
    activeConversation.unread_count === 0
  ) {
    return;
  }

  if (
  skipAutomaticReadRef.current ===
  resolvedActiveConversationId
) {
  skipAutomaticReadRef.current =
    null;

  return;
}

  let cancelled = false;

  



async function markConversationRead() {
    try {
      const response = await fetch(
        `/api/conversations/${resolvedActiveConversationId}/read`,
        {
          method: "PATCH",
        },
      );

      const responseText =
        await response.text();

      const result = responseText
        ? (JSON.parse(responseText) as {
            success: boolean;
            error?: string;
          })
        : {
            success: response.ok,
          };

      if (
        cancelled ||
        !response.ok ||
        !result.success
      ) {
        return;
      }

      setLiveConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id ===
              resolvedActiveConversationId
                ? {
                    ...conversation,
                    unread_count: 0,
                  }
                : conversation,
          ),
      );
    } catch (error) {
      if (!cancelled) {
        console.error(error);
      }
    }
  }

  void markConversationRead();

  return () => {
    cancelled = true;
  };
}, [
  liveConversations,
  resolvedActiveConversationId,
]);

  async function handleMarkUnread() {
  if (!activeConversation) {
    return;
  }
skipAutomaticReadRef.current =
  activeConversation.id;
  setMarkingUnread(true);

  try {
    const response = await fetch(
      `/api/conversations/${activeConversation.id}/unread`,
      {
        method: "PATCH",
      },
    );

   const responseText =
      await response.text();

    const result = responseText
      ? (JSON.parse(responseText) as {
          success: boolean;
          error?: string;
        })
      : {
          success: response.ok,
        };

   if (
      !response.ok ||
      !result.success
    ) {
      skipAutomaticReadRef.current =
        null;

      throw new Error(
        result.error ??
          "Unable to mark conversation unread.",
      );
    }

    router.refresh();
  } catch (error) {
    skipAutomaticReadRef.current =
      null;

    console.error(error);
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

    router.refresh();
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
    formData.set(
      "recipientId",
      pending.recipientId,
    );
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
        "/api/facebook/send-attachment",
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
  if (
    !activeConversation ||
    !activeConversation.contact
  ) {
    return false;
  }

  if (
    activeConversation.source_type ===
    "comment"
  ) {
    setSendError(
      "Attachments are currently available for Messenger conversations only.",
    );
    return false;
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
      getAttachmentMessageText(
        attachment.kind,
        attachment.file.name,
      );

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

  const isCommentConversation =
    activeConversation.source_type ===
    "comment";

  const commentId =
    isCommentConversation
      ? replyingToCommentId
      : null;

  if (
    isCommentConversation &&
    !commentId
  ) {
    setSendError(
      "Select a Facebook comment and click Reply first.",
    );

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

  const endpoint =
    isCommentConversation
      ? "/api/facebook/comments/reply"
      : "/api/facebook/send";

  const requestBody:
    Record<string, unknown> =
    isCommentConversation
      ? {
          conversationId:
            activeConversation.id,
          commentId,
          message,
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
      isCommentConversation,
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

      

      router.refresh();
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

    router.refresh();
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
<div className="relative h-[calc(100vh-72px)] w-full overflow-hidden bg-white">    <div
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
      />

   <MessagePanel
  key={
    activeConversation?.id ??
    "no-conversation"
  }
  activeConversation={
    activeConversation
  }
  messages={liveMessages}
  teamMembers={teamMembers}
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
            activeConversation
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