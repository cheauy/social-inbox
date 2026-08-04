"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] =
    useState<string | null>(null);


  const [
  customerPanelVisible,
  setCustomerPanelVisible,
] = useState(true);

const [markingUnread, setMarkingUnread] =
  useState(false);

const [historyOpen, setHistoryOpen] =
  useState(false);


  const [updatingStatus, setUpdatingStatus] =
    useState(false);
  const [statusError, setStatusError] =
    useState<string | null>(null);

  const [assigning, setAssigning] =
    useState(false);
  const [assignmentError, setAssignmentError] =
    useState<string | null>(null);

  const activeConversation =
    conversations.find(
      (conversation) =>
        conversation.id === activeConversationId,
    ) ?? null;

  async function handleMarkUnread() {
  if (!activeConversation) {
    return;
  }

  setMarkingUnread(true);

  try {
    const response = await fetch(
      `/api/conversations/${activeConversation.id}/unread`,
      {
        method: "PATCH",
      },
    );

    const result =
      (await response.json()) as {
        success?: boolean;
        error?: string;
      };

    if (!response.ok || !result.success) {
      throw new Error(
        result.error ??
          "Unable to mark conversation as unread.",
      );
    }

    router.refresh();
  } catch (markError) {
    window.alert(
      markError instanceof Error
        ? markError.message
        : "Unable to mark conversation as unread.",
    );
  } finally {
    setMarkingUnread(false);
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
      const response = await fetch(
        "/api/facebook/send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId:
              activeConversation.id,

            recipientId:
              activeConversation.contact
                .platform_user_id,

            message,
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

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

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
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

    setAssigning(true);
    setAssignmentError(null);

    try {
      const response = await fetch(
        `/api/conversations/${activeConversation.id}/assignment`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            assignedTo:
              assignedTo === "unassigned"
                ? null
                : assignedTo,
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to assign the conversation.",
        );
      }

      router.refresh();
    } catch (error) {
      setAssignmentError(
        error instanceof Error
          ? error.message
          : "Unable to assign the conversation.",
      );
    } finally {
      setAssigning(false);
    }
  }

return (
 <div className="h-[calc(100vh-72px)] w-full overflow-hidden rounded-none border-0 bg-white">
    <div
      className={`grid h-full min-h-0 overflow-hidden ${
        customerPanelVisible
          ? "grid-cols-[340px_minmax(0,1fr)_340px]"
          : "grid-cols-[340px_minmax(0,1fr)]"
      }`}
    >
      <ConversationList
        conversations={conversations}
        activeConversationId={
          activeConversationId
        }
        activeStatus={activeStatus}
        statusCounts={statusCounts}
      />

      <MessagePanel
        activeConversation={
          activeConversation
        }
        messages={messages}
        teamMembers={teamMembers}
        reply={reply}
        sending={sending}
        sendError={sendError}
        updatingStatus={
          updatingStatus
        }
        statusError={statusError}
        assigning={assigning}
        assignmentError={
          assignmentError
        }
        markingUnread={
          markingUnread
        }
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

    {!customerPanelVisible ? (
      <button
        type="button"
        onClick={() =>
          setCustomerPanelVisible(true)
        }
        className="absolute right-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-slate-300 bg-white px-2 py-4 text-xs font-medium text-slate-600 shadow-lg hover:bg-slate-50"
        title="Show customer information"
        aria-label="Show customer information"
      >
        <span className="text-lg">
          ‹
        </span>

        <span className="[writing-mode:vertical-rl]">
          Customer
        </span>
      </button>
    ) : null}
  </div>
);
}