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

import type { ConversationStatus } from "@/types/inbox";




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

  

 const resolvedActiveConversationId =
  useMemo(() => {
    if (
      requestedConversationId &&
      conversations.some(
        (conversation) =>
          conversation.id ===
          requestedConversationId,
      )
    ) {
      return requestedConversationId;
    }

    if (
      activeConversationId &&
      conversations.some(
        (conversation) =>
          conversation.id ===
          activeConversationId,
      )
    ) {
      return activeConversationId;
    }

    return (
      conversations[0]?.id ??
      null
    );
  }, [
    conversations,
    requestedConversationId,
    activeConversationId,
  ]);

const activeConversation =
  useMemo(
    () =>
      conversations.find(
        (conversation) =>
          conversation.id ===
          resolvedActiveConversationId,
      ) ?? null,
    [
      conversations,
      resolvedActiveConversationId,
    ],
  );
  

useEffect(() => {
  if (
    requestedConversationId &&
    !conversations.some(
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
  conversations,
  requestedConversationId,
  router,
]);

useEffect(() => {
  if (!resolvedActiveConversationId) {
    return;
  }

  const activeConversation =
    conversations.find(
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

      router.refresh();
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
  conversations,
  resolvedActiveConversationId,
  router,
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

  async function handleSendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const message = reply.trim();

    if (
      !message ||
      !activeConversation ||
      !activeConversation.contact
    ) {
      return;
    }

    setSending(true);
    setSendError(null);

try {
  const isCommentConversation =
    activeConversation.source_type ===
    "comment";

  const endpoint =
    isCommentConversation
      ? "/api/facebook/comments/reply"
      : "/api/facebook/send";

  const requestBody =
    isCommentConversation
      ? {
          conversationId:
            activeConversation.id,

          commentId:
            activeConversation
              .facebook_comment_id,

          message,
        }
      : {
          conversationId:
            activeConversation.id,

          recipientId:
            activeConversation.contact
              .platform_user_id,

          message,
        };

  const response = await fetch(
    endpoint,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
      },

      body: JSON.stringify(
        requestBody,
      ),
    },
  );

  const responseText =
    await response.text();

let result: {
  success: boolean;
  error?: string;
};

if (responseText.trim()) {
  try {
    result = JSON.parse(
      responseText,
    ) as {
      success: boolean;
      error?: string;
    };
  } catch {
    result = {
      success: false,
      error:
        "The read API returned invalid JSON.",
    };
  }
} else {
  result = {
    success: response.ok,
    error: response.ok
      ? undefined
      : `The read API returned an empty response (${response.status}).`,
  };
}

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to send the message.",
        );
      }

      setReply("");
      router.refresh();
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Unable to send the message.",
      );
    } finally {
      setSending(false);
    }
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
  conversations={conversations}
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
  messages={messages}
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