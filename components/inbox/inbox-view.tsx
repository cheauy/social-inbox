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

import {
  useInboxRealtime,
} from "@/lib/inbox/use-inbox-realtime";

import type {
  ConversationStatus,
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
  searchParams.get("conversationId");
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

  const pendingSendsRef =
    useRef<
      Record<
        string,
        PendingOptimisticSend
      >
    >({});

  

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
        !conversationId ||
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
              const optimisticId =
                current[
                  optimisticIndex
                ].id;

              delete pendingSendsRef
                .current[
                  optimisticId
                ];

              return [
                ...current.filter(
                  (
                    _message,
                    index,
                  ) =>
                    index !==
                    optimisticIndex,
                ),
                row as unknown as typeof current[number],
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
            (message) =>
              message.id ===
              messageId
                ? ({
                    ...message,
                    ...row,
                  } as unknown as typeof message)
                : message,
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

          const next =
            current.map(
              (conversation) =>
                conversation.id ===
                conversationId
                  ? ({
                      ...conversation,
                      ...row,
                    } as unknown as typeof conversation)
                  : conversation,
            );

          /*
           * Keep pinned items stable and otherwise move the
           * most recently active conversations toward the top.
           */
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

async function handleRetryOptimisticMessage(
  tempId: string,
) {
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