"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
/*
 * Theme 1 is the product default for every workspace, including brand-new
 * accounts that have never opened Display settings. This used to point at
 * /images/chat-bg.png, so a new user saw one background in the Inbox while
 * Display showed "Theme 1" as the selected option.
 */
const DEFAULT_CHAT_BACKGROUND_SRC = "/images/bg-theme1.png";


function isMessengerPolicyRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function messengerPolicyString(
  value: unknown,
) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function isFacebookCommentInboxMessage(
  message: InboxMessage,
) {
  const payload = message.raw_payload;

  if (!isMessengerPolicyRecord(payload)) {
    return false;
  }

  const source =
    messengerPolicyString(payload.source)?.toLowerCase() ?? "";
  const tenhSource =
    messengerPolicyString(payload.tenh_source)?.toLowerCase() ?? "";

  return (
    messengerPolicyString(payload.item)?.toLowerCase() === "comment" ||
    Boolean(messengerPolicyString(payload.comment_id)) ||
    source === "facebook_comment_reply" ||
    tenhSource.includes("comment_reply") ||
    tenhSource === "facebook_page_reply"
  );
}

function isDirectFacebookMessengerInboundMessage(
  message: InboxMessage,
) {
  if (message.direction !== "incoming") {
    return false;
  }

  const payload = message.raw_payload;

  if (!isMessengerPolicyRecord(payload)) {
    return false;
  }

  const messengerMessage = payload.message;

  if (!isMessengerPolicyRecord(messengerMessage)) {
    return false;
  }

  return (
    Boolean(messengerPolicyString(messengerMessage.mid)) &&
    messengerMessage.is_echo !== true
  );
}

function isDirectFacebookMessengerOutgoingMessage(
  message: InboxMessage,
) {
  if (message.direction !== "outgoing") {
    return false;
  }

  const optimisticStatus =
    (message as InboxMessage & {
      __optimistic_status?: string;
    }).__optimistic_status;

  if (optimisticStatus === "failed") {
    return false;
  }

  return !isFacebookCommentInboxMessage(message);
}

function inboxMessageTimestampMs(
  message: InboxMessage,
) {
  const value =
    message.platform_created_at ?? message.created_at;

  return value ? Date.parse(value) : Number.NaN;
}

type FacebookMessengerComposerState =
  | "standard"
  | "human_agent"
  | "expired"
  | "private_reply_available"
  | "waiting_for_customer_reply"
  | "unknown";

