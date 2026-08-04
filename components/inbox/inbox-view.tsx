"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { ConversationList } from "@/components/inbox/conversation-list";
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
            conversationId: activeConversation.id,
            recipientId:
              activeConversation.contact.platform_user_id,
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid min-h-[650px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <ConversationList
          conversations={conversations}
          activeConversationId={
            activeConversationId
          }
          activeStatus={activeStatus}
          statusCounts={statusCounts}
        />

        <MessagePanel
          activeConversation={activeConversation}
          messages={messages}
          teamMembers={teamMembers}
          reply={reply}
          sending={sending}
          sendError={sendError}
          updatingStatus={updatingStatus}
          statusError={statusError}
          assigning={assigning}
          assignmentError={assignmentError}
          onReplyChange={setReply}
          onSendMessage={handleSendMessage}
          onStatusChange={(status) =>
            void handleStatusChange(status)
          }
          onAssignmentChange={(assignedTo) =>
            void handleAssignmentChange(
              assignedTo,
            )
          }
        />
      </div>
    </div>
  );
}
