"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  ConversationHeader,
} from "@/components/inbox/conversation-header";

import {
  ReplyBox,
  type ReplyAttachment,
} from "@/components/inbox/reply-box";
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";

import type {
  ConversationStatus,
  CustomerTag,
  InboxConversation,
  InboxMessage,
  TeamMember,
} from "@/types/inbox";

import type {
  AgentPresence,
  AgentPresenceStatus,
  TeamAgentPresence,
} from "@/lib/inbox/use-agent-presence";
import {
  TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
  readWorkspaceStorage,
} from "@/lib/display/workspace-storage";

const CHAT_BACKGROUND_STORAGE_KEY = "tenh-chat-background-theme";
const CHAT_BACKGROUND_SRC_STORAGE_KEY = `${CHAT_BACKGROUND_STORAGE_KEY}:src`;
const CHAT_BACKGROUND_CHANGE_EVENT = "tenh:chat-background-theme-change";
const DEFAULT_CHAT_BACKGROUND_SRC = "/images/chat-bg.png";

const CHAT_BACKGROUND_PRESET_SRC: Record<string, string> = {
  "theme-1": "/images/bg-theme1.png",
  "theme-2": "/images/bg-theme2.png",
  "theme-3": "/images/bg-theme3.png",
  "theme-4": "/images/bg-theme4.png",
  "theme-5": "/images/bg-theme5.png",
};

function isSafeChatBackgroundSrc(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Object.values(CHAT_BACKGROUND_PRESET_SRC).includes(value)
  );
}

function readStoredChatBackgroundSrc() {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_BACKGROUND_SRC;
  }

  try {
    const storedSrc = readWorkspaceStorage(
      CHAT_BACKGROUND_SRC_STORAGE_KEY,
    );

    if (isSafeChatBackgroundSrc(storedSrc)) {
      return storedSrc;
    }

    const storedId = readWorkspaceStorage(
      CHAT_BACKGROUND_STORAGE_KEY,
    );

    if (storedId && CHAT_BACKGROUND_PRESET_SRC[storedId]) {
      return CHAT_BACKGROUND_PRESET_SRC[storedId];
    }
  } catch {
    // Keep the Inbox usable if browser storage is unavailable.
  }

  return DEFAULT_CHAT_BACKGROUND_SRC;
}

