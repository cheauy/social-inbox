"use client";

import type { FormEvent } from "react";
import { ConversationHeader } from "@/components/inbox/conversation-header";
import {
  formatMessageTime,
} from "@/components/inbox/inbox-utils";

import { ReplyBox } from "@/components/inbox/reply-box";

import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  TeamMember,
} from "@/types/inbox";

type MessagePanelProps = {
  activeConversation: InboxConversation | null;
  messages: InboxMessage[];
  teamMembers: TeamMember[];
  reply: string;
  sending: boolean;
  sendError: string | null;
  updatingStatus: boolean;
  statusError: string | null;
  assigning: boolean;
  assignmentError: string | null;
  markingUnread: boolean;
  customerPanelVisible: boolean;

  onMarkUnread: () => void;
  onOpenHistory: () => void;
  onToggleCustomerPanel: () => void;
  onReplyChange: (value: string) => void;
  onSendMessage: (
    event: FormEvent<HTMLFormElement>,
  ) => void;
  onStatusChange: (
    status: ConversationStatus,
  ) => void;
  onAssignmentChange: (
    assignedTo: string,
  ) => void;
};

export function MessagePanel({
  activeConversation,
  messages,
  teamMembers,
  reply,
  sending,
  sendError,
  updatingStatus,
  statusError,
  assigning,
  assignmentError,
  markingUnread,
  customerPanelVisible,
  onMarkUnread,
  onOpenHistory,
  onToggleCustomerPanel,
  onReplyChange,
  onSendMessage,
  onStatusChange,
  onAssignmentChange,
}: MessagePanelProps) {
  if (!activeConversation) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center bg-slate-50 p-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl">
              💬
            </div>

            <p className="mt-4 font-semibold text-slate-900">
              Select a conversation
            </p>

            <p className="mt-1 text-sm text-slate-500">
              Choose a customer from the inbox.
            </p>
          </div>
        </div>
      </section>
    );
  }

 return (
  <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
   <ConversationHeader
  conversation={activeConversation}
  teamMembers={teamMembers}
  updatingStatus={updatingStatus}
  assigning={assigning}
  markingUnread={markingUnread}
  customerPanelVisible={
    customerPanelVisible
  }
  onStatusChange={onStatusChange}
  onAssignmentChange={
    onAssignmentChange
  }
  onMarkUnread={onMarkUnread}
  onOpenHistory={onOpenHistory}
  onToggleCustomerPanel={
    onToggleCustomerPanel
  }
/>
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
      {/* Customer name, status and assignment */}
    </div>

    <div
  className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6"
  style={{
    backgroundColor: "#EEF2F6",
    backgroundImage: "url('/images/chat-bg.png')",
    backgroundRepeat: "repeat",
    backgroundSize: "320px",
  }}
>
      <div className="space-y-4">
        {messages.map((message) => {
          const isOutgoing =
            message.direction === "outgoing";

          return (
            <div
              key={message.id}
              className={`flex ${
                isOutgoing
                  ? "justify-end"
                  : "justify-start"
              }`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                  isOutgoing
                    ? "rounded-br-md bg-green-100 text-slate-900"
                    : "rounded-bl-md bg-white text-slate-900"
                }`}
              >
                <p className="whitespace-pre-wrap">
                  {message.message_text ??
                    "Unsupported message"}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {formatMessageTime(
                    message.platform_created_at ??
                      message.created_at,
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>


    {activeConversation.contact ? (
  <div className="shrink-0">
    <ReplyBox
      reply={reply}
      sending={sending}
      error={sendError}
      contactId={
        activeConversation.contact.id
      }
      businessId={
        activeConversation.contact
          .business_id
      }
      initialTags={
        activeConversation.contact.tags ??
        []
      }
      onReplyChange={onReplyChange}
      onSubmit={onSendMessage}
    />
  </div>
) : null}
  </section>
);
}