"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import type {
  InboxConversation,
  InboxMessage,
} from "@/types/inbox";

type InboxViewProps = {
  conversations: InboxConversation[];
  activeConversationId: string | null;
  messages: InboxMessage[];
};

function getInitial(name: string | null) {
  if (!name) {
    return "?";
  }

  return name.trim().charAt(0).toUpperCase();
}

function formatMessageTime(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function InboxView({
  conversations,
  activeConversationId,
  messages,
}: InboxViewProps) {
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
        result.error ?? "Unable to send the message.",
      );
    }

    setReply("");

    /*
     * Reload the server component data so the newly saved
     * outgoing message appears in the conversation.
     */
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
    const router = useRouter();

const [reply, setReply] = useState("");
const [sending, setSending] = useState(false);
const [sendError, setSendError] = useState<string | null>(
  null,
);

  return (
    <div className="grid min-h-[650px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[360px_1fr]">
      <section className="border-r border-slate-200">
        <div className="border-b border-slate-200 p-4">
          <input
            type="search"
            placeholder="Search conversations..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          {conversations.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-medium text-slate-800">
                No conversations
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Facebook conversations will appear here.
              </p>
            </div>
          ) : (
            conversations.map((conversation) => {
              const customerName =
                conversation.contact?.full_name ??
                "Facebook customer";

              const isActive =
                conversation.id ===
                activeConversationId;

              return (
                <Link
                  key={conversation.id}
                  href={`/dashboard/inbox?conversation=${conversation.id}`}
                  className={`flex gap-3 border-b border-slate-100 p-4 transition ${
                    isActive
                      ? "bg-blue-50"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                    {getInitial(customerName)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-semibold text-slate-900">
                        {customerName}
                      </p>

                      <span className="shrink-0 text-xs text-slate-400">
                        {formatMessageTime(
                          conversation.last_message_at,
                        )}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-slate-500">
                        {conversation.last_message_text ??
                          "No messages"}
                      </p>

                      {conversation.unread_count > 0 ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
                          {conversation.unread_count}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>

      <section className="flex flex-col">
        {!activeConversation ? (
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
        ) : (
          <>
            <div className="border-b border-slate-200 p-4">
              <p className="font-semibold text-slate-900">
                {activeConversation.contact?.full_name ??
                  "Facebook customer"}
              </p>

              <p className="text-sm text-slate-500">
                Facebook Messenger ·{" "}
                {activeConversation.social_account
                  ?.account_name ?? "Facebook Page"}
              </p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-6">
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
                      className={`max-w-md rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        isOutgoing
                          ? "rounded-br-md bg-blue-600 text-white"
                          : "rounded-bl-md bg-white text-slate-800"
                      }`}
                    >
                      <p>
                        {message.message_text ??
                          "Unsupported message"}
                      </p>

                      <p
                        className={`mt-1 text-xs ${
                          isOutgoing
                            ? "text-blue-100"
                            : "text-slate-400"
                        }`}
                      >
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

            <div className="border-t border-slate-200 bg-white p-4">
             <form
  onSubmit={handleSendMessage}
  className="flex gap-3"
>
  <input
    type="text"
    name="message"
    value={reply}
    onChange={(event) =>
      setReply(event.target.value)
    }
    placeholder="Write a reply..."
    disabled={sending}
    autoComplete="off"
    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
  />

  <button
    type="submit"
    disabled={sending || !reply.trim()}
    className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
  >
    {sending ? "Sending..." : "Send"}
  </button>
</form>

{sendError ? (
  <p className="mt-2 text-sm text-red-600">
    {sendError}
  </p>
) : (
  <p className="mt-2 text-xs text-slate-400">
    Replies are sent through the Apex Clothing
    Facebook Page.
  </p>
)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