type MessagePanelProps = {
  activeConversation:
    | InboxConversation
    | null;

  messages: InboxMessage[];

  loadingConversationMessages: boolean;

  conversationMessagesError:
    | string
    | null;

  onRetryConversationMessages:
    () => void;

  teamMembers: TeamMember[];

  hasMoreOlderMessages: boolean;

  loadingOlderMessages: boolean;

  olderMessagesError:
    | string
    | null;

  onLoadOlderMessages:
    () => Promise<boolean>;

  viewingAgents: AgentPresence[];

  typingAgents: AgentPresence[];

  teamPresence: TeamAgentPresence[];

  agentPresenceStatus:
    AgentPresenceStatus;

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

  onContactTagsChange?: (
    contactId: string,
    tags: CustomerTag[],
  ) => void;

  onSendMessage: (
    event: FormEvent,
  ) => void;

  onSendAttachments: (
    attachments: ReplyAttachment[],
  ) => Promise<boolean>;

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

  replyingToTelegramMessageId:
    | string
    | null;

  editingTelegramMessageId:
    | string
    | null;

  telegramActionNotice:
    | string
    | null;

  onReplyToTelegramMessage: (
    messageId: string,
  ) => void;

  onEditTelegramMessage: (
    messageId: string,
    currentText: string,
  ) => Promise<void>;

  onDeleteTelegramMessage: (
    messageId: string,
  ) => Promise<void>;

  onCancelTelegramEdit:
    () => void;

  onCancelTelegramReply:
    () => void;

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


function getAgentPresenceText(
  viewingAgents: AgentPresence[],
  typingAgents: AgentPresence[],
) {
  if (typingAgents.length === 1) {
    return `${typingAgents[0].name} is typing…`;
  }

  if (typingAgents.length === 2) {
    return `${typingAgents[0].name} and ${typingAgents[1].name} are typing…`;
  }

  if (typingAgents.length > 2) {
    return `${typingAgents.length} teammates are typing…`;
  }

  if (viewingAgents.length === 1) {
    return `${viewingAgents[0].name} is viewing this conversation`;
  }

  if (viewingAgents.length > 1) {
    return `${viewingAgents.length} teammates are viewing this conversation`;
  }

  return null;
}

function AgentPresenceStrip({
  viewingAgents,
  typingAgents,
  status,
}: {
  viewingAgents: AgentPresence[];
  typingAgents: AgentPresence[];
  status: AgentPresenceStatus;
}) {
  const text =
    getAgentPresenceText(
      viewingAgents,
      typingAgents,
    );

  if (!text) {
    return null;
  }

  const isTyping =
    typingAgents.length > 0;

  return (
    <div
      className={`flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs ${
        isTyping
          ? "border-blue-100 bg-blue-50 text-blue-700"
          : "border-emerald-100 bg-emerald-50 text-emerald-700"
      }`}
      title={
        status === "connected"
          ? "Live team presence"
          : "Team presence is reconnecting"
      }
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          isTyping
            ? "animate-pulse bg-blue-500"
            : "bg-emerald-500"
        }`}
      />

      <span className="min-w-0 truncate font-medium">
        {text}
      </span>

      {isTyping ? (
        <span
          className="ml-0.5 inline-flex items-center gap-0.5"
          aria-hidden="true"
        >
          <span className="h-1 w-1 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.2s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.1s]" />
          <span className="h-1 w-1 animate-bounce rounded-full bg-blue-500" />
        </span>
      ) : null}
    </div>
  );
}


type TelegramReplyPreview = {
  text: string;
  kind: string;
};

function telegramReplyPreviewFromMessage(
  source:
    | Record<string, unknown>
    | null
    | undefined,
): TelegramReplyPreview | null {
  if (!source) return null;

  const text =
    typeof source.text === "string"
      ? source.text.trim()
      : "";
  if (text) return { text, kind: "Text" };

  const caption =
    typeof source.caption === "string"
      ? source.caption.trim()
      : "";
  if (caption) return { text: caption, kind: "Caption" };

  if (Array.isArray(source.photo))
    return { text: "Photo", kind: "Photo" };
  if (source.video)
    return { text: "Video", kind: "Video" };
  if (source.animation)
    return { text: "Animation", kind: "GIF" };
  if (source.voice)
    return { text: "Voice message", kind: "Voice" };
  if (source.audio)
    return { text: "Audio", kind: "Audio" };

  if (source.document) {
    const doc =
      source.document as Record<string, unknown>;
    return {
      text:
        typeof doc.file_name === "string"
          ? doc.file_name
          : "File",
      kind: "File",
    };
  }

  if (source.sticker) {
    const sticker =
      source.sticker as Record<string, unknown>;
    const emoji =
      typeof sticker.emoji === "string"
        ? sticker.emoji
        : "";
    return {
      text:
        emoji
          ? `Sticker ${emoji}`
          : "Sticker",
      kind: "Sticker",
    };
  }

  if (source.location)
    return {
      text: "Shared location",
      kind: "Location",
    };

  return {
    text: "Telegram message",
    kind: "Message",
  };
}


function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path
        d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m14 8 3 3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-3.5 w-3.5"
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
        d="m6.5 7 .8 13h9.4l.8-13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 11v5M14 11v5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5M9 13h6M9 17h4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon({
  paused,
}: {
  paused: boolean;
}) {
  return paused ? (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
    </svg>
  );
}

function formatAttachmentSize(
  value: number | null | undefined,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAudioTime(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }

  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function CompactAudioPlayer({
  src,
  label,
  isVoice,
}: {
  src: string;
  label: string;
  isVoice: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function togglePlayback() {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      void audio.play();
      return;
    }

    audio.pause();
  }

  function seek(value: number) {
    const audio = audioRef.current;

    if (!audio || !Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const next = Math.min(
      duration,
      Math.max(0, value),
    );

    audio.currentTime = next;
    setCurrentTime(next);
  }

  return (
    <div className="w-[300px] max-w-full rounded-[22px] border border-slate-200/80 bg-white/95 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onLoadedMetadata={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        className="hidden"
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlayback}
          suppressHydrationWarning
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-600 text-white shadow-sm transition hover:bg-sky-700 active:scale-95"
          aria-label={playing ? "Pause audio" : "Play audio"}
        >
          <PlayIcon paused={!playing} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-sky-600">
            <VoiceIcon />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.01}
              value={Math.min(currentTime, duration > 0 ? duration : 1)}
              onChange={(event) =>
                seek(Number(event.target.value))
              }
              className="h-1.5 min-w-0 flex-1 cursor-pointer accent-sky-600"
              aria-label={isVoice ? "Voice message progress" : label || "Audio progress"}
            />

            <span className="w-[74px] shrink-0 text-right text-[11px] tabular-nums text-slate-400">
              {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function getValidMessageDate(
  value: string | null | undefined,
) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function isSameLocalMessageDay(
  firstValue: string | null | undefined,
  secondValue: string | null | undefined,
) {
  const first =
    getValidMessageDate(firstValue);
  const second =
    getValidMessageDate(secondValue);

  if (!first || !second) {
    return false;
  }

  return (
    first.getFullYear() ===
      second.getFullYear() &&
    first.getMonth() ===
      second.getMonth() &&
    first.getDate() ===
      second.getDate()
  );
}

function formatMessageClockTime(
  value: string | null | undefined,
) {
  const date =
    getValidMessageDate(value);

  if (!date) {
    return "";
  }

  return date.toLocaleTimeString(
    "en-US",
    {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    },
  );
}

function formatMessageDayLabel(
  value: string | null | undefined,
) {
  const date =
    getValidMessageDate(value);

  if (!date) {
    return "";
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfMessageDay =
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );

  const differenceDays =
    Math.round(
      (
        startOfToday.getTime() -
        startOfMessageDay.getTime()
      ) / 86_400_000,
    );

  if (differenceDays === 0) {
    return "Today";
  }

  if (differenceDays === 1) {
    return "Yesterday";
  }

  return date.toLocaleDateString(
    "en-US",
    date.getFullYear() ===
      now.getFullYear()
      ? {
          month: "long",
          day: "numeric",
        }
      : {
          month: "long",
          day: "numeric",
          year: "numeric",
        },
  );
}

function HydrationSafeMessageTime({
  value,
}: {
  value: string | null | undefined;
}) {
  const [hydrated, setHydrated] =
    useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!value) {
    return null;
  }

  if (!hydrated) {
    return (
      <span
        className="inline-block min-w-[3.5rem]"
        aria-label="Message time loading"
      >
        &nbsp;
      </span>
    );
  }

  return (
    <>
      {formatMessageClockTime(value)}
    </>
  );
}

function HydrationSafeMessageDay({
  value,
}: {
  value: string | null | undefined;
}) {
  const [hydrated, setHydrated] =
    useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!value) {
    return null;
  }

  if (!hydrated) {
    return (
      <span
        className="inline-block min-w-[4rem]"
        aria-label="Message date loading"
      >
        &nbsp;
      </span>
    );
  }

  return (
    <>
      {formatMessageDayLabel(value)}
    </>
  );
}

function getFirstUnreadMessageId(
  messages: InboxMessage[],
  unreadCount: number,
): string | null {
  if (unreadCount <= 0) {
    return null;
  }

  let remaining = unreadCount;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.direction !== "incoming") {
      continue;
    }

    remaining -= 1;

    if (remaining === 0) {
      return message.id;
    }
  }

  return null;
}

export function MessagePanel({
  activeConversation,
  messages,
  loadingConversationMessages,
  conversationMessagesError,
  onRetryConversationMessages,
  teamMembers,
  hasMoreOlderMessages,
  loadingOlderMessages,
  olderMessagesError,
  onLoadOlderMessages,
  viewingAgents,
  typingAgents,
  teamPresence,
  agentPresenceStatus,
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
  onContactTagsChange,
  onSendMessage,
  onSendAttachments,
  onStatusChange,
  onAssignmentChange,

  onLikeComment,
  onHideComment,
  onReplyToComment,
  replyingToCommentId,
  replyingToTelegramMessageId,
  editingTelegramMessageId,
  telegramActionNotice,
  onReplyToTelegramMessage,
  onEditTelegramMessage,
  onDeleteTelegramMessage,
  onCancelTelegramEdit,
  onCancelTelegramReply,
  onCancelCommentReply,
  onDeleteComment,
  onRetryMessage,
}: MessagePanelProps) {
  const isKhmer = useWorkspaceLanguageId() === "km";

  /*
   * V3.11.25 — snapshot unread_count exactly when a conversation opens.
   * The parent may immediately mark the conversation read, but this snapshot
   * remains stable long enough to position the viewport at the first unread.
   */
  const [
    openedUnreadState,
    setOpenedUnreadState,
  ] = useState<{
    conversationId: string | null;
    unreadCount: number;
  }>({
    conversationId: null,
    unreadCount: 0,
  });

  const currentConversationId =
    activeConversation?.id ?? null;

  /*
   * Adjusting state during render is the supported React pattern for deriving
   * a value from a changed prop. React discards this render and re-runs it
   * immediately, so the snapshot can never come from a render that was thrown
   * away — which is exactly what mutating a ref here used to risk.
   */
  if (
    openedUnreadState.conversationId !==
    currentConversationId
  ) {
    setOpenedUnreadState({
      conversationId: currentConversationId,
      unreadCount: Math.max(
        0,
        activeConversation?.unread_count ?? 0,
      ),
    });
  }

  const openingUnreadCount =
    openedUnreadState.conversationId === currentConversationId
      ? openedUnreadState.unreadCount
      : Math.max(
          0,
          activeConversation?.unread_count ?? 0,
        );

  const firstUnreadMessageId =
    getFirstUnreadMessageId(
      messages,
      openingUnreadCount,
    );

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

  const [chatBackgroundSrc, setChatBackgroundSrc] =
    useState(DEFAULT_CHAT_BACKGROUND_SRC);

  useEffect(() => {
    function syncStoredBackground() {
      setChatBackgroundSrc(readStoredChatBackgroundSrc());
    }

    function handleBackgroundChange(event: Event) {
      const customEvent = event as CustomEvent<{
        src?: string;
      }>;
      const nextSrc = customEvent.detail?.src;

      if (isSafeChatBackgroundSrc(nextSrc)) {
        setChatBackgroundSrc(nextSrc);
        return;
      }

      syncStoredBackground();
    }

    function handleBackgroundStorage(event: StorageEvent) {
      if (
        event.key === CHAT_BACKGROUND_STORAGE_KEY ||
        event.key?.startsWith(`${CHAT_BACKGROUND_STORAGE_KEY}:`) ||
        event.key === CHAT_BACKGROUND_SRC_STORAGE_KEY ||
        event.key?.startsWith(`${CHAT_BACKGROUND_SRC_STORAGE_KEY}:`)
      ) {
        syncStoredBackground();
      }
    }

    syncStoredBackground();

    window.addEventListener(
      CHAT_BACKGROUND_CHANGE_EVENT,
      handleBackgroundChange,
    );
    window.addEventListener("storage", handleBackgroundStorage);
    window.addEventListener(
      TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
      syncStoredBackground,
    );

    return () => {
      window.removeEventListener(
        CHAT_BACKGROUND_CHANGE_EVENT,
        handleBackgroundChange,
      );
      window.removeEventListener(
        "storage",
        handleBackgroundStorage,
      );
      window.removeEventListener(
        TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
        syncStoredBackground,
      );
    };
  }, []);

  const [
    telegramContextMenu,
    setTelegramContextMenu,
  ] = useState<
    | {
        messageId: string;
        messageText: string;
        x: number;
        y: number;
        canReply: boolean;
        canEdit: boolean;
        canDelete: boolean;
      }
    | null
  >(null);


  const [
    jumpHighlightedMessageId,
    setJumpHighlightedMessageId,
  ] = useState<string | null>(
    null,
  );

  const messageElementRefs =
    useRef<
      Map<string, HTMLDivElement>
    >(new Map());

  const latestMessagesRef =
    useRef(messages);

  const hasMoreOlderMessagesRef =
    useRef(hasMoreOlderMessages);

  /*
   * These refs only ever get read inside async callbacks that run after
   * commit, so updating them in an effect keeps the same behaviour without
   * writing to a ref during render.
   */
  useEffect(() => {
    latestMessagesRef.current =
      messages;
  }, [messages]);

  useEffect(() => {
    hasMoreOlderMessagesRef.current =
      hasMoreOlderMessages;
  }, [hasMoreOlderMessages]);

  /*
   * =========================================================
   * V2.3 — AUTO SCROLL + NEW MESSAGE INDICATOR
   * =========================================================
   *
   * Rules:
   * - Opening a conversation starts at the newest message.
   * - If staff is already near the bottom, new messages scroll
   *   into view automatically.
   * - If staff has scrolled up to read older messages, incoming
   *   messages do NOT pull the screen away. Instead we show a
   *   "New message(s)" button.
   * - Outgoing/optimistic messages always keep the sender at the
   *   bottom of the conversation.
   */
  const [
    newMessageCount,
    setNewMessageCount,
  ] = useState(0);

  const [
    showScrollToLatest,
    setShowScrollToLatest,
  ] = useState(false);

  const messagesContainerRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const lastMessageIdRef =
    useRef<string | null>(null);

  const previousMessageCountRef =
    useRef(0);

  const initialScrollDoneRef =
    useRef(false);

  const initialUnreadLoadInFlightRef =
    useRef(false);

  const initialUnreadAutoLoadStoppedRef =
    useRef(false);

  const userNearBottomRef =
    useRef(true);

  type ConversationScrollPosition = {
    scrollTop: number;
    nearBottom: boolean;
  };

  const conversationScrollPositionsRef =
    useRef<
      Record<
        string,
        ConversationScrollPosition | undefined
      >
    >({});

  const previousConversationIdRef =
    useRef<string | null>(
      activeConversation?.id ??
      null,
    );

  const pendingScrollRestoreRef =
    useRef<
      ConversationScrollPosition | null
    >(null);

  /*
   * V2.7 — preserve the visible viewport while older messages
   * are prepended above the current scroll position.
   */
  const prependScrollSnapshotRef =
    useRef<{
      scrollHeight: number;
      scrollTop: number;
    } | null>(null);

  const olderLoadRequestedRef =
    useRef(false);

  const scrollToNewest =
    useCallback(
      (
        behavior: ScrollBehavior =
          "smooth",
      ) => {
        const container =
          messagesContainerRef.current;

        if (!container) {
          return;
        }

        container.scrollTo({
          top: container.scrollHeight,
          behavior,
        });

        userNearBottomRef.current =
          true;

        setShowScrollToLatest(
          false,
        );

        setNewMessageCount(0);

        if (activeConversation?.id) {
          conversationScrollPositionsRef
            .current[
              activeConversation.id
            ] = {
            scrollTop:
              container.scrollHeight,
            nearBottom: true,
          };
        }
      },
      [activeConversation?.id],
    );

  async function loadOlderMessages() {
    if (
      !hasMoreOlderMessages ||
      loadingOlderMessages ||
      olderLoadRequestedRef.current
    ) {
      return;
    }

    const container =
      messagesContainerRef.current;

    if (!container) {
      return;
    }

    olderLoadRequestedRef.current =
      true;

    prependScrollSnapshotRef.current = {
      scrollHeight:
        container.scrollHeight,
      scrollTop:
        container.scrollTop,
    };

    try {
      const loaded =
        await onLoadOlderMessages();

      if (!loaded) {
        prependScrollSnapshotRef.current =
          null;
      }
    } finally {
      olderLoadRequestedRef.current =
        false;
    }
  }

  function handleMessagesScroll() {
    const container =
      messagesContainerRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight -
      container.scrollTop -
      container.clientHeight;

    const isNearBottom =
      distanceFromBottom <= 120;

    userNearBottomRef.current =
      isNearBottom;

    if (activeConversation?.id) {
      conversationScrollPositionsRef
        .current[
          activeConversation.id
        ] = {
        scrollTop:
          container.scrollTop,
        nearBottom:
          isNearBottom,
      };
    }

    setShowScrollToLatest(
      !isNearBottom,
    );

    if (
      isNearBottom &&
      newMessageCount > 0
    ) {
      setNewMessageCount(0);
    }

    /*
     * V2.7 — when the agent reaches the top area, request the
     * next older page. The parent prevents duplicate network calls.
     */
    if (
      container.scrollTop <= 140 &&
      hasMoreOlderMessages &&
      !loadingOlderMessages
    ) {
      void loadOlderMessages();
    }
  }

  function showActionNotice(message: string) {
    setActionNotice(message);

    window.setTimeout(() => {
      setActionNotice(null);
    }, 1800);
  }

  useEffect(() => {
    const nextConversationId =
      activeConversation?.id ??
      null;

    const previousConversationId =
      previousConversationIdRef
        .current;

    /*
     * Scroll positions are persisted continuously by handleMessagesScroll
     * and scrollToNewest. Do not read the DOM here because React may already
     * have painted the destination conversation when this effect runs.
     */
    void previousConversationId;

    pendingScrollRestoreRef.current =
      nextConversationId
        ? conversationScrollPositionsRef
            .current[
              nextConversationId
            ] ?? null
        : null;

    previousConversationIdRef.current =
      nextConversationId;

    initialScrollDoneRef.current =
      false;
    initialUnreadLoadInFlightRef.current =
      false;
    initialUnreadAutoLoadStoppedRef.current =
      false;

    lastMessageIdRef.current =
      null;

    previousMessageCountRef.current =
      0;

    userNearBottomRef.current =
      pendingScrollRestoreRef.current
        ?.nearBottom ??
      true;

    setShowScrollToLatest(
      Boolean(
        pendingScrollRestoreRef.current &&
        !pendingScrollRestoreRef.current
          .nearBottom,
      ),
    );

    prependScrollSnapshotRef.current =
      null;

    olderLoadRequestedRef.current =
      false;

    setNewMessageCount(0);
  }, [activeConversation?.id]);

  /*
   * Older pages are inserted before the currently visible messages.
   * Restore the viewport by adding the new content height so the
   * agent does not jump to a different message.
   */
  const jumpToTelegramReplyTarget =
    useCallback(
      async ({
        localMessageId,
        platformMessageId,
      }: {
        localMessageId:
          | string
          | null;
        platformMessageId:
          | string
          | null;
      }) => {
        setTelegramContextMenu(
          null,
        );

        const findTarget = () => {
          const currentMessages =
            latestMessagesRef.current;

          if (localMessageId) {
            const byLocalId =
              currentMessages.find(
                (item) =>
                  item.id ===
                  localMessageId,
              );

            if (byLocalId) {
              return byLocalId;
            }
          }

          if (platformMessageId) {
            return (
              currentMessages.find(
                (item) =>
                  item.platform_message_id ===
                  platformMessageId,
              ) ?? null
            );
          }

          return null;
        };

        let targetMessage =
          findTarget();

        /*
         * A reply can point to a message older than the newest page.
         * Load older pages progressively before giving up.
         */
        let attempts = 0;

        while (
          !targetMessage &&
          hasMoreOlderMessagesRef.current &&
          attempts < 12
        ) {
          attempts += 1;

          const loaded =
            await onLoadOlderMessages();

          if (!loaded) {
            break;
          }

          await new Promise<void>(
            (resolve) => {
              window.requestAnimationFrame(
                () => {
                  window.requestAnimationFrame(
                    () =>
                      resolve(),
                  );
                },
              );
            },
          );

          targetMessage =
            findTarget();
        }

        if (!targetMessage) {
          return;
        }

        const targetElement =
          messageElementRefs.current.get(
            targetMessage.id,
          );

        if (!targetElement) {
          return;
        }

        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        setJumpHighlightedMessageId(
          targetMessage.id,
        );

        window.setTimeout(() => {
          setJumpHighlightedMessageId(
            (current) =>
              current ===
              targetMessage?.id
                ? null
                : current,
          );
        }, 1800);
      },
      [onLoadOlderMessages],
    );

  useLayoutEffect(() => {
    const snapshot =
      prependScrollSnapshotRef.current;

    const container =
      messagesContainerRef.current;

    if (
      !snapshot ||
      !container
    ) {
      return;
    }

    const heightAdded =
      container.scrollHeight -
      snapshot.scrollHeight;

    container.scrollTop =
      snapshot.scrollTop +
      Math.max(
        0,
        heightAdded,
      );

    prependScrollSnapshotRef.current =
      null;
  }, [messages]);

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

  useEffect(() => {
    if (
      loadingConversationMessages &&
      messages.length === 0
    ) {
      return;
    }

    const latestMessage =
      messages[
        messages.length - 1
      ] ?? null;

    const latestMessageId =
      latestMessage?.id ?? null;

    /*
     * First render for this conversation:
     * 1) restore an intentional previous scroll position; otherwise
     * 2) if it opened unread, position at the FIRST unread incoming message;
     * 3) otherwise jump to newest.
     */
    if (
      !initialScrollDoneRef.current
    ) {
      const savedPosition =
        pendingScrollRestoreRef
          .current;

      if (
        !savedPosition &&
        openingUnreadCount > 0 &&
        !firstUnreadMessageId &&
        hasMoreOlderMessages &&
        !initialUnreadAutoLoadStoppedRef.current
      ) {
        if (
          !loadingOlderMessages &&
          !initialUnreadLoadInFlightRef.current
        ) {
          initialUnreadLoadInFlightRef.current =
            true;

          void onLoadOlderMessages()
            .then((loaded) => {
              if (!loaded) {
                initialUnreadAutoLoadStoppedRef.current =
                  true;
              }
            })
            .catch(() => {
              initialUnreadAutoLoadStoppedRef.current =
                true;
            })
            .finally(() => {
              initialUnreadLoadInFlightRef.current =
                false;
            });
        }

        return;
      }

      initialScrollDoneRef.current =
        true;

      lastMessageIdRef.current =
        latestMessageId;

      previousMessageCountRef.current =
        messages.length;

      pendingScrollRestoreRef.current =
        null;

      window.requestAnimationFrame(
        () => {
          const container =
            messagesContainerRef.current;

          if (
            container &&
            savedPosition &&
            !savedPosition.nearBottom
          ) {
            const maxScrollTop =
              Math.max(
                0,
                container.scrollHeight -
                  container.clientHeight,
              );

            container.scrollTop =
              Math.min(
                savedPosition.scrollTop,
                maxScrollTop,
              );

            userNearBottomRef.current =
              false;
            setShowScrollToLatest(
              true,
            );
            return;
          }

          if (
            openingUnreadCount > 0 &&
            firstUnreadMessageId
          ) {
            const targetElement =
              messageElementRefs.current.get(
                firstUnreadMessageId,
              );

            if (targetElement) {
              targetElement.scrollIntoView({
                behavior: "auto",
                block: "center",
              });

              const distanceFromBottom =
                container
                  ? container.scrollHeight -
                    container.scrollTop -
                    container.clientHeight
                  : 0;

              const nearBottom =
                distanceFromBottom <= 120;

              userNearBottomRef.current =
                nearBottom;
              setShowScrollToLatest(
                !nearBottom,
              );

              if (
                container &&
                activeConversation?.id
              ) {
                conversationScrollPositionsRef
                  .current[
                    activeConversation.id
                  ] = {
                  scrollTop:
                    container.scrollTop,
                  nearBottom,
                };
              }

              return;
            }
          }

          scrollToNewest("auto");
        },
      );

      return;
    }

    const previousMessageId =
      lastMessageIdRef.current;

    const previousMessageCount =
      previousMessageCountRef.current;

    lastMessageIdRef.current =
      latestMessageId;

    previousMessageCountRef.current =
      messages.length;

    /*
     * Delivery/Seen updates can replace message objects without
     * adding a new message. Do not show the indicator for those.
     */
    if (
      !latestMessage ||
      !latestMessageId ||
      latestMessageId ===
        previousMessageId
    ) {
      return;
    }

    const addedCount =
      messages.length >
      previousMessageCount
        ? messages.length -
          previousMessageCount
        : 1;

    const isOutgoing =
      latestMessage.direction ===
      "outgoing";

    /*
     * Keep outgoing/optimistic sends visible.
     * Incoming messages auto-scroll only when the agent has not
     * intentionally scrolled away from the bottom.
     */
    if (
      isOutgoing ||
      userNearBottomRef.current
    ) {
      window.requestAnimationFrame(
        () => {
          scrollToNewest("smooth");
        },
      );

      return;
    }

    setNewMessageCount(
      (current) =>
        current + addedCount,
    );
  }, [
    activeConversation?.id,
    firstUnreadMessageId,
    hasMoreOlderMessages,
    loadingConversationMessages,
    loadingOlderMessages,
    messages,
    onLoadOlderMessages,
    openingUnreadCount,
    scrollToNewest,
  ]);

  useEffect(() => {
    setTelegramContextMenu(null);
    setJumpHighlightedMessageId(
      null,
    );
    messageElementRefs.current.clear();
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!telegramContextMenu) {
      return;
    }

    const closeMenu = () => {
      setTelegramContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [telegramContextMenu]);

  if (!activeConversation) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center bg-slate-50 p-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl">
              💬
            </div>

            <p className="mt-4 font-semibold text-slate-900">
              {isKhmer ? "ជ្រើសរើសការសន្ទនា" : "Select a conversation"}
            </p>

            <p className="mt-1 text-sm text-slate-500">
              {isKhmer ? "ជ្រើសរើសអតិថិជនពីប្រអប់សារ។" : "Choose a customer from the inbox."}
            </p>
          </div>
        </div>
      </section>
    );
  }

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

  const extendedConversation =
    activeConversation as InboxConversation & {
      platform?: string | null;
      social_account?:
        | (InboxConversation["social_account"] & {
            platform?: string | null;
          })
        | null;
    };

  const explicitPlatform =
    extendedConversation.platform
      ?.trim()
      .toLowerCase() ||
    extendedConversation.social_account
      ?.platform
      ?.trim()
      .toLowerCase() ||
    "";

  const hasTelegramMessage =
    messages.some((message) =>
      message.platform_message_id
        ?.toLowerCase()
        .startsWith("telegram:"),
    );

  const headerChannelPlatform:
    | "messenger"
    | "telegram" =
    explicitPlatform === "telegram" ||
    hasTelegramMessage
      ? "telegram"
      : "messenger";

  const headerChannelAccountName =
    activeConversation.social_account
      ?.account_name
      ?.trim() ||
    (headerChannelPlatform === "telegram"
      ? "Telegram Bot"
      : "Facebook Page");

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">

      {telegramActionNotice ||
      actionNotice ? (
        <div className="pointer-events-none absolute left-1/2 top-16 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px]">
            ✓
          </span>
          {telegramActionNotice ??
            actionNotice}
        </div>
      ) : null}

      {telegramContextMenu ? (
        <div
          className="fixed z-[220] inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
          style={{
            left: telegramContextMenu.x,
            top: telegramContextMenu.y,
          }}
          onClick={(event) =>
            event.stopPropagation()
          }
          onContextMenu={(event) =>
            event.preventDefault()
          }
          role="menu"
          aria-label="Telegram message actions"
        >
          {telegramContextMenu.canReply ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (
                  replyingToTelegramMessageId ===
                  telegramContextMenu.messageId
                ) {
                  onCancelTelegramReply();
                } else {
                  onReplyToTelegramMessage(
                    telegramContextMenu.messageId,
                  );
                }

                setTelegramContextMenu(null);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-sky-700"
              title="Reply"
            >
              <ReplyIcon />
              <span>Reply</span>
            </button>
          ) : null}

          {telegramContextMenu.canEdit ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void onEditTelegramMessage(
                  telegramContextMenu.messageId,
                  telegramContextMenu.messageText,
                );
                setTelegramContextMenu(null);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-sky-700"
              title="Edit message"
              aria-label="Edit message"
            >
              <EditIcon />
            </button>
          ) : null}

          {telegramContextMenu.canDelete ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void onDeleteTelegramMessage(
                  telegramContextMenu.messageId,
                );
                setTelegramContextMenu(null);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600"
              title="Delete message"
              aria-label="Delete message"
            >
              <TrashIcon />
            </button>
          ) : null}
        </div>
      ) : null}

      <ConversationHeader
        conversation={
          activeConversation
        }
        teamMembers={
          teamMembers
        }
        viewingAgents={
          viewingAgents
        }
        typingAgents={
          typingAgents
        }
        teamPresence={
          teamPresence
        }
        agentPresenceStatus={
          agentPresenceStatus
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
        channelPlatform={
          headerChannelPlatform
        }
        channelAccountName={
          headerChannelAccountName
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
      <div className="relative min-h-0 flex-1">
        {loadingConversationMessages ? (
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden bg-[#EEF2F6] px-6 py-5">
            <div className="mx-auto flex h-full max-w-4xl flex-col justify-end gap-4">
              {[
                { side: "left", width: "w-56" },
                { side: "right", width: "w-72" },
                { side: "left", width: "w-80" },
                { side: "right", width: "w-52" },
                { side: "left", width: "w-64" },
              ].map((item, index) => (
                <div
                  key={index}
                  className={`flex ${item.side === "right" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`${item.width} animate-pulse rounded-2xl border border-white bg-white/85 p-3 shadow-sm`}
                  >
                    <div className="h-3 w-3/4 rounded bg-slate-200" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : conversationMessagesError ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#EEF2F6]/75 backdrop-blur-[1px]">
            <div className="max-w-sm rounded-2xl border border-red-100 bg-white/95 p-4 text-center shadow-sm">
              <p className="text-sm font-semibold text-slate-800">
                Couldn&apos;t load this conversation
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {conversationMessagesError}
              </p>
              <button
                type="button"
                onClick={onRetryConversationMessages}
                className="mt-3 rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        <div
          ref={messagesContainerRef}
          onScroll={
            handleMessagesScroll
          }
          className="h-full space-y-4 overflow-y-auto p-6"
          style={{
            backgroundColor: "#EEF2F6",
            backgroundImage: `url("${chatBackgroundSrc}")`,
            backgroundRepeat:
              chatBackgroundSrc === DEFAULT_CHAT_BACKGROUND_SRC
                ? "repeat"
                : "no-repeat",
            backgroundSize:
              chatBackgroundSrc === DEFAULT_CHAT_BACKGROUND_SRC
                ? "320px"
                : "cover",
            backgroundPosition:
              chatBackgroundSrc === DEFAULT_CHAT_BACKGROUND_SRC
                ? "left top"
                : "center",
          }}
        >
          <div className="mb-3 flex min-h-8 items-center justify-center">
            {loadingOlderMessages ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                Loading older messages...
              </div>
            ) : olderMessagesError ? (
              <button
                type="button"
                onClick={() =>
                  void loadOlderMessages()
                }
                className="rounded-full border border-red-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-50"
              >
                Couldn&apos;t load older messages. Retry
              </button>
            ) : hasMoreOlderMessages ? (
              <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] font-medium text-slate-400">
                Scroll up for earlier messages
              </span>
            ) : messages.length > 0 ? (
              <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] font-medium text-slate-400">
                Beginning of conversation
              </span>
            ) : null}
          </div>

          <div className="space-y-4">
          {messages.map(
            (message, messageIndex) => {
              const isOutgoing =
                message.direction ===
                "outgoing";

              const messageTimestamp =
                message.platform_created_at ??
                message.created_at;

              const previousMessage =
                messageIndex > 0
                  ? messages[messageIndex - 1]
                  : null;

              const previousMessageTimestamp =
                previousMessage
                  ? previousMessage.platform_created_at ??
                    previousMessage.created_at
                  : null;

              const showMessageDay =
                messageIndex === 0 ||
                !isSameLocalMessageDay(
                  messageTimestamp,
                  previousMessageTimestamp,
                );

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
                  item?: string;
                  source?: string;
                  parent_comment_id?: string;
                  reply_comment_id?: string;

                  tenh_attachment?: {
                    type?:
                      | "image"
                      | "video"
                      | "file"
                      | "audio"
                      | "voice"
                      | "sticker";
                    name?: string | null;
                    mime_type?: string | null;
                    size?: number | null;
                    attachment_id?: string | null;
                  } | null;

                  tenh_sticker?: {
                    format?:
                      | "static"
                      | "animated"
                      | "video";
                    preview_kind?:
                      | "image"
                      | "video"
                      | "file";
                    emoji?:
                      | string
                      | null;
                    set_name?:
                      | string
                      | null;
                  } | null;

                  tenh_animation?: {
                    format?:
                      | "gif"
                      | "mp4";
                    source?:
                      | string
                      | null;
                  } | null;

                  tenh_location?: {
                    latitude?: number;
                    longitude?: number;
                    horizontal_accuracy?:
                      | number
                      | null;
                    live_period?:
                      | number
                      | null;
                    source?:
                      | string
                      | null;
                  } | null;

                  message?: {
                    reply_to_message?:
                      | Record<string, unknown>
                      | null;
                  } | null;

                  reply_to_message?:
                    | Record<string, unknown>
                    | null;

                  tenh_reply?: {
                    reply_to_local_message_id?:
                      | string
                      | null;
                    reply_to_platform_message_id?:
                      | string
                      | null;
                    preview_text?: string | null;
                    preview_type?: string | null;
                  } | null;

                  tenh_edit?: {
                    source?: string | null;
                    edited_at?: string | null;
                  } | null;

                  tenh_deleted?: {
                    source?: string | null;
                    deleted_at?: string | null;
                  } | null;

                  tenh_delivery?: {
                    status?: string | null;
                    accepted_at?: string | null;
                  } | null;

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

              const attachmentMeta =
                rawPayload?.tenh_attachment ??
                null;

              const stickerMeta =
                rawPayload?.tenh_sticker ??
                null;

              const animationMeta =
                rawPayload?.tenh_animation ??
                null;

              const locationMeta =
                rawPayload?.tenh_location ??
                null;

              const telegramNativeReply =
                rawPayload?.message
                  ?.reply_to_message ??
                rawPayload?.reply_to_message ??
                null;

              const telegramReplyPreview =
                telegramReplyPreviewFromMessage(
                  telegramNativeReply,
                ) ??
                (
                  rawPayload?.tenh_reply
                    ?.preview_text
                    ? {
                        text:
                          rawPayload.tenh_reply
                            .preview_text,
                        kind:
                          rawPayload.tenh_reply
                            .preview_type ??
                          "Message",
                      }
                    : null
                );


              const telegramReplyLocalMessageId =
                typeof rawPayload
                  ?.tenh_reply
                  ?.reply_to_local_message_id ===
                  "string"
                  ? rawPayload.tenh_reply
                      .reply_to_local_message_id
                  : null;

              const savedReplyPlatformMessageId =
                typeof rawPayload
                  ?.tenh_reply
                  ?.reply_to_platform_message_id ===
                  "string"
                  ? rawPayload.tenh_reply
                      .reply_to_platform_message_id
                  : null;

              const nativeReplyMessageId =
                telegramNativeReply &&
                typeof telegramNativeReply[
                  "message_id"
                ] === "number"
                  ? telegramNativeReply[
                      "message_id"
                    ]
                  : null;

              const currentTelegramMatch =
                message.platform_message_id
                  ?.match(
                    /^telegram:([^:]+):\d+$/,
                  ) ?? null;

              const nativeReplyPlatformMessageId =
                nativeReplyMessageId !==
                  null &&
                currentTelegramMatch
                  ? `telegram:${currentTelegramMatch[1]}:${nativeReplyMessageId}`
                  : null;

              const telegramReplyTargetPlatformMessageId =
                savedReplyPlatformMessageId ??
                nativeReplyPlatformMessageId;

              const canJumpToTelegramReply =
                Boolean(
                  telegramReplyPreview &&
                    (
                      telegramReplyLocalMessageId ||
                      telegramReplyTargetPlatformMessageId
                    ),
                );

              const telegramEdited =
                Boolean(
                  rawPayload
                    ?.tenh_edit,
                );

              const telegramDeleted =
                Boolean(
                  rawPayload
                    ?.tenh_deleted,
                );

              const attachmentUrl =
                message.attachment_url;

              const isImageMessage =
                message.message_type ===
                "image";

              const isVideoMessage =
                message.message_type ===
                "video";

              const isAnimationMessage =
                isVideoMessage &&
                Boolean(
                  animationMeta,
                );

              const isFileMessage =
                message.message_type ===
                "file";

              const isAudioMessage =
                message.message_type ===
                "audio";

              const isVoiceMessage =
                message.message_type ===
                "voice";

              const isStickerMessage =
                message.message_type ===
                "sticker";

              const locationLatitude =
                typeof locationMeta
                  ?.latitude ===
                  "number"
                  ? locationMeta.latitude
                  : null;

              const locationLongitude =
                typeof locationMeta
                  ?.longitude ===
                  "number"
                  ? locationMeta.longitude
                  : null;

              const isLocationMessage =
                locationLatitude !==
                  null &&
                locationLongitude !==
                  null;

              const locationUrl =
                isLocationMessage
                  ? `https://www.google.com/maps?q=${locationLatitude},${locationLongitude}`
                  : null;

              const attachmentName =
                attachmentMeta?.name?.trim() ||
                message.message_text ||
                (isImageMessage
                  ? "Photo"
                  : isAnimationMessage
                    ? "Animation"
                    : isVideoMessage
                      ? "Video"
                    : isStickerMessage
                      ? stickerMeta?.emoji
                        ? `Sticker ${stickerMeta.emoji}`
                        : "Sticker"
                      : isVoiceMessage
                        ? "Voice message"
                        : isAudioMessage
                          ? "Audio"
                          : "File");

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

              const isTelegramMessage =
                message.platform_message_id
                  ?.startsWith(
                    "telegram:",
                  ) === true;

              const canReplyToTelegram =
                isTelegramMessage &&
                !message.id.startsWith(
                  "optimistic:",
                ) &&
                !telegramDeleted;

              const canEditTelegram =
                canReplyToTelegram &&
                isOutgoing &&
                message.message_type ===
                  "text" &&
                Boolean(
                  message.message_text
                    ?.trim(),
                );

              const canDeleteTelegram =
                canReplyToTelegram &&
                message.message_type ===
                  "text";

              const isTelegramReplyTarget =
                replyingToTelegramMessageId ===
                message.id;

              /*
               * V3.11.30.1 — comment actions belong to the individual
               * Facebook comment message, not to the whole conversation.
               * A TENH thread can contain both Messenger DMs and Page comments.
               */
              const isFacebookCommentMessage =
                Boolean(
                  rawPayload?.comment_id ||
                  rawPayload?.post_id ||
                  rawPayload?.item === "comment" ||
                  rawPayload?.source ===
                    "facebook_comment_reply" ||
                  rawPayload?.parent_comment_id ||
                  rawPayload?.reply_comment_id,
                );

              const facebookReplyParentId =
                rawPayload?.source ===
                  "facebook_comment_reply" &&
                typeof rawPayload
                  ?.parent_comment_id ===
                  "string"
                  ? rawPayload.parent_comment_id.trim()
                  : null;

              const facebookReplyParentMessage =
                facebookReplyParentId
                  ? messages.find(
                      (candidate) =>
                        candidate.platform_message_id ===
                        facebookReplyParentId,
                    ) ?? null
                  : null;

              // UI only: replies to Facebook comments are rendered as a
              // compact nested card directly beneath the parent comment.
              // This does not change reply IDs, actions, API calls, or data.
              const isNestedFacebookCommentReply = Boolean(
                facebookReplyParentId && facebookReplyParentMessage,
              );

              // UI only: collect direct Page replies so they can be rendered
              // inside the same visual comment container as their parent.
              // Message IDs and all existing APIs stay unchanged.
              const facebookChildReplies =
                !facebookReplyParentId &&
                message.platform_message_id
                  ? messages.filter((candidate) => {
                      const candidatePayload =
                        candidate.raw_payload as {
                          source?: string;
                          parent_comment_id?: string;
                        } | null;

                      return (
                        candidatePayload?.source ===
                          "facebook_comment_reply" &&
                        typeof candidatePayload.parent_comment_id ===
                          "string" &&
                        candidatePayload.parent_comment_id.trim() ===
                          message.platform_message_id
                      );
                    })
                  : [];

              const facebookReplyPreviewText =
                facebookReplyParentMessage
                  ?.comment_is_deleted
                  ? "Message deleted by commenter or Page"
                  : facebookReplyParentMessage
                      ?.message_text
                      ?.trim() ||
                    "Comment";

              const showCommentActions =
                isFacebookCommentMessage &&
                Boolean(
                  message.platform_message_id,
                ) &&
                !message.id.startsWith(
                  "optimistic:",
                );

              const isJumpHighlighted =
                jumpHighlightedMessageId ===
                message.id;

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
                    "Message deleted by commenter or Page",
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
                    "Message deleted by commenter or Page",
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
                    "Message deleted by commenter or Page",
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

              const hasEarlierPreviewForPost =
                Boolean(
                  postId &&
                    messages
                      .slice(0, messageIndex)
                      .some((candidate) => {
                        const candidatePayload =
                          candidate.raw_payload as
                            | { post_id?: string }
                            | null;

                        return (
                          candidatePayload?.post_id ===
                          postId
                        );
                      }),
                );

              const showFacebookPostPreview =
                Boolean(
                  postPreview &&
                    postId &&
                    !hasEarlierPreviewForPost &&
                    !commentState.deleted,
                );

              const facebookCommentActorName =
                isOutgoing
                  ? headerChannelAccountName
                  : replyingToName;

              const facebookCommentActorPhoto =
                isOutgoing
                  ? null
                  : activeConversation.contact
                      ?.profile_picture_url ?? null;

              const facebookCommentActorInitial =
                facebookCommentActorName
                  .trim()
                  .charAt(0)
                  .toUpperCase() || "?";

              /*
               * UI only: Facebook comment replies use a compact nested
               * thread layout. IDs, actions, API calls, and reply behavior
               * stay unchanged.
               */

              if (isFacebookCommentMessage) {
                // A reply that has a local parent is rendered inside that
                // parent below. Skip the old standalone reply card.
                if (isNestedFacebookCommentReply) {
                  return null;
                }

                // Deleted Facebook comments collapse to one safe status row:
                // no avatar, name, post preview, actions, or child replies.
                if (commentState.deleted) {
                  const deletedByPage =
                    commentState.deletedBy === "page" ||
                    (commentState.deletedBy === null && isOutgoing);

                  return (
                    <Fragment key={message.id}>
                      {showMessageDay ? (
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px flex-1 bg-blue-200/70" />
                          <span className="rounded-full border border-blue-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-blue-700 shadow-sm">
                            <HydrationSafeMessageDay
                              value={messageTimestamp}
                            />
                          </span>
                          <div className="h-px flex-1 bg-blue-200/70" />
                        </div>
                      ) : null}

                      <div
                        ref={(node) => {
                          if (node) {
                            messageElementRefs.current.set(
                              message.id,
                              node,
                            );
                          } else {
                            messageElementRefs.current.delete(
                              message.id,
                            );
                          }
                        }}
                        className="w-fit max-w-[680px] rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-sm italic text-slate-500 shadow-[0_3px_12px_rgba(15,23,42,0.04)]"
                      >
                        {deletedByPage
                          ? isKhmer
                            ? "សារត្រូវបានលុបដោយទំព័រ"
                            : "Message deleted by Page"
                          : isKhmer
                            ? "សារត្រូវបានលុបដោយអ្នកបញ្ចេញមតិ"
                            : "Message deleted by commenter"}
                      </div>
                    </Fragment>
                  );
                }

                return (
                  <Fragment key={message.id}>
                    {showMessageDay ? (
                      <div className="flex items-center gap-3 py-1">
                        <div className="h-px flex-1 bg-blue-200/70" />
                        <span className="rounded-full border border-blue-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-blue-700 shadow-sm">
                          <HydrationSafeMessageDay
                            value={messageTimestamp}
                          />
                        </span>
                        <div className="h-px flex-1 bg-blue-200/70" />
                      </div>
                    ) : null}

                    <div
                      ref={(node) => {
                        if (node) {
                          messageElementRefs.current.set(
                            message.id,
                            node,
                          );
                        } else {
                          messageElementRefs.current.delete(
                            message.id,
                          );
                        }
                      }}
                      className={`${
                        isNestedFacebookCommentReply
                          ? "!mt-0 ml-[52px] w-fit max-w-[680px] rounded-[16px] bg-white px-2 py-1 shadow-none sm:ml-[64px]"
                          : "w-fit max-w-[860px] rounded-[20px] border border-slate-200 bg-white p-2 shadow-[0_4px_16px_rgba(15,23,42,0.05)]"
                      } transition ${
                        isJumpHighlighted
                          ? "rounded-[18px] ring-2 ring-amber-300/70 ring-offset-2"
                          : isReplyTarget
                            ? "rounded-[18px] ring-2 ring-blue-300/70 ring-offset-2"
                            : ""
                      }`}
                    >
                      {showFacebookPostPreview &&
                      postPreview ? (
                        <div className="max-w-[860px] p-1 sm:p-2">
                          <div className="flex min-w-0 items-stretch gap-3 rounded-[18px] border border-slate-200 bg-white p-3 shadow-[0_3px_14px_rgba(15,23,42,0.04)] sm:gap-4">
                            {postPreview.full_picture ? (
                              <a
                                href={postUrl ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                                className="h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[15px] bg-slate-100 sm:h-[132px] sm:w-[132px]"
                              >
                                <img
                                  src={
                                    postPreview.full_picture
                                  }
                                  alt="Facebook post"
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              </a>
                            ) : (
                              <div className="flex h-[112px] w-[112px] shrink-0 items-center justify-center rounded-[15px] bg-blue-50 text-blue-600 sm:h-[132px] sm:w-[132px]">
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  className="h-10 w-10"
                                  aria-hidden="true"
                                >
                                  <path d="M13.6 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.7 1.8-1.7h1.9V2.5c-.3 0-1.5-.1-2.8-.1-2.8 0-4.7 1.7-4.7 4.8v2.3H6.7V13h3.1v9h3.8Z" />
                                </svg>
                              </div>
                            )}

                            <div className="min-w-0 flex-1 py-1">
                              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-500 sm:text-base">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1877F2] text-white">
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="currentColor"
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  >
                                    <path d="M13.6 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.7 1.8-1.7h1.9V2.5c-.3 0-1.5-.1-2.8-.1-2.8 0-4.7 1.7-4.7 4.8v2.3H6.7V13h3.1v9h3.8Z" />
                                  </svg>
                                </span>
                                <span>
                                  {isKhmer
                                    ? "មតិយោបល់លើការបង្ហោះ"
                                    : "Comment on post"}{" "}
                                  <span className="font-semibold text-slate-400">
                                    #{
                                      postId
                                        ?.replace(/[^A-Za-z0-9]/g, "")
                                        .slice(-8) || "Facebook"
                                    }
                                  </span>
                                </span>
                              </div>

                              <div className="mt-2 text-[22px] font-bold tracking-[-0.02em] text-slate-950 sm:text-[25px]">
                                {headerChannelAccountName}
                              </div>

                              {postPreview.message ? (
                                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-500 sm:text-base">
                                  {postPreview.message}
                                </p>
                              ) : null}

                              {postUrl ? (
                                <a
                                  href={postUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                                >
                                  {isKhmer
                                    ? "មើលការបង្ហោះ"
                                    : "View Post"}
                                  <span aria-hidden="true">↗</span>
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div
                        className={`relative flex gap-2.5 ${
                          isNestedFacebookCommentReply
                            ? "px-0 py-1.5 sm:gap-3"
                            : showFacebookPostPreview
                              ? "mt-3 px-1 py-2 sm:px-2"
                              : "px-1 py-2 sm:px-2"
                        }`}
                      >
                        <div className="shrink-0">
                          {facebookCommentActorPhoto ? (
                            <img
                              src={facebookCommentActorPhoto}
                              alt={facebookCommentActorName}
                              className={`${
                                isNestedFacebookCommentReply
                                  ? "h-8 w-8"
                                  : "h-10 w-10 sm:h-11 sm:w-11"
                              } rounded-full object-cover ring-1 ring-slate-200`}
                            />
                          ) : (
                            <div
                              className={`flex items-center justify-center rounded-full font-bold ${
                                isNestedFacebookCommentReply
                                  ? "h-8 w-8 text-xs"
                                  : "h-10 w-10 text-sm sm:h-11 sm:w-11 sm:text-base"
                              } ${
                                isOutgoing
                                  ? "bg-blue-600 text-white shadow-[0_6px_18px_rgba(37,99,235,0.22)]"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {facebookCommentActorInitial}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-8">
                            <span className="text-[15px] font-bold text-slate-950 sm:text-base">
                              {facebookCommentActorName}
                            </span>

                            {isOutgoing ? (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">
                                {isKhmer ? "អ្នក" : "You"}
                              </span>
                            ) : null}

                            <span className="text-sm text-slate-400">
                              <HydrationSafeMessageTime
                                value={messageTimestamp}
                              />
                            </span>

                            {isOutgoing &&
                            !commentState.deleted ? (
                              <span className="text-[11px] font-medium text-slate-400">
                                {optimisticStatus ===
                                "sending"
                                  ? "Sending..."
                                  : optimisticStatus ===
                                      "failed"
                                    ? "Failed to send"
                                    : persistedDeliveryStatus ===
                                        "seen"
                                      ? "✓✓ Seen"
                                      : persistedDeliveryStatus ===
                                          "delivered"
                                        ? "✓✓ Delivered"
                                        : "✓ Sent"}
                              </span>
                            ) : null}
                          </div>

                          <span
                            aria-hidden="true"
                            className="absolute right-0 top-0 select-none text-lg leading-none tracking-[2px] text-slate-400"
                          >
                            ⋮
                          </span>

                          {facebookReplyParentId &&
                          !isNestedFacebookCommentReply &&
                          !commentState.deleted ? (
                            <div className="mt-3 max-w-[560px] rounded-xl border-l-[3px] border-blue-400 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              <div className="flex items-center gap-1.5 font-semibold text-slate-600">
                                <ReplyIcon />
                                <span>
                                  {isKhmer
                                    ? "ឆ្លើយតបទៅមតិយោបល់"
                                    : "Reply to comment"}
                                </span>
                              </div>
                              <div className="mt-1 truncate">
                                {facebookReplyPreviewText}
                              </div>
                            </div>
                          ) : null}

                          {commentState.deleted ? (
                            <div className="mt-3 inline-flex items-center gap-2 rounded-[14px] bg-slate-50 px-3.5 py-2.5 text-sm italic text-slate-400">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                className="h-4 w-4 shrink-0"
                                aria-hidden="true"
                              >
                                <path d="M4 7h16" strokeLinecap="round" />
                                <path d="M9 7V4h6v3" strokeLinecap="round" />
                                <path
                                  d="M6 7l1 13h10l1-13"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              <span>
                                Message deleted by commenter or Page
                              </span>
                            </div>
                          ) : (
                            <div
                              className={`mt-0.5 max-w-[680px] whitespace-pre-wrap text-[15px] leading-5 sm:text-base ${
                                isOutgoing
                                  ? "text-slate-900"
                                  : "text-slate-900"
                              }`}
                            >
                              {message.message_text ??
                                "Facebook comment"}
                            </div>
                          )}

                          {showCommentActions ? (
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium">
                              {!isOutgoing ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={commentState.deleted}
                                    onClick={() =>
                                      onReplyToComment(
                                        message.platform_message_id,
                                      )
                                    }
                                    className={`inline-flex items-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
                                      isReplyTarget
                                        ? "text-blue-600"
                                        : "text-slate-500 hover:text-blue-600"
                                    }`}
                                  >
                                    <ReplyIcon />
                                    <span>
                                      {isReplyTarget
                                        ? isKhmer
                                          ? "បានជ្រើស"
                                          : "Selected"
                                        : isKhmer
                                          ? "ឆ្លើយតប"
                                          : "Reply"}
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={commentState.deleted}
                                    onClick={() => void toggleLike()}
                                    className={`inline-flex items-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
                                      commentState.liked
                                        ? "text-blue-600"
                                        : "text-slate-500 hover:text-blue-600"
                                    }`}
                                  >
                                    <LikeIcon />
                                    <span>
                                      {commentState.liked
                                        ? isKhmer
                                          ? "ដកការចូលចិត្ត"
                                          : "Unlike"
                                        : isKhmer
                                          ? "ចូលចិត្ត"
                                          : "Like"}
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    disabled={commentState.deleted}
                                    onClick={() => void toggleHide()}
                                    className={`inline-flex items-center gap-1.5 transition disabled:cursor-not-allowed disabled:opacity-30 ${
                                      commentState.hidden
                                        ? "text-amber-600"
                                        : "text-slate-500 hover:text-amber-600"
                                    }`}
                                  >
                                    <HideIcon />
                                    <span>
                                      {commentState.hidden
                                        ? isKhmer
                                          ? "បង្ហាញវិញ"
                                          : "Unhide"
                                        : isKhmer
                                          ? "លាក់"
                                          : "Hide"}
                                    </span>
                                  </button>
                                </>
                              ) : null}

                              <button
                                type="button"
                                disabled={commentState.deleted}
                                onClick={() => void deleteComment()}
                                className="inline-flex items-center gap-1.5 text-slate-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  className="h-4 w-4"
                                  aria-hidden="true"
                                >
                                  <path d="M4 7h16" strokeLinecap="round" />
                                  <path d="M9 7V4h6v3" strokeLinecap="round" />
                                  <path
                                    d="M6 7l1 13h10l1-13"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <span>
                                  {isKhmer ? "លុប" : "Delete"}
                                </span>
                              </button>

                              {optimisticStatus === "failed" &&
                              onRetryMessage ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onRetryMessage(message.id)
                                  }
                                  className="font-semibold text-red-600 hover:underline"
                                >
                                  Retry
                                </button>
                              ) : null}
                            </div>
                          ) : null}

                          {facebookChildReplies.length > 0 ? (
                            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                              {facebookChildReplies.map((reply) => {
                                const replyServerState = {
                                  liked:
                                    reply.comment_is_liked ?? false,
                                  hidden:
                                    reply.comment_is_hidden ?? false,
                                  deleted:
                                    reply.comment_is_deleted ?? false,
                                  deletedBy:
                                    reply.comment_deleted_by ?? null,
                                };

                                const replyState =
                                  optimisticCommentState[reply.id] ??
                                  replyServerState;

                                const replyTimestamp =
                                  reply.platform_created_at ??
                                  reply.created_at;

                                const replyStatus = reply as InboxMessage & {
                                  __optimistic_status?:
                                    | "sending"
                                    | "sent"
                                    | "failed";
                                  delivery_status?:
                                    | "sent"
                                    | "delivered"
                                    | "seen"
                                    | null;
                                };

                                const replyDeletedByPage =
                                  replyState.deletedBy === "page" ||
                                  replyState.deletedBy === null;

                                if (replyState.deleted) {
                                  return (
                                    <div
                                      key={reply.id}
                                      ref={(node) => {
                                        if (node) {
                                          messageElementRefs.current.set(
                                            reply.id,
                                            node,
                                          );
                                        } else {
                                          messageElementRefs.current.delete(
                                            reply.id,
                                          );
                                        }
                                      }}
                                      className="ml-11 w-fit rounded-xl bg-slate-50 px-3 py-2 text-[13px] italic text-slate-400 sm:ml-14"
                                    >
                                      {replyDeletedByPage
                                        ? isKhmer
                                          ? "សារត្រូវបានលុបដោយទំព័រ"
                                          : "Message deleted by Page"
                                        : isKhmer
                                          ? "សារត្រូវបានលុបដោយអ្នកបញ្ចេញមតិ"
                                          : "Message deleted by commenter"}
                                    </div>
                                  );
                                }

                                return (
                                  <div
                                    key={reply.id}
                                    ref={(node) => {
                                      if (node) {
                                        messageElementRefs.current.set(
                                          reply.id,
                                          node,
                                        );
                                      } else {
                                        messageElementRefs.current.delete(
                                          reply.id,
                                        );
                                      }
                                    }}
                                    className="ml-7 flex gap-2.5 sm:ml-10"
                                  >
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-[0_4px_12px_rgba(37,99,235,0.18)]">
                                      {headerChannelAccountName
                                        .trim()
                                        .charAt(0)
                                        .toUpperCase() || "?"}
                                    </div>

                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <span className="text-[14px] font-bold text-slate-950">
                                          {headerChannelAccountName}
                                        </span>
                                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                                          {isKhmer ? "អ្នក" : "You"}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                          <HydrationSafeMessageTime
                                            value={replyTimestamp}
                                          />
                                        </span>
                                        <span className="text-[10px] font-medium text-slate-400">
                                          {replyStatus.__optimistic_status ===
                                          "sending"
                                            ? "Sending..."
                                            : replyStatus.__optimistic_status ===
                                                "failed"
                                              ? "Failed to send"
                                              : replyStatus.delivery_status ===
                                                  "seen"
                                                ? "✓✓ Seen"
                                                : replyStatus.delivery_status ===
                                                    "delivered"
                                                  ? "✓✓ Delivered"
                                                  : "✓ Sent"}
                                        </span>
                                      </div>

                                      <div className="mt-0.5 max-w-[620px] whitespace-pre-wrap text-[15px] leading-5 text-slate-900">
                                        {reply.message_text ??
                                          "Facebook comment reply"}
                                      </div>

                                      {reply.platform_message_id &&
                                      !reply.id.startsWith(
                                        "optimistic:",
                                      ) ? (
                                        <div className="mt-1.5 flex items-center gap-3 text-[12px] font-medium">
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              const previous = replyState;

                                              setOptimisticCommentState(
                                                (current) => ({
                                                  ...current,
                                                  [reply.id]: {
                                                    ...replyState,
                                                    deleted: true,
                                                    deletedBy: "page",
                                                  },
                                                }),
                                              );

                                              const result =
                                                await onDeleteComment(
                                                  reply.platform_message_id,
                                                );

                                              if (!result.success &&
                                                  !result.deleted) {
                                                setOptimisticCommentState(
                                                  (current) => ({
                                                    ...current,
                                                    [reply.id]: previous,
                                                  }),
                                                );
                                                return;
                                              }

                                              showActionNotice(
                                                "Comment deleted successfully",
                                              );
                                            }}
                                            className="inline-flex items-center gap-1.5 text-slate-500 transition hover:text-red-600"
                                          >
                                            <svg
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="1.8"
                                              className="h-3.5 w-3.5"
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
                                              {isKhmer ? "លុប" : "Delete"}
                                            </span>
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                );
              }

              return (
                <Fragment key={message.id}>
                  {showMessageDay ? (
                    <div className="flex items-center gap-3 py-1">
                      <div className="h-px flex-1 bg-blue-200/70" />
                      <span className="rounded-full border border-blue-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-blue-700 shadow-sm">
                        <HydrationSafeMessageDay
                          value={messageTimestamp}
                        />
                      </span>
                      <div className="h-px flex-1 bg-blue-200/70" />
                    </div>
                  ) : null}

                <div
                  ref={(node) => {
                    if (node) {
                      messageElementRefs.current.set(
                        message.id,
                        node,
                      );
                    } else {
                      messageElementRefs.current.delete(
                        message.id,
                      );
                    }
                  }}
                  className={`flex ${
                    isOutgoing
                      ? "justify-end"
                      : "justify-start"
                  }`}
                  onContextMenu={(event) => {
                    if (
                      !isTelegramMessage ||
                      (!canReplyToTelegram &&
                        !canEditTelegram &&
                        !canDeleteTelegram)
                    ) {
                      return;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    const menuWidth = 176;
                    const menuHeight = 48;
                    const edge = 10;

                    const x = Math.min(
                      event.clientX,
                      window.innerWidth - menuWidth - edge,
                    );

                    const y = Math.min(
                      event.clientY,
                      window.innerHeight - menuHeight - edge,
                    );

                    setTelegramContextMenu({
                      messageId: message.id,
                      messageText:
                        message.message_text ?? "",
                      x: Math.max(edge, x),
                      y: Math.max(edge, y),
                      canReply: canReplyToTelegram,
                      canEdit: canEditTelegram,
                      canDelete: canDeleteTelegram,
                    });
                  }}
                >
                  <div className="group max-w-[84%] sm:max-w-[74%] xl:max-w-[62%]">
                    <div
                      className={`overflow-hidden border text-sm shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition ${
                        isOutgoing
                          ? "rounded-[18px] rounded-br-[5px] text-white"
                          : "rounded-[18px] rounded-bl-[5px] border-slate-200/90 bg-white text-slate-900"
                      } ${
                        isJumpHighlighted
                          ? "ring-2 ring-amber-400 ring-offset-2 shadow-[0_0_0_6px_rgba(251,191,36,0.12)]"
                          : isReplyTarget ||
                              isTelegramReplyTarget
                            ? "ring-2 ring-blue-400 ring-offset-2"
                            : ""
                      }`}
                      style={
                        isOutgoing
                          ? {
                              backgroundColor:
                                "var(--tenh-primary, #2563EB)",
                              borderColor:
                                "var(--tenh-primary, #2563EB)",
                              color: "#FFFFFF",
                            }
                          : undefined
                      }
                    >
                      {/* Message content */}
                      <div className="px-4 pb-2 pt-3">
                        {telegramReplyPreview ? (
                          <button
                            type="button"
                            disabled={
                              !canJumpToTelegramReply
                            }
                            onClick={(event) => {
                              event.stopPropagation();

                              if (
                                !canJumpToTelegramReply
                              ) {
                                return;
                              }

                              void jumpToTelegramReplyTarget({
                                localMessageId:
                                  telegramReplyLocalMessageId,
                                platformMessageId:
                                  telegramReplyTargetPlatformMessageId,
                              });
                            }}
                            className={`mb-2.5 block w-full border-l-[3px] pl-2.5 text-left text-xs transition ${
                              isOutgoing
                                ? "border-emerald-500"
                                : "border-sky-500"
                            } ${
                              canJumpToTelegramReply
                                ? "cursor-pointer rounded-r-lg py-1 pr-2 hover:bg-black/[0.035] active:bg-black/[0.06]"
                                : "cursor-default"
                            }`}
                            title={
                              canJumpToTelegramReply
                                ? "Go to original message"
                                : undefined
                            }
                          >
                            <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                              <ReplyIcon />
                              <span>
                                Reply to {telegramReplyPreview.kind}
                              </span>
                            </span>
                            <span className="mt-0.5 block max-w-[320px] truncate leading-4 text-slate-500">
                              {telegramReplyPreview.text}
                            </span>
                          </button>
                        ) : null}

                        {facebookReplyParentId &&
                        !commentState.deleted ? (
                          <div
                            className={`mb-2.5 block w-full border-l-[3px] pl-2.5 text-left text-xs ${
                              isOutgoing
                                ? "border-emerald-500"
                                : "border-sky-500"
                            }`}
                          >
                            <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                              <ReplyIcon />
                              <span>
                                Reply to comment
                              </span>
                            </span>
                            <span className="mt-0.5 block max-w-[320px] truncate leading-4 text-slate-500">
                              {facebookReplyPreviewText}
                            </span>
                          </div>
                        ) : null}

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
                              Message deleted by commenter or Page
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
                                      {isKhmer ? "Facebook Post" : "Facebook Post"}
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
                                {isKhmer ? "Facebook comments" : "Facebook Comment"}
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
                                  {isKhmer ? "View Post" : "View Post"}
                                  <span
                                    aria-hidden="true"
                                  >
                                    ↗
                                  </span>
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ) : isLocationMessage &&
                          locationUrl ? (
                          <a
                            href={locationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block min-w-[260px] rounded-xl border border-slate-200 bg-white/90 p-3 transition hover:bg-white"
                          >
                            <div className="flex items-start gap-3">
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl">
                                📍
                              </span>

                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-800">
                                  Shared location
                                </span>

                                <span className="mt-1 block text-xs text-slate-500">
                                  {locationLatitude?.toFixed(
                                    6,
                                  )}
                                  {", "}
                                  {locationLongitude?.toFixed(
                                    6,
                                  )}
                                </span>

                                <span className="mt-2 inline-flex text-xs font-medium text-blue-600">
                                  Open in Maps ↗
                                </span>
                              </span>
                            </div>
                          </a>
                        ) : isStickerMessage ? (
                          <div className="min-w-[180px]">
                            {attachmentUrl &&
                            stickerMeta
                              ?.preview_kind ===
                              "video" ? (
                              <video
                                src={attachmentUrl}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="max-h-56 max-w-[240px] rounded-xl bg-transparent object-contain"
                              />
                            ) : attachmentUrl &&
                              stickerMeta
                                ?.preview_kind ===
                                "image" ? (
                              <img
                                src={attachmentUrl}
                                alt={
                                  stickerMeta?.emoji
                                    ? `Telegram sticker ${stickerMeta.emoji}`
                                    : "Telegram sticker"
                                }
                                className="max-h-56 max-w-[240px] rounded-xl object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex min-h-32 min-w-[180px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white/80 p-4">
                                <span className="text-4xl">
                                  {stickerMeta?.emoji ??
                                    "✨"}
                                </span>
                                <span className="mt-2 text-xs font-medium text-slate-500">
                                  {stickerMeta?.format ===
                                  "animated"
                                    ? "Animated sticker"
                                    : "Telegram sticker"}
                                </span>
                              </div>
                            )}

                            {stickerMeta?.emoji ? (
                              <p className="mt-1 text-center text-xs text-slate-500">
                                {stickerMeta.emoji}
                              </p>
                            ) : null}
                          </div>
                        ) : isImageMessage ? (
                          <div className="w-[300px] max-w-full overflow-hidden rounded-[22px] bg-slate-100 ring-1 ring-slate-200/70">
                            {attachmentUrl ? (
                              <a
                                href={attachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="group/media block"
                              >
                                <img
                                  src={attachmentUrl}
                                  alt={attachmentName}
                                  className="max-h-[360px] w-full object-cover transition duration-200 group-hover/media:scale-[1.01]"
                                  loading="lazy"
                                  decoding="async"
                                />
                              </a>
                            ) : (
                              <div className="flex h-40 w-full items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-slate-50 text-sm font-medium text-slate-500">
                                Photo unavailable
                              </div>
                            )}
                          </div>
                        ) : isAnimationMessage ? (
                          <div className="min-w-[220px]">
                            {attachmentUrl ? (
                              animationMeta?.format ===
                              "gif" ? (
                                <img
                                  src={attachmentUrl}
                                  alt={attachmentName}
                                  className="max-h-80 max-w-full rounded-xl object-contain"
                                  loading="lazy"
                                />
                              ) : (
                                <video
                                  src={attachmentUrl}
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  className="max-h-80 w-full rounded-xl bg-black object-contain"
                                />
                              )
                            ) : (
                              <div className="flex h-40 min-w-[240px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium text-slate-500">
                                Animation sent
                              </div>
                            )}

                            <p className="mt-2 truncate text-xs text-slate-500">
                              {attachmentName}
                            </p>
                          </div>
                        ) : isVideoMessage ? (
                          <div className="w-[330px] max-w-full overflow-hidden rounded-[22px] border border-slate-200/80 bg-slate-950 shadow-sm">
                            {attachmentUrl ? (
                              <video
                                src={attachmentUrl}
                                controls
                                preload="none"
                                playsInline
                                className="max-h-[360px] w-full bg-black object-contain"
                              />
                            ) : (
                              <div className="flex h-44 w-full items-center justify-center bg-slate-900 text-sm font-medium text-slate-300">
                                Video unavailable
                              </div>
                            )}
                          </div>
                        ) : isAudioMessage ||
                          isVoiceMessage ? (
                          attachmentUrl ? (
                            <CompactAudioPlayer
                              src={attachmentUrl}
                              label={attachmentName}
                              isVoice={isVoiceMessage}
                            />
                          ) : (
                            <div className="flex w-[290px] max-w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                                <VoiceIcon />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-700">
                                  {isVoiceMessage
                                    ? "Voice message"
                                    : attachmentName}
                                </p>
                                <p className="mt-0.5 text-xs text-slate-400">
                                  Audio unavailable
                                </p>
                              </div>
                            </div>
                          )
                        ) : isFileMessage ? (
                          attachmentUrl ? (
                            <a
                              href={attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block w-[320px] max-w-full rounded-[22px] border border-slate-200/90 bg-white/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-sky-200 hover:bg-white"
                            >
                              <div className="flex items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                                  <FileIcon />
                                </span>

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-slate-800">
                                    {attachmentName}
                                  </p>
                                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                    {[
                                      attachmentMeta?.mime_type?.split("/").pop()?.toUpperCase(),
                                      formatAttachmentSize(attachmentMeta?.size),
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") || "Telegram file"}
                                  </p>
                                </div>
                              </div>
                            </a>
                          ) : (
                            <div className="w-[320px] max-w-full rounded-[22px] border border-slate-200/90 bg-white/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                              <div className="flex items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                                  <FileIcon />
                                </span>

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-slate-800">
                                    {attachmentName}
                                  </p>
                                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                    Unavailable
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        ) : telegramDeleted ? (
                          <p className="whitespace-pre-wrap italic text-slate-500">
                            Message deleted
                          </p>
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
                          <span
                            className={
                              isOutgoing
                                ? "text-white/75"
                                : "text-slate-500"
                            }
                          >
                            <HydrationSafeMessageTime
                              value={messageTimestamp}
                            />
                          </span>

                          {telegramEdited &&
                          !telegramDeleted ? (
                            <span
                              className={
                                isOutgoing
                                  ? "text-white/70"
                                  : "text-slate-400"
                              }
                            >
                              Edited
                            </span>
                          ) : null}

                          {isOutgoing &&
                          !telegramDeleted ? (
                            optimisticStatus ===
                            "sending" ? (
                              <span className="inline-flex items-center gap-1 text-white/80">
                                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/60 border-t-transparent" />
                                Sending...
                              </span>
                            ) : optimisticStatus ===
                              "failed" ? (
                              <>
                                <span className="font-medium text-white">
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
                                    className="font-semibold text-white underline underline-offset-2 hover:opacity-90"
                                  >
                                    Retry
                                  </button>
                                ) : null}
                              </>
                            ) : isTelegramMessage ? (
                              <span
                                className="font-medium text-white/85"
                                title="Accepted by Telegram Bot API. Telegram does not provide delivery/read receipts for this private bot chat."
                              >
                                ✓ Sent
                              </span>
                            ) : persistedDeliveryStatus ===
                              "seen" ? (
                              <span
                                className="font-semibold text-white"
                                title="Seen"
                              >
                                ✓✓ Seen
                              </span>
                            ) : persistedDeliveryStatus ===
                              "delivered" ? (
                              <span
                                className="font-medium text-white/85"
                                title="Delivered"
                              >
                                ✓✓ Delivered
                              </span>
                            ) : (
                              <span className="font-medium text-white/85">
                                ✓ Sent
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>

                      {/* Facebook Comment Actions */}
                    </div>

                    <div>

                      {showCommentActions ? (
                        <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-1.5">

                          {!isOutgoing ? (
                            <>
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
                                ? isKhmer ? "ដកការចូលចិត្ត" : "Unlike"
                                : isKhmer ? "ចូលចិត្ត" : "Like"
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
                                ? isKhmer ? "បានជ្រើស" : "Selected"
                                : isKhmer ? "ឆ្លើយតប" : "Reply"
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
                                ? isKhmer ? "បង្ហាញវិញ" : "Unhide"
                                : isKhmer ? "លាក់" : "Hide"
                            }
                          />
                          </div>
                          </>
                          ) : null}

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
                            title={
                              isOutgoing
                                ? "Delete reply"
                                : "Delete comment"
                            }
                            aria-label={
                              isOutgoing
                                ? "Delete reply"
                                : "Delete comment"
                            }
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
                          <ActionTooltip
                            label={
                              isOutgoing
                                ? isKhmer ? "លុបការឆ្លើយតប" : "Delete reply"
                                : isKhmer ? "លុប" : "Delete"
                            }
                          />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                </Fragment>
              );
            },
          )}
          </div>
        </div>

        {newMessageCount > 0 ? (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2">
            <button
              type="button"
              onClick={() =>
                scrollToNewest(
                  "smooth",
                )
              }
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-lg transition hover:bg-blue-50 active:scale-[0.98]"
              aria-label="Scroll to newest messages"
            >
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-bold text-white">
                {newMessageCount}
              </span>

              <span>
                {newMessageCount === 1
                  ? isKhmer ? "សារថ្មី" : "New message"
                  : isKhmer ? "សារថ្មី" : "New messages"}
              </span>

              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  d="m6 9 6 6 6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ) : showScrollToLatest ? (
          <div className="pointer-events-none absolute bottom-4 right-4 z-40">
            <button
              type="button"
              onClick={() =>
                scrollToNewest(
                  "smooth",
                )
              }
              className="pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 active:scale-[0.97]"
              aria-label="Scroll to latest message"
              title="Latest message"
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
                  d="m6 9 6 6 6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <span>Latest</span>
            </button>
          </div>
        ) : null}
      </div>

      {editingTelegramMessageId ? (
        <div className="shrink-0 border-t border-sky-100 bg-sky-50/60 px-4 py-2">
          <div className="flex items-center gap-3 rounded-xl border border-sky-200/80 bg-white px-3 py-2 shadow-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <EditIcon />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-sky-700">
                Editing message
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {messages.find(
                  (message) =>
                    message.id ===
                    editingTelegramMessageId,
                )?.message_text ??
                  "Edit the message below"}
              </p>
            </div>

            <span className="hidden text-[11px] font-medium text-slate-400 sm:inline">
              {isKhmer ? "ផ្ញើដើម្បីរក្សាទុក" : "Send to save"}
            </span>

            <button
              type="button"
              onClick={onCancelTelegramEdit}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="Cancel edit"
              aria-label="Cancel edit"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {/* Facebook comment reply target — UI only. Keep reply behavior unchanged. */}
      {replyingToCommentId ? (
        <div className="shrink-0 bg-white px-3 pt-3 sm:px-5 sm:pt-4">
          <div className="flex min-h-[76px] items-center gap-4 rounded-[20px] border border-blue-100 bg-gradient-to-r from-blue-50/90 via-white to-blue-50/45 px-4 py-3 shadow-[0_1px_5px_rgba(37,99,235,0.08)] sm:px-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 sm:h-14 sm:w-14">
              <ReplyIcon />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold leading-5 text-blue-600 sm:text-base">
                {isKhmer ? "កំពុងឆ្លើយតបទៅ" : "Replying to"} {replyingToName}
              </p>

              <p className="mt-1 truncate text-[15px] leading-5 text-slate-700 sm:text-base">
                {replyingToMessage
                  ?.message_text ??
                  "Selected Facebook comment"}
              </p>
            </div>

            <button
              type="button"
              onClick={onCancelCommentReply}
              className="group/action relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/90 hover:text-slate-700"
              title="Cancel reply"
              aria-label="Cancel reply"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path
                  d="M6 6l12 12M18 6 6 18"
                  strokeLinecap="round"
                />
              </svg>

              <ActionTooltip label="Cancel reply" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Reply composer */}
      {activeConversation.contact ? (
        /*
         * V3.11.30.1 — Messenger DMs and Facebook comments can share one
         * thread. The normal composer stays available. Clicking Reply on a
         * comment switches only that send into a targeted comment reply.
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
          onTagsChange={(tags) =>
            onContactTagsChange?.(
              activeConversation.contact!.id,
              tags,
            )
          }
          typingAgents={
            typingAgents
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
          onSendAttachments={
            onSendAttachments
          }
          allowAttachments={
            !replyingToCommentId
          }
        />
      ) : null}

    </section>
  );
}