function getFacebookMessengerComposerState(
  messages: InboxMessage[],
): FacebookMessengerComposerState {
  let latestDirectIncomingMs = Number.NaN;
  let latestIncomingCommentMs = Number.NaN;
  let latestDirectOutgoingMs = Number.NaN;

  for (const message of messages) {
    const timestamp = inboxMessageTimestampMs(message);

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    if (
      isDirectFacebookMessengerInboundMessage(message) &&
      (!Number.isFinite(latestDirectIncomingMs) ||
        timestamp > latestDirectIncomingMs)
    ) {
      latestDirectIncomingMs = timestamp;
    }

    if (
      message.direction === "incoming" &&
      isFacebookCommentInboxMessage(message) &&
      (!Number.isFinite(latestIncomingCommentMs) ||
        timestamp > latestIncomingCommentMs)
    ) {
      latestIncomingCommentMs = timestamp;
    }

    if (
      isDirectFacebookMessengerOutgoingMessage(message) &&
      (!Number.isFinite(latestDirectOutgoingMs) ||
        timestamp > latestDirectOutgoingMs)
    ) {
      latestDirectOutgoingMs = timestamp;
    }
  }

  const nowMs = Date.now();
  const standardWindowMs = 24 * 60 * 60 * 1000;
  const humanAgentWindowMs = 7 * 24 * 60 * 60 * 1000;

  const latestDirectIncomingAgeMs =
    Number.isFinite(latestDirectIncomingMs)
      ? nowMs - latestDirectIncomingMs
      : Number.NaN;

  const latestCommentIsNewerThanDirectIncoming =
    Number.isFinite(latestIncomingCommentMs) &&
    (!Number.isFinite(latestDirectIncomingMs) ||
      latestIncomingCommentMs > latestDirectIncomingMs);

  const pageAlreadySentAfterLatestComment =
    latestCommentIsNewerThanDirectIncoming &&
    Number.isFinite(latestDirectOutgoingMs) &&
    latestDirectOutgoingMs >= latestIncomingCommentMs;

  if (
    latestCommentIsNewerThanDirectIncoming &&
    pageAlreadySentAfterLatestComment
  ) {
    return "waiting_for_customer_reply";
  }

  if (latestCommentIsNewerThanDirectIncoming) {
    return "private_reply_available";
  }

  if (
    Number.isFinite(latestDirectIncomingAgeMs) &&
    latestDirectIncomingAgeMs >= 0 &&
    latestDirectIncomingAgeMs < standardWindowMs
  ) {
    return "standard";
  }

  if (
    Number.isFinite(latestDirectIncomingAgeMs) &&
    latestDirectIncomingAgeMs >= standardWindowMs &&
    latestDirectIncomingAgeMs < humanAgentWindowMs
  ) {
    return "human_agent";
  }

  if (
    Number.isFinite(latestDirectIncomingAgeMs) &&
    latestDirectIncomingAgeMs >= humanAgentWindowMs
  ) {
    return "expired";
  }

  return "unknown";
}

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
  isOutgoing = false,
}: {
  src: string;
  label: string;
  isVoice: boolean;
  isOutgoing?: boolean;
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

  const remaining = Math.max(0, duration - currentTime);

  /*
   * No card of its own. The message bubble is already a container, so a
   * second bordered panel inside it just doubled the padding and, on an
   * outgoing bubble, dropped a white box onto the blue. These are bare
   * controls that inherit the bubble they sit in.
   */
  return (
    <div className="flex w-[218px] max-w-full items-center gap-2.5">
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

      <button
        type="button"
        onClick={togglePlayback}
        suppressHydrationWarning
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
          isOutgoing
            ? "bg-white/25 text-white hover:bg-white/35"
            : "bg-sky-600 text-white hover:bg-sky-700"
        }`}
        aria-label={playing ? "Pause audio" : "Play audio"}
      >
        <PlayIcon paused={!playing} />
      </button>

      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.01}
        value={Math.min(currentTime, duration > 0 ? duration : 1)}
        onChange={(event) =>
          seek(Number(event.target.value))
        }
        className={`h-1 min-w-0 flex-1 cursor-pointer ${
          isOutgoing ? "accent-white" : "accent-sky-600"
        }`}
        aria-label={isVoice ? "Voice message progress" : label || "Audio progress"}
      />

      {/* Counts down while playing, like every other voice note. */}
      <span
        className={`shrink-0 text-right text-[11px] tabular-nums ${
          isOutgoing ? "text-white/80" : "text-slate-500"
        }`}
      >
        {formatAudioTime(playing || currentTime > 0 ? remaining : duration)}
      </span>
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

type FacebookCommentGroupPayload = {
  item?: string;
  source?: string;
  tenh_source?: string;
  post_id?: string;
  post?: { id?: string } | null;
  post_preview?: { id?: string } | null;
  comment_id?: string;
  parent_id?: string;
  parent_comment_id?: string;
  reply_comment_id?: string;
};

function getSafeFacebookCommentGroupInfo(
  message: InboxMessage,
) {
  const payload =
    message.raw_payload as FacebookCommentGroupPayload | null;

  const postId =
    payload?.post_id?.trim() ||
    payload?.post?.id?.trim() ||
    payload?.post_preview?.id?.trim() ||
    null;

  const isFacebookComment = Boolean(
    payload?.comment_id ||
      payload?.post_id ||
      payload?.item === "comment" ||
      payload?.source === "facebook_comment_reply" ||
      payload?.tenh_source === "facebook_page_reply" ||
      payload?.parent_comment_id ||
      payload?.reply_comment_id,
  );

  const rawParentId =
    typeof payload?.parent_comment_id === "string"
      ? payload.parent_comment_id.trim()
      : typeof payload?.parent_id === "string"
        ? payload.parent_id.trim()
        : null;

  // Meta may set parent_id to the post itself for a top-level comment.
  // Only a different ID is a real nested comment parent.
  const parentCommentId =
    rawParentId && rawParentId !== postId
      ? rawParentId
      : null;

  const senderId =
    typeof message.sender_platform_id === "string"
      ? message.sender_platform_id.trim()
      : null;

  const isDeleted =
    message.comment_is_deleted === true;

  /*
   * Safety rule for visual grouping:
   * - exact Facebook post ID
   * - exact incoming customer sender ID
   * - top-level comment only
   * - deleted roots never keep a future comment attached to an old card
   *
   * If any identity is missing, do not group. This intentionally prefers
   * separate cards over ever mixing two customers or two posts. Excluding
   * deleted roots also means that after an old thread is fully deleted, the
   * next real comment becomes a fresh group start and shows the post preview
   * again.
   */
  const groupKey =
    isFacebookComment &&
    message.direction === "incoming" &&
    postId &&
    senderId &&
    !parentCommentId &&
    !isDeleted
      ? `${postId}::${senderId}`
      : null;

  return {
    isFacebookComment,
    parentCommentId,
    groupKey,
  };
}



type FacebookThreadReply = {
  reply: InboxMessage;
  depth: number;
};

function collectFacebookCommentDescendants(
  messages: InboxMessage[],
  rootPlatformMessageId: string,
): FacebookThreadReply[] {
  const childrenByParent = new Map<string, InboxMessage[]>();

  for (const candidate of messages) {
    const info = getSafeFacebookCommentGroupInfo(candidate);

    if (!info.isFacebookComment || !info.parentCommentId) {
      continue;
    }

    const existing = childrenByParent.get(info.parentCommentId) ?? [];
    existing.push(candidate);
    childrenByParent.set(info.parentCommentId, existing);
  }

  const result: FacebookThreadReply[] = [];
  const visited = new Set<string>();

  const visit = (parentId: string, depth: number) => {
    const children = childrenByParent.get(parentId) ?? [];

    for (const child of children) {
      const visitKey =
        child.platform_message_id?.trim() ||
        child.id;

      if (visited.has(visitKey)) {
        continue;
      }

      visited.add(visitKey);
      result.push({
        reply: child,
        depth,
      });

      const childPlatformId = child.platform_message_id?.trim();
      if (childPlatformId) {
        visit(childPlatformId, Math.min(depth + 1, 6));
      }
    }
  };

  visit(rootPlatformMessageId, 1);
  return result;
}

function findNeighborFacebookRootGroupKey(
  messages: InboxMessage[],
  startIndex: number,
  step: -1 | 1,
) {
  for (
    let index = startIndex;
    index >= 0 && index < messages.length;
    index += step
  ) {
    const info =
      getSafeFacebookCommentGroupInfo(messages[index]);

    // Nested replies belong to their exact parent and do not break a post group.
    if (info.isFacebookComment && info.parentCommentId) {
      continue;
    }

    // A DM/Telegram/system item or another root comment is a real boundary.
    return info.isFacebookComment
      ? info.groupKey
      : null;
  }

  return null;
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

  const facebookMessengerComposerState =
    activeConversation?.social_account?.platform === "facebook" &&
    !replyingToCommentId
      ? getFacebookMessengerComposerState(messages)
      : "unknown";

  const facebookWaitingForCustomerReply =
    facebookMessengerComposerState ===
    "waiting_for_customer_reply";
  const facebookMessengerWindowExpired =
    facebookMessengerComposerState === "expired";
  const facebookMessengerBlockedTitle =
    facebookWaitingForCustomerReply
      ? isKhmer
        ? "កំពុងរង់ចាំអតិថិជនឆ្លើយតប"
        : "Waiting for customer reply"
      : facebookMessengerWindowExpired
        ? isKhmer
          ? "រយៈពេលផ្ញើសារ 7 ថ្ងៃបានផុតកំណត់"
          : "Waiting for customer reply"
        : null;

  const facebookMessengerBlockedReason =
    facebookWaitingForCustomerReply
      ? isKhmer
        ? "Meta អនុញ្ញាតឱ្យផ្ញើសារឯកជនតែមួយប៉ុណ្ណោះបន្ទាប់ពីមតិយោបល់ Facebook។ សូមរង់ចាំអតិថិជនឆ្លើយតបក្នុង Messenger មុនពេលផ្ញើសារបន្ទាប់។"
        : "Meta allows only one private Messenger reply after a Facebook comment. Wait for the customer to reply in Messenger before sending another message."
      : facebookMessengerWindowExpired
        ? isKhmer
          ? "លើស 7 ថ្ងៃចាប់តាំងពីសារ Messenger ចុងក្រោយរបស់អតិថិជន។ សូមរង់ចាំអតិថិជនផ្ញើសារថ្មីមកវិញ មុនពេលឆ្លើយតប។"
          : "7 days have passed since the customer's last Messenger message. Meta only allows another private message after the customer sends a new message."
        : null;

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

  const [
    commentConfirmTarget,
    setCommentConfirmTarget,
  ] = useState<
    | {
        kind: "delete" | "hide" | "unhide";
        messageId: string;
        platformMessageId: string;
        previous: {
          liked: boolean;
          hidden: boolean;
          deleted: boolean;
          deletedBy:
            | "customer"
            | "page"
            | null;
        };
      }
    | null
  >(null);

  const [
    commentConfirmLoading,
    setCommentConfirmLoading,
  ] = useState(false);

  const [imagePreview, setImagePreview] =
    useState<{
      src: string;
      alt: string;
    } | null>(null);

  useEffect(() => {
    if (!imagePreview) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImagePreview(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [imagePreview]);

  useEffect(() => {
    setImagePreview(null);
  }, [activeConversation?.id]);

  useEffect(() => {
    setCommentConfirmTarget(null);
    setCommentConfirmLoading(false);
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!commentConfirmTarget) {
      return;
    }

    function handleCommentConfirmKeyDown(
      event: KeyboardEvent,
    ) {
      if (
        event.key === "Escape" &&
        !commentConfirmLoading
      ) {
        setCommentConfirmTarget(null);
      }
    }

    window.addEventListener(
      "keydown",
      handleCommentConfirmKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleCommentConfirmKeyDown,
      );
    };
  }, [
    commentConfirmLoading,
    commentConfirmTarget,
  ]);

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

  const userNearBottomRef =
    useRef(true);

  /*
   * True while a scroll we started is still animating. A smooth scroll fires
   * scroll events at every intermediate position, and those look exactly like
   * the agent scrolling away — which would clear userNearBottomRef and cancel
   * the follow-up pins that exist to catch late-loading media.
   */
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef =
    useRef<number | null>(null);

  useEffect(
    () => () => {
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(
          programmaticScrollTimerRef.current,
        );
      }
    },
    [],
  );

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

  /*
   * Photo albums.
   *
   * A message carries a single attachment, so sending six photos creates six
   * messages. Rendered one bubble each they filled the thread; grouped they
   * read as one album. Consecutive image messages from the same side, sent
   * close together, are collected into a run and drawn as a grid on the run's
   * LAST message — last so the album sits where the sending finished, and so
   * the timestamp and delivery status shown are the newest ones.
   *
   * Every photo keeps its own message id, so opening, replying to and
   * deleting a single photo all still act on the right message.
   */
  const photoGroups = useMemo(() => {
    const ALBUM_WINDOW_MS = 60_000;
    const groups = new Map<
      string,
      { lastId: string; members: InboxMessage[] }
    >();

    let run: InboxMessage[] = [];

    const flush = () => {
      if (run.length > 1) {
        const lastId = run[run.length - 1].id;
        const members = run;

        for (const item of members) {
          groups.set(item.id, { lastId, members });
        }
      }

      run = [];
    };

    for (const message of messages) {
      const isPhoto =
        message.message_type === "image" &&
        Boolean(message.attachment_url);

      if (!isPhoto) {
        flush();
        continue;
      }

      const previous = run[run.length - 1];

      if (previous) {
        const sameSide =
          previous.direction === message.direction;
        const previousAt = new Date(
          previous.platform_created_at ??
            previous.created_at,
        ).getTime();
        const currentAt = new Date(
          message.platform_created_at ??
            message.created_at,
        ).getTime();
        const closeEnough =
          Number.isFinite(previousAt) &&
          Number.isFinite(currentAt) &&
          Math.abs(currentAt - previousAt) <=
            ALBUM_WINDOW_MS;

        if (!sameSide || !closeEnough) {
          flush();
        }
      }

      run.push(message);
    }

    flush();

    return groups;
  }, [messages]);

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

        programmaticScrollRef.current = true;

        if (programmaticScrollTimerRef.current !== null) {
          window.clearTimeout(
            programmaticScrollTimerRef.current,
          );
        }

        programmaticScrollTimerRef.current =
          window.setTimeout(
            () => {
              programmaticScrollRef.current = false;
              programmaticScrollTimerRef.current = null;
            },
            behavior === "smooth" ? 700 : 90,
          );

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

    /* Our own animation, not the agent moving the thread. */
    if (programmaticScrollRef.current) {
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

  async function confirmCommentAction() {
    if (
      !commentConfirmTarget ||
      commentConfirmLoading
    ) {
      return;
    }

    const target = commentConfirmTarget;
    const previous = target.previous;

    setCommentConfirmLoading(true);
    setCommentConfirmTarget(null);

    try {
      if (target.kind === "delete") {
        setOptimisticCommentState(
          (current) => ({
            ...current,
            [target.messageId]: {
              ...previous,
              deleted: true,
              deletedBy: "page",
            },
          }),
        );

        const result =
          await onDeleteComment(
            target.platformMessageId,
          );

        if (result.deleted) {
          setOptimisticCommentState(
            (current) => ({
              ...current,
              [target.messageId]: {
                ...previous,
                liked: false,
                hidden: false,
                deleted: true,
                deletedBy: "customer",
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
              [target.messageId]: previous,
            }),
          );
          return;
        }

        showActionNotice(
          "Comment deleted successfully",
        );
        return;
      }

      const nextHidden =
        target.kind === "hide";

      setOptimisticCommentState(
        (current) => ({
          ...current,
          [target.messageId]: {
            ...previous,
            hidden: nextHidden,
          },
        }),
      );

      const result =
        await onHideComment(
          target.platformMessageId,
          nextHidden,
        );

      if (result.deleted) {
        setOptimisticCommentState(
          (current) => ({
            ...current,
            [target.messageId]: {
              ...previous,
              liked: false,
              hidden: false,
              deleted: true,
              deletedBy: "customer",
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
            [target.messageId]: previous,
          }),
        );
        return;
      }

      showActionNotice(
        nextHidden
          ? "Comment hidden"
          : "Comment unhidden",
      );
    } finally {
      setCommentConfirmLoading(false);
    }
  }

  useEffect(() => {
    /*
     * Every explicit conversation open starts at the newest message. Do not
     * restore a previous scroll position and do not jump to the first unread
     * marker. This also makes reopening a thread after switching conversations
     * deterministic on the first click.
     */
    initialScrollDoneRef.current = false;
    lastMessageIdRef.current = null;
    previousMessageCountRef.current = 0;
    userNearBottomRef.current = true;
    setShowScrollToLatest(false);
    prependScrollSnapshotRef.current = null;
    olderLoadRequestedRef.current = false;
    setNewMessageCount(0);
  }, [activeConversation?.id]);

  /*
   * V3.11.33 — selecting/opening a conversation must land on the newest
   * rendered message on the first try. Wait until the newest page has finished
   * loading, then scroll after paint. The short follow-up covers image/media
   * layout that can finish a moment after the message DOM is committed.
   */
  useEffect(() => {
    if (
      !activeConversation ||
      loadingConversationMessages
    ) {
      return;
    }

    let cancelled = false;
    const followUpTimers: number[] = [];

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        /*
         * Opening lands instantly. A thread opens scrolled to the top, so
         * animating to the newest message drags the whole history past the
         * agent — hundreds or thousands of pixels of images and bubbles the
         * browser has to paint mid-flight, which is what made it stutter.
         * The agent has not seen the top anyway, so there is nothing to
         * animate away from. Animation belongs to the short hops below and
         * to the Latest button.
         */
        scrollToNewest("auto");

        /*
         * The thread's height keeps changing after the message DOM is
         * committed — images and video posters decode, web fonts swap,
         * reply cards reflow — so a scroll fired once at commit time
         * lands short of the bottom whenever any of that resolves late.
         * That is why opening a conversation sometimes reached the newest
         * message and sometimes did not: it depended on whether the media
         * happened to be cached already.
         *
         * These corrections start only after the opening animation has
         * finished. Firing them during it replaced the animation with a
         * jump and made the whole thing look broken. Each one animates
         * too, and only runs when the thread is genuinely short of the
         * bottom, so a settled thread never scrolls twice.
         */
        for (const delay of [820, 1300, 1900]) {
          followUpTimers.push(
            window.setTimeout(() => {
              const container =
                messagesContainerRef.current;

              if (
                cancelled ||
                !container ||
                !userNearBottomRef.current
              ) {
                return;
              }

              const distanceFromBottom =
                container.scrollHeight -
                container.scrollTop -
                container.clientHeight;

              if (distanceFromBottom > 8) {
                /*
                 * Animate only short corrections. A long one has the same
                 * stutter problem as animating the open, so past roughly a
                 * screen and a half it simply snaps.
                 */
                scrollToNewest(
                  distanceFromBottom < 900
                    ? "smooth"
                    : "auto",
                );
              }
            }, delay),
          );
        }
      });
    });

    return () => {
      cancelled = true;

      for (const timer of followUpTimers) {
        window.clearTimeout(timer);
      }
    };
  }, [
    activeConversation?.id,
    loadingConversationMessages,
    scrollToNewest,
  ]);

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
     * First committed message page for this conversation always opens at the
     * true newest message, regardless of unread markers or who sent it. Run on
     * two animation frames so the message DOM is fully painted before reading
     * scrollHeight; this removes the old first-click / second-click behavior.
     */
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      lastMessageIdRef.current = latestMessageId;
      previousMessageCountRef.current = messages.length;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          scrollToNewest("auto");
        });
      });

      return;
    }

    const previousMessageId =
      lastMessageIdRef.current;

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

    /*
     * V3.11.33 — keep the open conversation pinned to its newest message for
     * every genuinely new message, including customer/incoming messages.
     * Delivery/seen-only updates are filtered above because the latest message
     * id does not change, so ordinary status updates do not cause a jump.
     */
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToNewest("smooth");
      });
    });
  }, [
    loadingConversationMessages,
    messages,
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

  /*
   * Use the connected Facebook Page's public profile picture for Page-authored
   * comment replies. This is UI-only and keeps the current Inbox data model,
   * webhook processing, and nested-comment behavior unchanged.
   */
  const facebookPageProfilePictureUrl =
    headerChannelPlatform === "messenger" &&
    activeConversation.social_account
      ?.platform_account_id
      ?.trim()
      ? `https://graph.facebook.com/${encodeURIComponent(
          activeConversation.social_account.platform_account_id.trim(),
        )}/picture?type=large&width=96&height=96`
      : null;

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

      {commentConfirmTarget ? (
        <div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[1px]"
          onMouseDown={(event) => {
            if (
              event.target ===
                event.currentTarget &&
              !commentConfirmLoading
            ) {
              setCommentConfirmTarget(null);
            }
          }}
          role="presentation"
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="facebook-comment-confirm-title"
            aria-describedby="facebook-comment-confirm-description"
            className="w-full max-w-[470px] overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-2xl"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  commentConfirmTarget.kind ===
                  "delete"
                    ? "bg-red-50 text-red-500"
                    : "bg-amber-50 text-amber-600"
                }`}
              >
                {commentConfirmTarget.kind ===
                "delete" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    className="h-5 w-5"
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
                ) : (
                  <HideIcon />
                )}
              </span>

              <h2
                id="facebook-comment-confirm-title"
                className="min-w-0 flex-1 text-[17px] font-extrabold text-slate-950"
              >
                {commentConfirmTarget.kind ===
                "delete"
                  ? "Delete comment?"
                  : commentConfirmTarget.kind ===
                      "hide"
                    ? "Hide comment?"
                    : "Unhide comment?"}
              </h2>

              <button
                type="button"
                onClick={() =>
                  setCommentConfirmTarget(null)
                }
                disabled={commentConfirmLoading}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Close confirmation"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    d="M6 6l12 12M18 6 6 18"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="px-5 py-6">
              <p
                id="facebook-comment-confirm-description"
                className="text-[15px] leading-6 text-slate-600"
              >
                {commentConfirmTarget.kind ===
                "delete"
                  ? "This Facebook comment will be permanently deleted. This action cannot be undone."
                  : commentConfirmTarget.kind ===
                      "hide"
                    ? "This Facebook comment will be hidden on Facebook. You can unhide it later."
                    : "This Facebook comment will be visible on Facebook again."}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4">
              <button
                type="button"
                onClick={() =>
                  setCommentConfirmTarget(null)
                }
                disabled={commentConfirmLoading}
                className="inline-flex h-10 items-center justify-center rounded-[10px] border border-slate-300 bg-white px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() =>
                  void confirmCommentAction()
                }
                disabled={commentConfirmLoading}
                className={`inline-flex h-10 min-w-[82px] items-center justify-center rounded-[10px] px-4 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  commentConfirmTarget.kind ===
                  "delete"
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-amber-500 hover:bg-amber-600"
                }`}
              >
                {commentConfirmLoading
                  ? "Please wait..."
                  : commentConfirmTarget.kind ===
                      "delete"
                    ? "Delete"
                    : commentConfirmTarget.kind ===
                        "hide"
                      ? "Hide"
                      : "Unhide"}
              </button>
            </div>
          </section>
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
            /*
             * Every background is a full-bleed theme image, so all five are
             * drawn the same way. This used to branch on the default and tile
             * it at 320px, which was correct only for the old small pattern
             * (chat-bg.png). Once Theme 1 became the default that branch made
             * a full-size gradient repeat as a visible grid.
             */
            backgroundRepeat: "no-repeat",
            backgroundSize: "cover",
            backgroundPosition: "center",
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
              /*
               * Earlier photos of an album render nothing: the whole grid is
               * drawn once, on the run's last message.
               */
              const photoGroup = photoGroups.get(
                message.id,
              );

              if (
                photoGroup &&
                photoGroup.lastId !== message.id
              ) {
                return null;
              }

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
                  post?: {
                    id?: string;
                  } | null;
                  comment_id?: string;
                  parent_id?: string;
                  item?: string;
                  source?: string;
                  tenh_source?: string;
                  parent_comment_id?: string;
                  reply_comment_id?: string;
                  commenter_profile_picture_url?:
                    | string
                    | null;

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
                    attachments?: Array<{
                      type?: string | null;
                      payload?: {
                        url?: string | null;
                        sticker_id?:
                          | number
                          | string
                          | null;
                      } | null;
                    }> | null;
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

              const savedPostPreview =
                rawPayload?.post_preview ??
                null;

              const isCurrentConversationRootComment =
                Boolean(
                  activeConversation.facebook_comment_id &&
                    (message.platform_message_id ===
                      activeConversation.facebook_comment_id ||
                      rawPayload?.comment_id ===
                        activeConversation.facebook_comment_id),
                );

              const postId =
                rawPayload?.post_id
                  ?.trim() ||
                rawPayload?.post?.id
                  ?.trim() ||
                savedPostPreview?.id
                  ?.trim() ||
                (isCurrentConversationRootComment
                  ? activeConversation.facebook_post_id?.trim() || null
                  : null);

              /*
               * Even if Meta's optional post-detail lookup temporarily fails,
               * a real Facebook comment still has a post ID. Keep the content
               * card visible with its ID + View Post link instead of collapsing
               * to the small standalone comment card. New webhook rows normally
               * include the richer saved preview from process-comment.ts.
               */
              const postPreview =
                savedPostPreview ??
                (postId
                  ? {
                      id: postId,
                      message: null,
                      full_picture: null,
                      permalink_url: null,
                      created_time: null,
                    }
                  : null);

              const attachmentMeta =
                rawPayload?.tenh_attachment ??
                null;

              const stickerMeta =
                rawPayload?.tenh_sticker ??
                null;

              /*
               * Facebook Messenger stickers arrive as image attachments with
               * payload.sticker_id. They do not include Telegram's
               * tenh_sticker metadata, so detect them from the original
               * Messenger webhook payload instead of rendering the Telegram
               * sticker fallback card.
               */
              const facebookStickerAttachment =
                rawPayload?.message
                  ?.attachments?.find(
                    (attachment) =>
                      attachment?.type ===
                        "image" &&
                      attachment?.payload
                        ?.sticker_id != null,
                  ) ?? null;

              const isFacebookSticker =
                Boolean(
                  facebookStickerAttachment,
                );

              const facebookStickerUrl =
                facebookStickerAttachment
                  ?.payload?.url ??
                message.attachment_url ??
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
                  rawPayload?.tenh_source ===
                    "facebook_page_reply" ||
                  rawPayload?.parent_comment_id ||
                  rawPayload?.reply_comment_id,
                );

              /*
               * Keep the current nested-comment UI compatible with both:
               * - TENH-native replies: source + parent_comment_id
               * - older Business Suite rows: tenh_source + Meta parent_id
               *
               * This is UI-only and lets replies already saved before the
               * metadata normalization render inside their parent card too.
               */
              const rawFacebookReplyParentId =
                typeof rawPayload?.parent_comment_id ===
                "string"
                  ? rawPayload.parent_comment_id.trim()
                  : typeof rawPayload?.parent_id ===
                      "string"
                    ? rawPayload.parent_id.trim()
                    : null;

              /*
               * Meta can send parent_id for both real comment replies and
               * top-level comments (where it may equal the post ID). Only a
               * different ID is a real nested comment parent. This keeps old
               * customer replies nested without hiding the post card from a
               * new top-level customer comment.
               */
              const facebookReplyParentId =
                rawFacebookReplyParentId &&
                rawFacebookReplyParentId !== postId
                  ? rawFacebookReplyParentId
                  : null;

              const facebookReplyParentMessage =
                facebookReplyParentId
                  ? messages.find(
                      (candidate) =>
                        candidate.platform_message_id ===
                        facebookReplyParentId,
                    ) ?? null
                  : null;

              const safeFacebookGroupInfo =
                getSafeFacebookCommentGroupInfo(message);

              const previousFacebookRootGroupKey =
                findNeighborFacebookRootGroupKey(
                  messages,
                  messageIndex - 1,
                  -1,
                );

              const nextFacebookRootGroupKey =
                findNeighborFacebookRootGroupKey(
                  messages,
                  messageIndex + 1,
                  1,
                );

              const isFacebookPostGroupContinuation =
                Boolean(
                  safeFacebookGroupInfo.groupKey &&
                    previousFacebookRootGroupKey ===
                      safeFacebookGroupInfo.groupKey,
                );

              const hasNextFacebookRootInSamePostGroup =
                Boolean(
                  safeFacebookGroupInfo.groupKey &&
                    nextFacebookRootGroupKey ===
                      safeFacebookGroupInfo.groupKey,
                );

              // UI only: replies to Facebook comments are rendered as a
              // compact nested card directly beneath the parent comment.
              // This does not change reply IDs, actions, API calls, or data.
              const isNestedFacebookCommentReply = Boolean(
                facebookReplyParentId && facebookReplyParentMessage,
              );

              // UI only: collect the full Facebook reply tree beneath this
              // root comment. This includes customer replies, Page/TENH
              // replies, and replies-to-replies. Exact Meta parent IDs drive
              // the tree; no customer/post guessing is used here.
              const facebookChildReplies =
                !facebookReplyParentId &&
                message.platform_message_id
                  ? collectFacebookCommentDescendants(
                      messages,
                      message.platform_message_id,
                    )
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

              /*
               * Locked Facebook Comment UI rule:
               * every top-level Facebook comment gets its own post context
               * card. Nested customer/Page replies never render another post
               * card. Do not suppress a card just because the same post was
               * shown earlier in this customer conversation.
               */
              const showFacebookPostPreview =
                Boolean(
                  isFacebookCommentMessage &&
                    postPreview &&
                    postId &&
                    !facebookReplyParentId &&
                    !isFacebookPostGroupContinuation &&
                    !commentState.deleted,
                );

              const facebookCommentActorName =
                isOutgoing
                  ? headerChannelAccountName
                  : replyingToName;

              const savedCommenterProfilePictureUrl =
                rawPayload
                  ?.commenter_profile_picture_url
                  ?.trim() ||
                null;

              const facebookCommentActorPhoto =
                isOutgoing
                  ? facebookPageProfilePictureUrl
                  : savedCommenterProfilePictureUrl ??
                    activeConversation.contact
                      ?.profile_picture_url ??
                    null;

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
                      {showMessageDay && !isFacebookPostGroupContinuation ? (
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
                        className="ml-[52px] w-fit max-w-[680px] rounded-xl bg-slate-50 px-3 py-2 text-[13px] italic text-slate-400 sm:ml-[64px]"
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
                    {showMessageDay && !isFacebookPostGroupContinuation ? (
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
                      style={
                        isFacebookPostGroupContinuation ||
                        hasNextFacebookRootInSamePostGroup
                          ? {
                              // Tailwind 4 `space-y-4` adds logical block-end
                              // margin to the PREVIOUS direct child. Remove that
                              // spacing on every member of the same safe Facebook
                              // post/customer group so it renders as one card.
                              ...(isFacebookPostGroupContinuation
                                ? {
                                    marginBlockStart: 0,
                                    marginTop: 0,
                                  }
                                : {}),
                              ...(hasNextFacebookRootInSamePostGroup
                                ? {
                                    marginBlockEnd: 0,
                                    marginBottom: 0,
                                  }
                                : {}),
                            }
                          : undefined
                      }
                      className={`${
                        isNestedFacebookCommentReply
                          ? "!mt-0 ml-[52px] w-fit max-w-[680px] rounded-[16px] bg-white px-2 py-1 shadow-none sm:ml-[64px]"
                          : isFacebookPostGroupContinuation
                            ? `!mt-0 w-full max-w-[860px] rounded-t-none ${
                                hasNextFacebookRootInSamePostGroup
                                  ? "rounded-b-none border-b-0"
                                  : "rounded-b-[20px]"
                              } border-x border-b border-slate-200 bg-white p-2 shadow-[0_4px_16px_rgba(15,23,42,0.05)]`
                            : `${
                                hasNextFacebookRootInSamePostGroup
                                  ? "w-full rounded-t-[20px] rounded-b-none border-b-0"
                                  : "w-fit rounded-[20px]"
                              } max-w-[860px] border border-slate-200 bg-white p-2 shadow-[0_4px_16px_rgba(15,23,42,0.05)]`
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
                              <button
                                type="button"
                                onClick={() =>
                                  setImagePreview({
                                    src: postPreview.full_picture!,
                                    alt: "Facebook post",
                                  })
                                }
                                className="h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[15px] bg-white text-left sm:h-[132px] sm:w-[132px]"
                                aria-label="Open Facebook post image"
                              >
                                <img
                                  src={
                                    postPreview.full_picture
                                  }
                                  alt="Facebook post"
                                  className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]"
                                  loading="lazy"
                                />
                              </button>
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
                            : isFacebookPostGroupContinuation
                              ? "px-1 py-3 sm:px-2"
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
                          <div className="mb-1 text-[11px] font-extrabold uppercase tracking-[0.04em] text-blue-600">
                            Facebook Comment
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                                    onClick={() => {
                                      onReplyToComment(
                                        message.platform_message_id,
                                      );
                                      showActionNotice(
                                        "Replying to Facebook Comment",
                                      );
                                    }}
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
                                    onClick={() =>
                                      setCommentConfirmTarget({
                                        kind: commentState.hidden
                                          ? "unhide"
                                          : "hide",
                                        messageId: message.id,
                                        platformMessageId:
                                          message.platform_message_id,
                                        previous: {
                                          ...commentState,
                                        },
                                      })
                                    }
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
                                onClick={() =>
                                  setCommentConfirmTarget({
                                    kind: "delete",
                                    messageId: message.id,
                                    platformMessageId:
                                      message.platform_message_id,
                                    previous: {
                                      ...commentState,
                                    },
                                  })
                                }
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
                              {facebookChildReplies.map(({ reply, depth }) => {
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

                                const replyIsOutgoing =
                                  reply.direction === "outgoing";

                                const replyPayload =
                                  reply.raw_payload as {
                                    commenter_profile_picture_url?:
                                      | string
                                      | null;
                                  } | null;

                                const replyActorName =
                                  replyIsOutgoing
                                    ? headerChannelAccountName
                                    : activeConversation.contact
                                        ?.full_name ??
                                      replyingToName;

                                const replyActorPhoto =
                                  replyIsOutgoing
                                    ? facebookPageProfilePictureUrl
                                    : replyPayload
                                        ?.commenter_profile_picture_url
                                        ?.trim() ||
                                      activeConversation.contact
                                        ?.profile_picture_url ||
                                      null;

                                const replyActorInitial =
                                  replyActorName
                                    .trim()
                                    .charAt(0)
                                    .toUpperCase() || "?";

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
                                    className="flex gap-2.5"
                                    style={{
                                      marginLeft: `${Math.min(depth, 5) * 24}px`,
                                    }}
                                  >
                                    {replyActorPhoto ? (
                                      <img
                                        src={replyActorPhoto}
                                        alt={replyActorName}
                                        className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        draggable={false}
                                      />
                                    ) : (
                                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold shadow-[0_4px_12px_rgba(37,99,235,0.12)] ${
                                        replyIsOutgoing
                                          ? "bg-blue-600 text-white"
                                          : "bg-indigo-50 text-indigo-600"
                                      }`}>
                                        {replyActorInitial}
                                      </div>
                                    )}

                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                        <span className="text-[14px] font-bold text-slate-950">
                                          {replyActorName}
                                        </span>
                                        {replyIsOutgoing ? (
                                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                                            {isKhmer ? "អ្នក" : "You"}
                                          </span>
                                        ) : null}
                                        <span className="text-xs text-slate-400">
                                          <HydrationSafeMessageTime
                                            value={replyTimestamp}
                                          />
                                        </span>
                                        {replyIsOutgoing ? (
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
                                        ) : null}
                                      </div>

                                      <div className="mt-0.5 max-w-[620px] whitespace-pre-wrap text-[15px] leading-5 text-slate-900">
                                        {reply.message_text ??
                                          "Facebook comment reply"}
                                      </div>

                                      {reply.platform_message_id &&
                                      !reply.id.startsWith(
                                        "optimistic:",
                                      ) ? (
                                        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px] font-medium">
                                          {!replyIsOutgoing ? (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  onReplyToComment(
                                                    reply.platform_message_id,
                                                  );
                                                  showActionNotice(
                                                    "Replying to Facebook Comment",
                                                  );
                                                }}
                                                className="inline-flex items-center gap-1.5 text-slate-500 transition hover:text-blue-600"
                                              >
                                                <ReplyIcon />
                                                <span>
                                                  {isKhmer ? "ឆ្លើយតប" : "Reply"}
                                                </span>
                                              </button>

                                              <button
                                                type="button"
                                                onClick={async () => {
                                                  const previous =
                                                    replyState.liked;
                                                  const next = !previous;

                                                  setOptimisticCommentState(
                                                    (current) => ({
                                                      ...current,
                                                      [reply.id]: {
                                                        ...replyState,
                                                        liked: next,
                                                      },
                                                    }),
                                                  );

                                                  const result =
                                                    await onLikeComment(
                                                      reply.platform_message_id!,
                                                      next,
                                                    );

                                                  if (result.deleted) {
                                                    setOptimisticCommentState(
                                                      (current) => ({
                                                        ...current,
                                                        [reply.id]: {
                                                          ...replyState,
                                                          liked: false,
                                                          hidden: false,
                                                          deleted: true,
                                                          deletedBy: "customer",
                                                        },
                                                      }),
                                                    );
                                                    return;
                                                  }

                                                  if (!result.success) {
                                                    setOptimisticCommentState(
                                                      (current) => ({
                                                        ...current,
                                                        [reply.id]: {
                                                          ...replyState,
                                                          liked: previous,
                                                        },
                                                      }),
                                                    );
                                                  }
                                                }}
                                                className={`inline-flex items-center gap-1.5 transition ${
                                                  replyState.liked
                                                    ? "text-blue-600"
                                                    : "text-slate-500 hover:text-blue-600"
                                                }`}
                                              >
                                                <LikeIcon />
                                                <span>
                                                  {replyState.liked
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
                                                onClick={() =>
                                                  setCommentConfirmTarget({
                                                    kind: replyState.hidden
                                                      ? "unhide"
                                                      : "hide",
                                                    messageId: reply.id,
                                                    platformMessageId:
                                                      reply.platform_message_id!,
                                                    previous: {
                                                      ...replyState,
                                                    },
                                                  })
                                                }
                                                className={`inline-flex items-center gap-1.5 transition ${
                                                  replyState.hidden
                                                    ? "text-amber-600"
                                                    : "text-slate-500 hover:text-amber-600"
                                                }`}
                                              >
                                                <HideIcon />
                                                <span>
                                                  {replyState.hidden
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
                                            onClick={() =>
                                              setCommentConfirmTarget({
                                                kind: "delete",
                                                messageId: reply.id,
                                                platformMessageId:
                                                  reply.platform_message_id!,
                                                previous: {
                                                  ...replyState,
                                                },
                                              })
                                            }
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
                          <div className="w-fit">
                            {isFacebookSticker &&
                            facebookStickerUrl ? (
                              <img
                                src={facebookStickerUrl}
                                alt="Facebook sticker"
                                className="max-h-32 max-w-[132px] rounded-xl object-contain"
                                loading="lazy"
                              />
                            ) : attachmentUrl &&
                              stickerMeta
                                ?.preview_kind ===
                                "video" ? (
                              <video
                                src={attachmentUrl}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="max-h-32 max-w-[132px] rounded-xl bg-transparent object-contain"
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
                                className="max-h-32 max-w-[132px] rounded-xl object-contain"
                                loading="lazy"
                              />
                            ) : (
                              <div className="flex min-h-20 w-fit min-w-[104px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5">
                                <span className="text-3xl leading-none">
                                  {stickerMeta?.emoji ??
                                    "✨"}
                                </span>
                                <span className="mt-1.5 text-[10.5px] font-medium text-slate-500">
                                  {isFacebookSticker
                                    ? "Facebook sticker"
                                    : stickerMeta?.format ===
                                        "animated"
                                      ? "Animated sticker"
                                      : "Telegram sticker"}
                                </span>
                              </div>
                            )}

                            {!isFacebookSticker &&
                            stickerMeta?.emoji ? (
                              <p className="mt-0.5 text-center text-[11px] text-slate-500">
                                {stickerMeta.emoji}
                              </p>
                            ) : null}
                          </div>
                        ) : isImageMessage &&
                          photoGroup &&
                          photoGroup.members.length > 1 ? (
                          /*
                           * Three across, so six photos read as 3x2 and four
                           * as 2x2. Square tiles keep the rows aligned however
                           * the originals are cropped.
                           */
                          <div
                            className={`-mx-4 grid gap-[3px] overflow-hidden ${
                              photoGroup.members.length === 2
                                ? "grid-cols-2"
                                : photoGroup.members.length === 4
                                  ? "grid-cols-2"
                                  : "grid-cols-3"
                            } ${
                              telegramReplyPreview
                                ? "mt-1"
                                : "-mt-3"
                            } mb-1`}
                          >
                            {photoGroup.members.map((photo: InboxMessage) => {
                              const photoUrl =
                                photo.attachment_url;

                              if (!photoUrl) {
                                return (
                                  <div
                                    key={`album-${photo.id}`}
                                    className="flex aspect-square w-full items-center justify-center bg-slate-100 text-[10px] font-medium text-slate-400"
                                  >
                                    Unavailable
                                  </div>
                                );
                              }

                              return (
                                <button
                                  key={`album-${photo.id}`}
                                  type="button"
                                  onClick={() =>
                                    setImagePreview({
                                      src: photoUrl,
                                      alt:
                                        photo.message_text ||
                                        "Photo",
                                    })
                                  }
                                  className="group/media block aspect-square w-full cursor-zoom-in overflow-hidden bg-slate-100"
                                  aria-label="Open photo"
                                >
                                  <img
                                    src={photoUrl}
                                    alt={
                                      photo.message_text ||
                                      "Photo"
                                    }
                                    className="h-full w-full object-cover transition duration-200 group-hover/media:scale-[1.02]"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </button>
                              );
                            })}
                          </div>
                        ) : isImageMessage ? (
                          <div className="w-[300px] max-w-full overflow-hidden rounded-[22px] bg-slate-100 ring-1 ring-slate-200/70">
                            {attachmentUrl ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setImagePreview({
                                    src: attachmentUrl,
                                    alt: attachmentName,
                                  })
                                }
                                className="group/media block w-full cursor-zoom-in text-left"
                                aria-label={`Open ${attachmentName}`}
                              >
                                <img
                                  src={attachmentUrl}
                                  alt={attachmentName}
                                  className="max-h-[360px] w-full object-cover transition duration-200 group-hover/media:scale-[1.01]"
                                  loading="lazy"
                                  decoding="async"
                                />
                              </button>
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
                          /*
                           * The video spans the bubble instead of sitting in a
                           * framed card inside it. Negative margins cancel the
                           * bubble's own padding, which was drawing a thick
                           * band of bubble colour on all four sides; the
                           * bubble clips the corners itself. The top offset is
                           * skipped when a reply preview sits above, or the
                           * video would ride over it.
                           */
                          <div
                            className={`-mx-4 mb-1 overflow-hidden bg-black ${
                              telegramReplyPreview
                                ? "mt-1"
                                : "-mt-3"
                            }`}
                          >
                            {attachmentUrl ? (
                              <video
                                src={attachmentUrl}
                                controls
                                preload="none"
                                playsInline
                                className="max-h-[380px] w-full bg-black object-contain"
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
                              isOutgoing={isOutgoing}
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
                          /*
                           * No card of its own. The bubble is already a
                           * container; a bordered white panel inside it
                           * doubled the padding and, on an outgoing message,
                           * dropped a white box onto the blue.
                           */
                          attachmentUrl ? (
                            <a
                              href={attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`flex w-[228px] max-w-full items-center gap-2.5 rounded-lg px-1 py-0.5 transition ${
                                isOutgoing
                                  ? "hover:bg-white/10"
                                  : "hover:bg-slate-100"
                              }`}
                            >
                              <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                  isOutgoing
                                    ? "bg-white/20 text-white"
                                    : "bg-sky-50 text-sky-600"
                                }`}
                              >
                                <FileIcon />
                              </span>

                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate text-[13px] font-semibold ${
                                    isOutgoing
                                      ? "text-white"
                                      : "text-slate-800"
                                  }`}
                                >
                                  {attachmentName}
                                </span>
                                <span
                                  className={`block truncate text-[11px] ${
                                    isOutgoing
                                      ? "text-white/70"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {[
                                    attachmentMeta?.mime_type?.split("/").pop()?.toUpperCase(),
                                    formatAttachmentSize(attachmentMeta?.size),
                                  ]
                                    .filter(Boolean)
                                    .join(" · ") || "Telegram file"}
                                </span>
                              </span>
                            </a>
                          ) : (
                            <div className="flex w-[228px] max-w-full items-center gap-2.5 px-1 py-0.5">
                              <span
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                                  isOutgoing
                                    ? "bg-white/20 text-white"
                                    : "bg-slate-100 text-slate-400"
                                }`}
                              >
                                <FileIcon />
                              </span>

                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate text-[13px] font-semibold ${
                                    isOutgoing
                                      ? "text-white"
                                      : "text-slate-800"
                                  }`}
                                >
                                  {attachmentName}
                                </span>
                                <span
                                  className={`block truncate text-[11px] ${
                                    isOutgoing
                                      ? "text-white/70"
                                      : "text-slate-400"
                                  }`}
                                >
                                  Unavailable
                                </span>
                              </span>
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
                            onClick={() => {
                              onReplyToComment(
                                message.platform_message_id,
                              );
                              showActionNotice(
                                "Replying to Facebook Comment",
                              );
                            }}
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
                              setCommentConfirmTarget({
                                kind: commentState.hidden
                                  ? "unhide"
                                  : "hide",
                                messageId: message.id,
                                platformMessageId:
                                  message.platform_message_id,
                                previous: {
                                  ...commentState,
                                },
                              })
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
                              setCommentConfirmTarget({
                                kind: "delete",
                                messageId: message.id,
                                platformMessageId:
                                  message.platform_message_id,
                                previous: {
                                  ...commentState,
                                },
                              })
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
              <p className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-blue-600">
                Facebook Comment
              </p>

              <p className="mt-0.5 truncate text-[15px] font-bold leading-5 text-slate-900 sm:text-base">
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
          blockedReason={facebookMessengerBlockedReason}
          blockedTitle={facebookMessengerBlockedTitle}

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

      {imagePreview ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-[2px] sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImagePreview(null);
            }
          }}
        >
          <div
            className="relative flex max-h-[92vh] max-w-[94vw] items-center justify-center"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <img
              src={imagePreview.src}
              alt={imagePreview.alt}
              className="max-h-[92vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl"
            />

            <button
              type="button"
              onClick={() => setImagePreview(null)}
              className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-2xl leading-none text-white shadow-lg transition hover:bg-black/75"
              aria-label="Close image preview"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

    </section>
  );
}
