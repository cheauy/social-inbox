"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  ConversationHeader,
} from "@/components/inbox/conversation-header";

import {
  formatMessageTime,
} from "@/components/inbox/inbox-utils";

import {
  ReplyBox,
} from "@/components/inbox/reply-box";

import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  TeamMember,
} from "@/types/inbox";

type MessagePanelProps = {
  activeConversation:
    | InboxConversation
    | null;

  messages: InboxMessage[];

  teamMembers: TeamMember[];

  reply: string;

  sending: boolean;

  sendError:
    | string
    | null;

  updatingStatus: boolean;

  statusError:
    | string
    | null;

  assigning: boolean;

  assignmentError:
    | string
    | null;

  markingUnread: boolean;

  customerPanelVisible: boolean;

  onMarkUnread: () => void;

  onOpenHistory: () => void;

  onToggleCustomerPanel:
    () => void;

  onReplyChange: (
    value: string,
  ) => void;

  onSendMessage: (
    event: FormEvent,
  ) => void;

  onStatusChange: (
    status: ConversationStatus,
  ) => void;

  onAssignmentChange: (
    assignedTo: string,
  ) => void;

  onTogglePin: () => void;

  /*
   * NEW
   * Facebook comment actions
   */
  onLikeComment: (
    commentId: string,
    liked: boolean,
  ) => Promise<{
    success: boolean;
    deleted?: boolean;
  }>;

  onHideComment: (
    commentId: string,
    hidden: boolean,
  ) => Promise<{
    success: boolean;
    deleted?: boolean;
  }>;

  onReplyToComment: (
    commentId: string,
  ) => void;

  replyingToCommentId:
    | string
    | null;

  onCancelCommentReply:
    () => void;

  onDeleteComment: (
    commentId: string,
  ) => Promise<{
    success: boolean;
    deleted?: boolean;
  }>;

  onRetryMessage?: (
    messageId: string,
  ) => void;
};

function LikeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M7 10v10H4V10h3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M9 20h7.5a2 2 0 0 0 1.94-1.52l1.5-6A2 2 0 0 0 18 10h-4l.5-3A2.5 2.5 0 0 0 12 4.5L9 10v10Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HideIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M3 3l18 18"
        strokeLinecap="round"
      />

      <path
        d="M10.7 10.7a2 2 0 0 0 2.6 2.6"
        strokeLinecap="round"
      />

      <path
        d="M9.9 4.2A10.2 10.2 0 0 1 12 4c5 0 9 5 9 8a7.6 7.6 0 0 1-2 3.8"
        strokeLinecap="round"
      />

      <path
        d="M6.2 6.3C4.2 7.7 3 10 3 12c0 3 4 8 9 8a9.5 9.5 0 0 0 3.1-.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ActionTooltip({
  label,
}: {
  label: string;
}) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover/action:opacity-100">
      {label}
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-950" />
    </span>
  );
}

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
  onTogglePin,

  onReplyChange,
  onSendMessage,
  onStatusChange,
  onAssignmentChange,

  onLikeComment,
  onHideComment,
  onReplyToComment,
  replyingToCommentId,
  onCancelCommentReply,
  onDeleteComment,
  onRetryMessage,
}: MessagePanelProps) {
  const [
    optimisticCommentState,
    setOptimisticCommentState,
  ] = useState<
    Record<
      string,
      {
        liked: boolean;
        hidden: boolean;
        deleted: boolean;
        deletedBy:
          | "customer"
          | "page"
          | null;
      }
    >
  >({});

  const [actionNotice, setActionNotice] =
    useState<string | null>(null);

  function showActionNotice(message: string) {
    setActionNotice(message);

    window.setTimeout(() => {
      setActionNotice(null);
    }, 1800);
  }

  useEffect(() => {
    const nextState: Record<
      string,
      {
        liked: boolean;
        hidden: boolean;
        deleted: boolean;
        deletedBy:
          | "customer"
          | "page"
          | null;
      }
    > = {};

    for (const message of messages) {
      nextState[message.id] = {
        liked:
          message.comment_is_liked ??
          false,

        hidden:
          message.comment_is_hidden ??
          false,

        deleted:
          message.comment_is_deleted ??
          false,

        deletedBy:
          message.comment_deleted_by ??
          null,
      };
    }

    setOptimisticCommentState(
      nextState,
    );
  }, [messages]);

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

  const isCommentConversation =
    activeConversation.source_type ===
    "comment";

  const replyingToMessage =
    replyingToCommentId
      ? messages.find(
          (message) =>
            message.platform_message_id ===
            replyingToCommentId,
        ) ?? null
      : null;

  const replyingToName =
    activeConversation.contact
      ?.full_name?.trim() ||
    "Facebook commenter";

  /*
   * Comment conversations must target one exact
   * Facebook comment before the reply composer is enabled.
   *
   * Messenger conversations remain available normally.
   */
  const commentReplyLocked =
    isCommentConversation &&
    !replyingToCommentId;

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">

      {actionNotice ? (
        <div className="pointer-events-none absolute left-1/2 top-16 z-[100] -translate-x-1/2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-xl">
          {actionNotice}
        </div>
      ) : null}

      {/* Existing header */}
      <ConversationHeader
        conversation={
          activeConversation
        }
        teamMembers={
          teamMembers
        }
        updatingStatus={
          updatingStatus
        }
        assigning={
          assigning
        }
        markingUnread={
          markingUnread
        }
        customerPanelVisible={
          customerPanelVisible
        }
        onStatusChange={
          onStatusChange
        }
        onAssignmentChange={
          onAssignmentChange
        }
        onMarkUnread={
          onMarkUnread
        }
        onOpenHistory={
          onOpenHistory
        }
        onToggleCustomerPanel={
          onToggleCustomerPanel
        }
        onTogglePin={
          onTogglePin
        }
      />

      {statusError ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {statusError}
        </div>
      ) : null}

      {assignmentError ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {assignmentError}
        </div>
      ) : null}

      {/* Messages */}
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6"
        style={{
          backgroundColor:
            "#EEF2F6",

          backgroundImage:
            "url('/images/chat-bg.png')",

          backgroundRepeat:
            "repeat",

          backgroundSize:
            "320px",
        }}
      >
        <div className="space-y-4">
          {messages.map(
            (message) => {
              const isOutgoing =
                message.direction ===
                "outgoing";

              const messageStatus =
                message as InboxMessage & {
                  __optimistic_status?:
                    | "sending"
                    | "sent"
                    | "failed";

                  delivery_status?:
                    | "sent"
                    | "delivered"
                    | "seen"
                    | null;

                  delivered_at?:
                    | string
                    | null;

                  seen_at?:
                    | string
                    | null;
                };

              const optimisticStatus =
                messageStatus
                  .__optimistic_status ??
                null;

              const persistedDeliveryStatus =
                messageStatus
                  .delivery_status ??
                "sent";

              const rawPayload =
                message.raw_payload as {
                  post_id?: string;
                  comment_id?: string;
                  parent_id?: string;

                  post_preview?: {
                    id?: string;
                    message?: string | null;
                    full_picture?: string | null;
                    permalink_url?: string | null;
                    created_time?: string | null;
                  } | null;
                } | null;

              const postId =
                rawPayload?.post_id;

              const postPreview =
                rawPayload?.post_preview ??
                null;

              const postUrl =
                postPreview
                  ?.permalink_url ??
                (postId
                  ? `https://facebook.com/${postId}`
                  : null);

              const serverState = {
                liked:
                  message.comment_is_liked ??
                  false,

                hidden:
                  message.comment_is_hidden ??
                  false,

                deleted:
                  message.comment_is_deleted ??
                  false,

                deletedBy:
                  message.comment_deleted_by ??
                  null,
              };

              const commentState =
                optimisticCommentState[
                  message.id
                ] ??
                serverState;

              const showCommentActions =
                isCommentConversation &&
                !isOutgoing &&
                Boolean(
                  message.platform_message_id,
                );

              const isReplyTarget =
                replyingToCommentId ===
                message.platform_message_id;

              async function toggleLike() {
                const previous =
                  commentState.liked;

                const next =
                  !previous;

                setOptimisticCommentState(
                  (current) => ({
                    ...current,

                    [message.id]: {
                      ...commentState,
                      liked: next,
                    },
                  }),
                );

                const result =
                  await onLikeComment(
                    message.platform_message_id,
                    next,
                  );

                if (result.deleted) {
                  setOptimisticCommentState(
                    (current) => ({
                      ...current,

                      [message.id]: {
                        ...commentState,
                        liked: false,
                        hidden: false,
                        deleted: true,
                        deletedBy:
                          "customer",
                      },
                    }),
                  );

                  showActionNotice(
                    "Comment is deleted by commenter",
                  );

                  return;
                }

                if (!result.success) {
                  setOptimisticCommentState(
                    (current) => ({
                      ...current,

                      [message.id]: {
                        ...commentState,
                        liked:
                          previous,
                      },
                    }),
                  );

                  return;
                }

                showActionNotice(
                  next
                    ? "Comment liked"
                    : "Comment unliked",
                );
              }

              async function toggleHide() {
                const previous =
                  commentState.hidden;

                const next =
                  !previous;

                setOptimisticCommentState(
                  (current) => ({
                    ...current,

                    [message.id]: {
                      ...commentState,
                      hidden: next,
                    },
                  }),
                );

                const result =
                  await onHideComment(
                    message.platform_message_id,
                    next,
                  );

                if (result.deleted) {
                  setOptimisticCommentState(
                    (current) => ({
                      ...current,

                      [message.id]: {
                        ...commentState,
                        liked: false,
                        hidden: false,
                        deleted: true,
                        deletedBy:
                          "customer",
                      },
                    }),
                  );

                  showActionNotice(
                    "Comment is deleted by commenter",
                  );

                  return;
                }

                if (!result.success) {
                  setOptimisticCommentState(
                    (current) => ({
                      ...current,

                      [message.id]: {
                        ...commentState,
                        hidden:
                          previous,
                      },
                    }),
                  );

                  return;
                }

                showActionNotice(
                  next
                    ? "Comment hidden"
                    : "Comment unhidden",
                );
              }

              async function deleteComment() {
                const previous =
                  commentState;

                /*
                 * Show deleted state immediately.
                 * If the user cancels or Meta fails,
                 * restore the previous state.
                 */
                setOptimisticCommentState(
                  (current) => ({
                    ...current,

                    [message.id]: {
                      ...commentState,
                      deleted: true,
                      deletedBy: "page",
                    },
                  }),
                );

                const result =
                  await onDeleteComment(
                    message.platform_message_id,
                  );

                if (result.deleted) {
                  setOptimisticCommentState(
                    (current) => ({
                      ...current,

                      [message.id]: {
                        ...commentState,
                        liked: false,
                        hidden: false,
                        deleted: true,
                        deletedBy:
                          "customer",
                      },
                    }),
                  );

                  showActionNotice(
                    "Comment is deleted by commenter",
                  );

                  return;
                }

                if (!result.success) {
                  setOptimisticCommentState(
                    (current) => ({
                      ...current,

                      [message.id]:
                        previous,
                    }),
                  );

                  return;
                }

                showActionNotice(
                  "Comment deleted successfully",
                );
              }

              return (
                <div
                  key={message.id}
                  className={`flex ${
                    isOutgoing
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  <div className="group max-w-[75%]">
                    <div
                      className={`overflow-hidden rounded-2xl text-sm shadow-sm transition ${
                        isOutgoing
                          ? "rounded-br-md bg-green-100 text-slate-900"
                          : "rounded-bl-md bg-white text-slate-900"
                      } ${
                        isReplyTarget
                          ? "ring-2 ring-blue-400 ring-offset-2"
                          : ""
                      }`}
                    >
                      {/* Message content */}
                      <div className="px-4 pb-2 pt-3">
                        {commentState.deleted ? (
                          <div className="flex items-center gap-2 py-1 text-sm italic text-slate-400">
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              className="h-4 w-4 shrink-0"
                              aria-hidden="true"
                            >
                              <path
                                d="M4 7h16"
                                strokeLinecap="round"
                              />
                              <path
                                d="M9 7V4h6v3"
                                strokeLinecap="round"
                              />
                              <path
                                d="M6 7l1 13h10l1-13"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>

                            <span>
                              {commentState.deletedBy ===
                              "customer"
                                ? "Comment is deleted by commenter"
                                : "Comment deleted by Page"}
                            </span>
                          </div>
                        ) : postId ? (
                          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                            {/* Facebook post preview */}
                            {postPreview ? (
                              <div className="bg-slate-50">
                                {postPreview.full_picture ? (
                                  <a
                                    href={
                                      postUrl ??
                                      undefined
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block"
                                  >
                                    <img
                                      src={
                                        postPreview.full_picture
                                      }
                                      alt="Facebook post"
                                      className="max-h-56 w-full object-cover"
                                      loading="lazy"
                                    />
                                  </a>
                                ) : null}

                                {postPreview.message ? (
                                  <div className="px-3 py-2.5">
                                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                      Facebook Post
                                    </div>

                                    <p className="whitespace-pre-wrap text-sm leading-5 text-slate-700">
                                      {
                                        postPreview.message
                                      }
                                    </p>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            {/* Customer comment */}
                            <div className="border-t border-slate-100 px-3 py-2.5">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">
                                Facebook Comment
                              </div>

                              <div className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-900">
                                {message.message_text ??
                                  "Facebook comment"}
                              </div>

                              {postUrl ? (
                                <a
                                  href={
                                    postUrl
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                                >
                                  View Post
                                  <span
                                    aria-hidden="true"
                                  >
                                    ↗
                                  </span>
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          /*
                           * Important:
                           * outgoing Facebook comment replies do not
                           * necessarily have post_id in raw_payload.
                           * Always render their message text here.
                           */
                          <p className="whitespace-pre-wrap">
                            {message.message_text ??
                              "Unsupported message"}
                          </p>
                        )}

                        <div
                          className={`mt-1 flex items-center gap-2 text-xs ${
                            isOutgoing
                              ? "justify-end"
                              : "justify-start"
                          }`}
                        >
                          <span className="text-slate-500">
                            {formatMessageTime(
                              message.platform_created_at ??
                                message.created_at,
                            )}
                          </span>

                          {isOutgoing ? (
                            optimisticStatus ===
                            "sending" ? (
                              <span className="inline-flex items-center gap-1 text-slate-500">
                                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                                Sending...
                              </span>
                            ) : optimisticStatus ===
                              "failed" ? (
                              <>
                                <span className="font-medium text-red-600">
                                  Failed to send
                                </span>

                                {onRetryMessage ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onRetryMessage(
                                        message.id,
                                      )
                                    }
                                    className="font-semibold text-blue-600 hover:underline"
                                  >
                                    Retry
                                  </button>
                                ) : null}
                              </>
                            ) : persistedDeliveryStatus ===
                              "seen" ? (
                              <span
                                className="font-semibold text-blue-600"
                                title={
                                  messageStatus.seen_at
                                    ? `Seen ${formatMessageTime(
                                        messageStatus.seen_at,
                                      )}`
                                    : "Seen"
                                }
                              >
                                ✓✓ Seen
                              </span>
                            ) : persistedDeliveryStatus ===
                              "delivered" ? (
                              <span
                                className="font-medium text-emerald-600"
                                title={
                                  messageStatus.delivered_at
                                    ? `Delivered ${formatMessageTime(
                                        messageStatus.delivered_at,
                                      )}`
                                    : "Delivered"
                                }
                              >
                                ✓✓ Delivered
                              </span>
                            ) : (
                              <span className="font-medium text-emerald-600">
                                ✓ Sent
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>

                      {/* Facebook Comment Actions */}
                      {showCommentActions ? (
                        <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1.5">

                          {/* Like / Unlike */}
                          <div className="group/action relative">
                          <button
                            type="button"
                            disabled={
                              commentState.deleted
                            }
                            onClick={() =>
                              void toggleLike()
                            }
                            className={`flex h-7 w-7 items-center justify-center rounded-md transition active:scale-90 ${
                              commentState.liked
                                ? "bg-blue-50 text-blue-600"
                                : "text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                            } disabled:cursor-not-allowed disabled:opacity-30`}
                            title={
                              commentState.liked
                                ? "Unlike comment"
                                : "Like comment"
                            }
                            aria-label={
                              commentState.liked
                                ? "Unlike comment"
                                : "Like comment"
                            }
                          >
                            <LikeIcon />
                          </button>
                          <ActionTooltip
                            label={
                              commentState.liked
                                ? "Unlike"
                                : "Like"
                            }
                          />
                          </div>

                          {/* Reply */}
                          <div className="group/action relative">
                          <button
                            type="button"
                            disabled={
                              commentState.deleted
                            }
                            onClick={() =>
                              onReplyToComment(
                                message.platform_message_id,
                              )
                            }
                            className={`flex h-7 w-7 items-center justify-center rounded-md transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 ${
                              isReplyTarget
                                ? "bg-blue-50 text-blue-600"
                                : "text-slate-400 hover:bg-blue-50 hover:text-blue-600"
                            }`}
                            title={
                              isReplyTarget
                                ? "Reply target selected"
                                : "Reply to comment"
                            }
                            aria-label={
                              isReplyTarget
                                ? "Reply target selected"
                                : "Reply to comment"
                            }
                          >
                            <ReplyIcon />
                          </button>
                          <ActionTooltip
                            label={
                              isReplyTarget
                                ? "Selected"
                                : "Reply"
                            }
                          />
                          </div>

                          {/* Hide / Unhide */}
                          <div className="group/action relative">
                          <button
                            type="button"
                            disabled={
                              commentState.deleted
                            }
                            onClick={() =>
                              void toggleHide()
                            }
                            className={`flex h-7 w-7 items-center justify-center rounded-md transition active:scale-90 ${
                              commentState.hidden
                                ? "bg-amber-50 text-amber-600"
                                : "text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                            } disabled:cursor-not-allowed disabled:opacity-30`}
                            title={
                              commentState.hidden
                                ? "Unhide comment"
                                : "Hide comment"
                            }
                            aria-label={
                              commentState.hidden
                                ? "Unhide comment"
                                : "Hide comment"
                            }
                          >
                            <HideIcon />
                          </button>
                          <ActionTooltip
                            label={
                              commentState.hidden
                                ? "Unhide"
                                : "Hide"
                            }
                          />
                          </div>

                          {/* Delete */}
                          <div className="group/action relative">
                          <button
                            type="button"
                            disabled={
                              commentState.deleted
                            }
                            onClick={() =>
                              void deleteComment()
                            }
                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
                            title="Delete comment"
                            aria-label="Delete comment"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              className="h-4 w-4"
                              aria-hidden="true"
                            >
                              <path
                                d="M4 7h16"
                                strokeLinecap="round"
                              />
                              <path
                                d="M9 7V4h6v3"
                                strokeLinecap="round"
                              />
                              <path
                                d="M6 7l1 13h10l1-13"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <ActionTooltip label="Delete" />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>

      {/* Facebook comment reply target */}
      {isCommentConversation &&
      replyingToCommentId ? (
        <div className="shrink-0 border-t border-blue-100 bg-blue-50/80 px-4 py-2">
          <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <ReplyIcon />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-blue-700">
                Replying to {replyingToName}
              </p>

              <p className="mt-0.5 truncate text-sm text-slate-600">
                {replyingToMessage
                  ?.message_text ??
                  "Selected Facebook comment"}
              </p>
            </div>

            <button
              type="button"
              onClick={
                onCancelCommentReply
              }
              className="group/action relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="Cancel reply"
              aria-label="Cancel reply"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  d="M6 6l12 12M18 6 6 18"
                  strokeLinecap="round"
                />
              </svg>

              <ActionTooltip
                label="Cancel reply"
              />
            </button>
          </div>
        </div>
      ) : null}

      {/* Reply composer */}
      {activeConversation.contact ? (
        commentReplyLocked ? (
          /*
           * Facebook Comment channel:
           * disable the composer until staff explicitly
           * selects one comment with the Reply action.
           */
          <div className="shrink-0 border-t border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-300">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path
                    d="M20 13a7 7 0 1 1-3-5.74"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 8v4l3 2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <p className="text-sm font-medium text-slate-500">
                Select a Facebook comment and click Reply to start chatting.
              </p>
            </div>

            <div className="flex items-stretch gap-3">
              <div
                className="flex min-h-[54px] flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-400"
                aria-disabled="true"
              >
                Select a comment to reply...
              </div>

              <button
                type="button"
                disabled
                className="min-w-[112px] rounded-xl bg-slate-200 px-5 font-semibold text-slate-400"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          /*
           * Messenger conversations are always enabled.
           * Comment conversations become enabled only after
           * replyingToCommentId has been selected.
           */
          <ReplyBox
            conversationId={
              activeConversation.id
            }
            contactId={
              activeConversation.contact.id
            }
            businessId={
              activeConversation.contact
                .business_id
            }

            initialTags={
              activeConversation.contact
                .tags ?? []
            }

            reply={reply}
            sending={sending}
            error={sendError}

            onReplyChange={
              onReplyChange
            }
            onSubmit={
              onSendMessage
            }
          />
        )
      ) : null}

    </section>
  );
}