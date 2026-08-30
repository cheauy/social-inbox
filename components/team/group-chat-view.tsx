"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Bell,
  BellOff,
  Filter,
  FileText,
  Image as ImageIcon,
  Link2,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pin,
  Search,
  Send,
  Settings2,
  Smile,
  Trash2,
  UserRoundPlus,
  Users,
  Video,
  X,
} from "lucide-react";

import EmojiPicker from "emoji-picker-react";

import { createClient } from "@/lib/supabase/client";
import { MentionComposer } from "@/components/team/mention-composer";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
};

type TeamRoom = {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_general: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  member_ids: string[];
  member_count: number;
  unread_count: number;
  badge_count?: number;
  mention_count?: number;
  is_muted?: boolean;
};

type TeamAttachment = {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  url: string | null;
  file_name: string;
  mime_type: string;
  byte_size: number;
};

type CurrentMember = {
  id: string;
  full_name: string;
  role: string;
  profile_picture_url: string | null;
};

type TeamMessage = {
  id: string;
  business_id: string;
  room_id: string;
  sender_member_id: string;
  message_text: string;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  sender:
    | TeamMember
    | TeamMember[]
    | null;
  attachments?: TeamAttachment[];
};

type SearchHit = {
  id: string;
  room_id: string;
  message_text: string;
  created_at: string;
  sender: TeamMember | TeamMember[] | null;
};

type RoomsResponse = {
  success?: boolean;
  error?: string;
  rooms?: TeamRoom[];
  members?: TeamMember[];
  currentMember?: CurrentMember;
  businessId?: string;
  canManage?: boolean;
  totalBadgeCount?: number;
};

type MessagesResponse = {
  success?: boolean;
  error?: string;
  messages?: TeamMessage[];
  hasMore?: boolean;
};

async function readJsonResponse<T>(
  response: Response,
  label: string,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `${label}: server returned an empty response (HTTP ${response.status}).`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const looksLikeHtml =
      text.trimStart().startsWith("<");

    throw new Error(
      looksLikeHtml
        ? `${label}: the API route returned HTML instead of JSON (HTTP ${response.status}). Check that the route file exists at the exact [roomId] path and restart npm run dev.`
        : `${label}: the server returned invalid JSON (HTTP ${response.status}).`,
    );
  }
}

const MENTION_SOUND_SRC = "/alert-sound/mentions-notification.mp3";
const FALLBACK_SOUND_SRC = "/alert-sound/crystal-bell-chime.wav";

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitial(name: string | null | undefined) {
  return name?.trim().charAt(0).toUpperCase() || "T";
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeSender(
  sender: TeamMessage["sender"],
): TeamMember | null {
  return Array.isArray(sender)
    ? sender[0] ?? null
    : sender;
}

type SharedStorageItem = {
  id: string;
  label: string;
  url: string;
  kind: "file" | "link" | "image" | "video";
  meta?: string;
  createdAt: string;
};

function collectSharedItems(sourceMessages: TeamMessage[]): SharedStorageItem[] {
  const items: SharedStorageItem[] = [];

  for (const message of [...sourceMessages].reverse()) {
    for (const attachment of message.attachments ?? []) {
      if (!attachment.url) continue;
      items.push({
        id: `attachment-${attachment.id}`,
        label: attachment.file_name,
        url: attachment.url,
        kind:
          attachment.kind === "image"
            ? "image"
            : attachment.kind === "video"
              ? "video"
              : "file",
        meta: formatBytes(attachment.byte_size),
        createdAt: message.created_at,
      });
    }

    const urls = message.message_text.match(/https?:\/\/[^\s<]+/gi) ?? [];
    urls.forEach((rawUrl, index) => {
      const url = rawUrl.replace(/[),.!?]+$/, "");
      items.push({
        id: `link-${message.id}-${index}`,
        label: url,
        url,
        kind: "link",
        createdAt: message.created_at,
      });
    });
  }

  return items;
}

function formatVoiceDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function GroupChatView() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);

  function roleLabel(role: string | null | undefined) {
    if (!isKhmer) return role || "Team member";
    switch ((role || "").toLowerCase()) {
      case "owner": return "ម្ចាស់";
      case "agent": return "ភ្នាក់ងារ";
      case "admin": return "អ្នកគ្រប់គ្រង";
      default: return "សមាជិកក្រុម";
    }
  }

  function roomDisplayName(room: TeamRoom) {
    return isKhmer && room.is_general && room.name.trim().toLowerCase() === "general"
      ? "ទូទៅ"
      : room.name;
  }

  function roomDescription(room: TeamRoom) {
    const description = room.description?.trim() || "";
    if (isKhmer && room.is_general && (!description || description === "Company-wide internal team chat.")) {
      return "ការជជែកក្រុមខាងក្នុងទូទាំងក្រុមហ៊ុន។";
    }
    return description || t(
      `${room.member_count} team members`,
      `សមាជិកក្រុម ${room.member_count} នាក់`,
    );
  }
  const searchParams = useSearchParams();
  const requestedRoomId = searchParams.get("room");

  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [currentMember, setCurrentMember] =
    useState<CurrentMember | null>(null);
  const [businessId, setBusinessId] =
    useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [selectedRoomId, setSelectedRoomId] =
    useState<string | null>(
      searchParams.get("room"),
    );
  const [messages, setMessages] =
    useState<TeamMessage[]>([]);
  const [loadingRooms, setLoadingRooms] =
    useState(true);
  const [loadingMessages, setLoadingMessages] =
    useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [messageText, setMessageText] =
    useState("");
  const [mentionedMemberIds, setMentionedMemberIds] =
    useState<string[]>([]);
  const [mentionEveryone, setMentionEveryone] =
    useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] =
    useState("");
  const [createMemberIds, setCreateMemberIds] =
    useState<string[]>([]);
  const [manageMembersOpen, setManageMembersOpen] =
    useState(false);
  const [manageMemberIds, setManageMemberIds] =
    useState<string[]>([]);
  const [modalBusy, setModalBusy] = useState(false);
  const [deleteMessageTarget, setDeleteMessageTarget] =
    useState<TeamMessage | null>(null);
  const [deleteMessageBusy, setDeleteMessageBusy] =
    useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] =
    useState(false);

  // --- feature state -------------------------------------------------
  const [showDetails, setShowDetails] = useState(true);
  const [muteBusy, setMuteBusy] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] =
    useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchLimit, setSearchLimit] = useState(25);
  const [searchHasMore, setSearchHasMore] = useState(false);

  const searchTimerRef = useRef<number | null>(null);
  const searchSequenceRef = useRef(0);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] =
    useState<TeamAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingMessageId, setEditingMessageId] =
    useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceReview, setVoiceReview] = useState<{
    attachmentId: string;
    durationSeconds: number;
    roomId: string;
  } | null>(null);
  const [voiceReviewPlaying, setVoiceReviewPlaying] = useState(false);
  const [voicePlaybackSeconds, setVoicePlaybackSeconds] = useState(0);

  const [storageOpen, setStorageOpen] = useState(false);
  const [storageItems, setStorageItems] = useState<SharedStorageItem[]>([]);
  const [storageBefore, setStorageBefore] = useState<string | null>(null);
  const [storageHasMore, setStorageHasMore] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageQuery, setStorageQuery] = useState("");
  const [storageTab, setStorageTab] = useState<"file" | "image" | "video">("file");

  const [callBusy, setCallBusy] = useState(false);
  const [callNotice, setCallNotice] =
    useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const draftBeforeEditRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingSecondsRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const soundFallbackRef = useRef(false);
  const mentionTotalRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedRoomIdRef = useRef<string | null>(null);
  const messageLoadSequenceRef = useRef(0);

  useEffect(
    () => () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (voiceReview && !pendingAttachments.some(
      (attachment) => attachment.id === voiceReview.attachmentId,
    )) {
      setVoiceReview(null);
      setVoiceReviewPlaying(false);
      setVoicePlaybackSeconds(0);
    }
  }, [pendingAttachments, voiceReview]);

  useEffect(() => {
    if (voiceReview && voiceReview.roomId !== selectedRoomId) {
      discardVoiceReview();
    }
  }, [selectedRoomId, voiceReview]);

  useEffect(() => {
    const audio = new Audio(MENTION_SOUND_SRC);
    audio.preload = "auto";

    // Fall back to a bundled sound if mentions-notification.mp3
    // has not been added to /public/alert-sound yet.
    audio.addEventListener("error", () => {
      if (soundFallbackRef.current) {
        return;
      }

      soundFallbackRef.current = true;
      audio.src = FALLBACK_SOUND_SRC;
    });

    alertAudioRef.current = audio;

    return () => {
      alertAudioRef.current = null;
    };
  }, []);

  const playMentionSound = useCallback(() => {
    const audio = alertAudioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = 0;

    // Browsers block audio until the page has been interacted with.
    // A rejected promise here is expected, not an error.
    void audio.play().catch(() => undefined);
  }, []);

  const notifyMention = useCallback(
    (roomName: string) => {
      playMentionSound();

      if (
        typeof window === "undefined" ||
        !("Notification" in window) ||
        Notification.permission !== "granted" ||
        document.visibilityState === "visible"
      ) {
        return;
      }

      try {
        new Notification(
          t("You were mentioned", "អ្នកត្រូវបានលើកឡើង"),
          {
            body: `${t("New mention in", "ការលើកឡើងថ្មីនៅក្នុង")} ${roomName}`,
            tag: "tenh-group-chat",
          },
        );
      } catch {
        /* Not available on some mobile browsers. */
      }
    },
    [playMentionSound, t],
  );

  const selectedRoom = useMemo(
    () =>
      rooms.find((room) => room.id === selectedRoomId) ??
      null,
    [rooms, selectedRoomId],
  );

  const sharedItems = useMemo(
    () => collectSharedItems(messages),
    [messages],
  );

  const sharedPreviewItems = useMemo(
    () => sharedItems.slice(0, 4),
    [sharedItems],
  );

  const voiceReviewAttachment = useMemo(
    () =>
      voiceReview
        ? pendingAttachments.find(
            (attachment) => attachment.id === voiceReview.attachmentId,
          ) ?? null
        : null,
    [pendingAttachments, voiceReview],
  );

  const filteredStorageItems = useMemo(() => {
    const query = storageQuery.trim().toLowerCase();
    return storageItems.filter((item) => {
      const matchesTab =
        storageTab === "file"
          ? item.kind === "file" || item.kind === "link"
          : item.kind === storageTab;
      if (!matchesTab) return false;
      if (!query) return true;
      return `${item.label} ${item.kind} ${item.meta ?? ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [storageItems, storageQuery, storageTab]);

  const storageCounts = useMemo(
    () => ({
      file: storageItems.filter(
        (item) => item.kind === "file" || item.kind === "link",
      ).length,
      image: storageItems.filter((item) => item.kind === "image").length,
      video: storageItems.filter((item) => item.kind === "video").length,
    }),
    [storageItems],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/team-chat/rooms",
        { cache: "no-store" },
      );
      const result =
        await readJsonResponse<RoomsResponse>(
          response,
          "Unable to load group chat",
        );

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load group chat.",
        );
      }

      const nextRooms = result.rooms ?? [];

      // Alert only when the mention total INCREASES, and never on the
      // first load — otherwise every refresh would replay old mentions.
      const mentionTotal = nextRooms.reduce(
        (sum, room) => sum + (room.mention_count ?? 0),
        0,
      );

      const previousMentionTotal = mentionTotalRef.current;
      mentionTotalRef.current = mentionTotal;

      if (
        previousMentionTotal !== null &&
        mentionTotal > previousMentionTotal
      ) {
        const mentionRoom = nextRooms.find(
          (room) => (room.mention_count ?? 0) > 0,
        );

        notifyMention(
          mentionRoom ? roomDisplayName(mentionRoom) : "TENH",
        );
      }

      setRooms(nextRooms);
      setMembers(result.members ?? []);
      setCurrentMember(result.currentMember ?? null);
      setBusinessId(result.businessId ?? null);
      setCanManage(result.canManage === true);

      setSelectedRoomId((current) => {
        // Keep the room the agent explicitly selected. Realtime room/member
        // refreshes must never bounce the UI back to the old URL room.
        if (
          current &&
          nextRooms.some((room) => room.id === current)
        ) {
          return current;
        }

        const roomFromUrl =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get(
                "room",
              )
            : null;

        if (
          roomFromUrl &&
          nextRooms.some((room) => room.id === roomFromUrl)
        ) {
          return roomFromUrl;
        }

        return nextRooms[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load group chat.",
      );
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  const markRoomRead = useCallback(
    async (roomId: string) => {
      // Clear the local unread/mention state immediately. The server write is
      // still authoritative and the normal room refresh will reconcile any
      // rare network failure.
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? {
                ...room,
                unread_count: 0,
                badge_count: 0,
                mention_count: 0,
              }
            : room,
        ),
      );

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new Event("tenh:group-chat-badge-refresh"),
        );
        window.dispatchEvent(
          new CustomEvent("tenh:team-notifications-room-read", {
            detail: { roomId },
          }),
        );
      }

      try {
        await fetch(
          `/api/team-chat/rooms/${encodeURIComponent(
            roomId,
          )}/read`,
          { method: "POST" },
        );
      } catch {
        // Read state is helpful, but should not interrupt chat.
      }
    },
    [],
  );

  const loadMessages = useCallback(
    async (
      roomId: string,
      options?: {
        showLoader?: boolean;
      },
    ) => {
      const showLoader = options?.showLoader !== false;
      const requestSequence =
        ++messageLoadSequenceRef.current;

      if (showLoader) {
        setLoadingMessages(true);
      }

      try {
        const response = await fetch(
          `/api/team-chat/rooms/${encodeURIComponent(
            roomId,
          )}/messages?limit=80`,
          { cache: "no-store" },
        );

        const result =
          await readJsonResponse<MessagesResponse>(
            response,
            "Unable to load team messages",
          );

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to load team messages.",
          );
        }

        // Never let an older request overwrite a room the agent has
        // already switched away from.
        if (
          requestSequence === messageLoadSequenceRef.current &&
          selectedRoomIdRef.current === roomId
        ) {
          setMessages(result.messages ?? []);
        }

        void markRoomRead(roomId);
      } catch (loadError) {
        if (selectedRoomIdRef.current === roomId) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load team messages.",
          );
        }
      } finally {
        if (
          showLoader &&
          requestSequence === messageLoadSequenceRef.current
        ) {
          setLoadingMessages(false);
        }
      }
    },
    [markRoomRead],
  );

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;

    if (!selectedRoomId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedRoomId);

    // V2.11.1: update the query string without triggering a
    // Next.js server navigation/RSC render. Calling router.replace()
    // here caused a render loop because the effect also depended on
    // useSearchParams().
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);

      if (url.searchParams.get("room") !== selectedRoomId) {
        url.searchParams.set("room", selectedRoomId);
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
  }, [loadMessages, selectedRoomId]);

  // Handle a room id received from a notification/deep link.
  // IMPORTANT: depend only on the URL value. Depending on rooms or
  // selectedRoomId caused a freshly selected/created room to bounce
  // back to the previous room during Realtime refreshes.
  useEffect(() => {
    if (
      requestedRoomId &&
      requestedRoomId !== selectedRoomIdRef.current
    ) {
      setSelectedRoomId(requestedRoomId);
    }
  }, [requestedRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length]);

  useEffect(() => {
    if (!businessId) {
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let channel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function startRealtime() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session || cancelled) {
        return;
      }

      await supabase.realtime.setAuth(
        session.access_token,
      );

      if (cancelled) {
        return;
      }

      const filter = `business_id=eq.${businessId}`;

      channel = supabase
        .channel(`tenh-team-chat-${businessId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "team_chat_events",
            filter,
          },
          (payload) => {
            const row = (payload.new ?? {}) as {
              room_id?: string;
              message_id?: string;
              event_type?: "INSERT" | "UPDATE" | "DELETE";
            };

            void loadRooms();

            if (
              !row.room_id ||
              row.room_id !== selectedRoomIdRef.current
            ) {
              return;
            }

            if (row.event_type === "DELETE" && row.message_id) {
              setMessages((current) =>
                current.filter(
                  (message) => message.id !== row.message_id,
                ),
              );
              return;
            }

            // INSERT / UPDATE sync silently in the background. Do not
            // replace the conversation with a full-screen loading state.
            void loadMessages(row.room_id, {
              showLoader: false,
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_chat_rooms",
            filter,
          },
          () => void loadRooms(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_chat_room_members",
            filter,
          },
          () => void loadRooms(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_notifications",
            filter,
          },
          () => void loadRooms(),
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "team_chat_room_events",
            filter,
          },
          (payload) => {
            const row = (payload.new ?? {}) as {
              room_id?: string;
              event_type?: "DELETE";
            };

            if (row.event_type === "DELETE" && row.room_id) {
              applyDeletedRoom(row.room_id);
            }

            void loadRooms();
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log(
              "[Tenh Team Chat V2.11.2] ✅ REALTIME READY",
            );
          }
        });
    }

    void startRealtime();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, loadMessages, loadRooms]);

  function chooseRoom(roomId: string) {
    if (recording) {
      cancelVoiceRecording();
    }
    if (voiceReview) {
      discardVoiceReview();
    }
    setStorageOpen(false);
    selectedRoomIdRef.current = roomId;
    setSelectedRoomId(roomId);
    setMessageText("");
    setEditingMessageId(null);
    draftBeforeEditRef.current = "";
    setMentionedMemberIds([]);
    setMentionEveryone(false);
    setError(null);
  }

  function applyDeletedRoom(roomId: string) {
    setRooms((current) => {
      const remaining = current.filter(
        (room) => room.id !== roomId,
      );

      if (selectedRoomIdRef.current === roomId) {
        const fallbackRoom =
          remaining.find((room) => room.is_general) ??
          remaining[0] ??
          null;

        const fallbackRoomId = fallbackRoom?.id ?? null;
        selectedRoomIdRef.current = fallbackRoomId;
        setSelectedRoomId(fallbackRoomId);
        setMessages([]);
        setMessageText("");
        setMentionedMemberIds([]);
        setMentionEveryone(false);
      }

      return remaining;
    });
  }

  async function toggleMute() {
    if (!selectedRoom || muteBusy) {
      return;
    }

    const roomId = selectedRoom.id;
    const previousMuted = selectedRoom.is_muted === true;
    const nextMuted = !previousMuted;

    // Optimistic update: the switch moves immediately while the server
    // request finishes in the background. Roll back only if it fails.
    setRooms((current) =>
      current.map((room) =>
        room.id === roomId
          ? { ...room, is_muted: nextMuted }
          : room,
      ),
    );
    setMuteBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(roomId)}/mute`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ muted: nextMuted }),
        },
      );

      const result = await readJsonResponse<{
        success?: boolean;
        error?: string;
        muted?: boolean;
      }>(response, "Unable to update mute setting");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to update mute setting.",
        );
      }

      const confirmedMuted = result.muted ?? nextMuted;
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? { ...room, is_muted: confirmedMuted }
            : room,
        ),
      );
    } catch (muteError) {
      setRooms((current) =>
        current.map((room) =>
          room.id === roomId
            ? { ...room, is_muted: previousMuted }
            : room,
        ),
      );
      setError(
        muteError instanceof Error
          ? muteError.message
          : "Unable to update mute setting.",
      );
    } finally {
      setMuteBusy(false);
    }
  }

  const runSearch = useCallback(
    async (term: string, limit: number) => {
      const trimmed = term.trim();

      if (trimmed.length < 2 || !selectedRoomIdRef.current) {
        setSearchResults([]);
        setSearchHasMore(false);
        setSearching(false);
        return;
      }

      // Every keystroke fires a request; only the newest one is allowed
      // to write state, so a slow early response cannot overwrite a
      // faster later one.
      const sequence = searchSequenceRef.current + 1;
      searchSequenceRef.current = sequence;

      setSearching(true);

      try {
        const response = await fetch(
          `/api/team-chat/search?q=${encodeURIComponent(
            trimmed,
          )}&roomId=${encodeURIComponent(
            selectedRoomIdRef.current,
          )}&limit=${limit}`,
          { cache: "no-store" },
        );

        const result = await readJsonResponse<{
          success?: boolean;
          error?: string;
          results?: SearchHit[];
        }>(response, "Unable to search messages");

        if (searchSequenceRef.current !== sequence) {
          return;
        }

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to search messages.",
          );
        }

        const hits = result.results ?? [];

        setSearchResults(hits);
        // The server caps at 100. A full page means there is more
        // behind it, so offer Load more instead of silently truncating.
        setSearchHasMore(hits.length >= limit && limit < 100);
      } catch (searchError) {
        if (searchSequenceRef.current !== sequence) {
          return;
        }

        setError(
          searchError instanceof Error
            ? searchError.message
            : "Unable to search messages.",
        );
      } finally {
        if (searchSequenceRef.current === sequence) {
          setSearching(false);
        }
      }
    },
    [],
  );

  /** Debounced so typing does not fire one query per keystroke. */
  function queueSearch(term: string) {
    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
    }

    setSearchLimit(25);

    if (term.trim().length < 2) {
      setSearchResults([]);
      setSearchHasMore(false);
      setSearching(false);
      return;
    }

    setSearching(true);

    searchTimerRef.current = window.setTimeout(() => {
      void runSearch(term, 25);
    }, 300);
  }

  async function loadStorageItems(reset = false) {
    if (!selectedRoomId || storageLoading) return;

    const roomId = selectedRoomId;
    const before = reset ? null : storageBefore;
    setStorageLoading(true);
    setStorageError(null);

    try {
      const params = new URLSearchParams({ limit: "100" });
      if (before) params.set("before", before);

      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(roomId)}/messages?${params.toString()}`,
        { cache: "no-store" },
      );
      const result = await readJsonResponse<MessagesResponse>(
        response,
        "Unable to load TENH Storage",
      );

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Unable to load TENH Storage.");
      }

      if (selectedRoomIdRef.current !== roomId) return;

      const pageMessages = result.messages ?? [];
      const pageItems = collectSharedItems(pageMessages);
      setStorageItems((current) => {
        const combined = reset ? pageItems : [...current, ...pageItems];
        const seen = new Set<string>();
        return combined.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      });

      const oldestMessage = pageMessages[0];
      setStorageBefore(oldestMessage?.created_at ?? null);
      setStorageHasMore(Boolean(result.hasMore && oldestMessage));
    } catch (storageLoadError) {
      setStorageError(
        storageLoadError instanceof Error
          ? storageLoadError.message
          : "Unable to load TENH Storage.",
      );
    } finally {
      setStorageLoading(false);
    }
  }

  function openTenhStorage() {
    setStorageOpen(true);
    setStorageQuery("");
    setStorageTab("file");
    setStorageItems([]);
    setStorageBefore(null);
    setStorageHasMore(false);
    setStorageError(null);
    window.setTimeout(() => {
      void loadStorageItems(true);
    }, 0);
  }

  async function uploadFileArray(
    files: File[],
    roomId = selectedRoomId,
  ): Promise<TeamAttachment[]> {
    if (files.length === 0 || !roomId) {
      return [];
    }

    const uploaded: TeamAttachment[] = [];
    setUploading(true);
    setError(null);

    try {
      for (const file of files.slice(0, 10)) {
        const form = new FormData();
        form.append("roomId", roomId);
        form.append("file", file);

        const response = await fetch(
          "/api/team-chat/attachments",
          { method: "POST", body: form },
        );

        const result = await readJsonResponse<{
          success?: boolean;
          error?: string;
          attachment?: TeamAttachment;
        }>(response, "Unable to upload file");

        if (!response.ok || !result.success || !result.attachment) {
          throw new Error(
            result.error ?? "Unable to upload file.",
          );
        }

        const uploadedAttachment = result.attachment as TeamAttachment;

        // If the user switched rooms while an upload was in flight, do
        // not carry an attachment from the old room into the new draft.
        if (selectedRoomIdRef.current !== roomId) {
          await fetch(
            `/api/team-chat/attachments?attachmentId=${encodeURIComponent(
              uploadedAttachment.id,
            )}`,
            { method: "DELETE" },
          ).catch(() => undefined);
          continue;
        }

        setPendingAttachments((current) => [
          ...current,
          uploadedAttachment,
        ]);
        uploaded.push(uploadedAttachment);
      }

      return uploaded;
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload file.",
      );
      return [];
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    await uploadFileArray(Array.from(fileList));
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function stopRecordingTracks() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  function startRecordingTimer() {
    clearRecordingTimer();
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds((seconds) => {
        const next = seconds + 1;
        recordingSecondsRef.current = next;

        if (next >= 300) {
          const recorder = mediaRecorderRef.current;
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
        }

        return next;
      });
    }, 1000);
  }

  function finishVoiceRecording() {
    discardRecordingRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function cancelVoiceRecording() {
    discardRecordingRef.current = true;
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }

    clearRecordingTimer();
    stopRecordingTracks();
    recordingChunksRef.current = [];
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
    setRecordingPaused(false);
    setRecording(false);
  }

  function pauseVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    clearRecordingTimer();
    setRecordingPaused(true);
  }

  function resumeVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    setRecordingPaused(false);
    startRecordingTimer();
  }

  async function toggleVoiceRecording() {
    if (recording) {
      finishVoiceRecording();
      return;
    }

    if (!selectedRoomId || uploading || sending || editingMessageId) {
      return;
    }

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t(
        "Voice recording is not supported in this browser.",
        "កម្មវិធីរុករកនេះមិនគាំទ្រការថតសំឡេងទេ។",
      ));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = preferredMimeTypes.find((value) =>
        MediaRecorder.isTypeSupported(value),
      );
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const roomId = selectedRoomId;

      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      recordingSecondsRef.current = 0;
      discardRecordingRef.current = false;
      setRecordingSeconds(0);
      setRecordingPaused(false);
      setRecording(true);
      setError(null);
      setEmojiOpen(false);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearRecordingTimer();

        const chunks = recordingChunksRef.current;
        const durationSeconds = Math.max(1, recordingSecondsRef.current);
        const discard = discardRecordingRef.current;

        recordingChunksRef.current = [];
        setRecording(false);
        setRecordingPaused(false);
        setRecordingSeconds(0);
        recordingSecondsRef.current = 0;
        stopRecordingTracks();
        mediaRecorderRef.current = null;

        if (discard || chunks.length === 0) return;

        const resolvedType = recorder.mimeType || "audio/webm";
        const baseMimeType = resolvedType.split(";")[0] || "audio/webm";
        const extension = baseMimeType.includes("ogg")
          ? "ogg"
          : baseMimeType.includes("mp4")
            ? "m4a"
            : baseMimeType.includes("mpeg")
              ? "mp3"
              : baseMimeType.includes("wav")
                ? "wav"
                : "webm";
        const voiceFile = new File(
          [new Blob(chunks, { type: baseMimeType })],
          `voice-message-${Date.now()}.${extension}`,
          { type: baseMimeType },
        );

        void uploadFileArray([voiceFile], roomId).then((uploaded) => {
          const attachment = uploaded[0];
          if (!attachment || selectedRoomIdRef.current !== roomId) return;
          setVoiceReview({
            attachmentId: attachment.id,
            durationSeconds,
            roomId,
          });
          setVoicePlaybackSeconds(0);
          setVoiceReviewPlaying(false);
        });
      };

      recorder.start();
      startRecordingTimer();
    } catch (voiceError) {
      clearRecordingTimer();
      stopRecordingTracks();
      mediaRecorderRef.current = null;
      setRecording(false);
      setRecordingPaused(false);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      setError(
        voiceError instanceof Error
          ? voiceError.message
          : t(
              "Unable to access the microphone.",
              "មិនអាចចូលប្រើមីក្រូហ្វូនបានទេ។",
            ),
      );
    }
  }

  async function toggleVoiceReviewPlayback() {
    const audio = voicePreviewAudioRef.current;
    if (!audio) return;

    if (voiceReviewPlaying) {
      audio.pause();
      setVoiceReviewPlaying(false);
      return;
    }

    try {
      await audio.play();
      setVoiceReviewPlaying(true);
    } catch {
      setVoiceReviewPlaying(false);
    }
  }

  function discardVoiceReview() {
    if (voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.pause();
    }

    const attachmentId = voiceReview?.attachmentId;
    setVoiceReview(null);
    setVoiceReviewPlaying(false);
    setVoicePlaybackSeconds(0);

    if (attachmentId) {
      void discardAttachment(attachmentId);
    }
  }

  function reRecordVoice() {
    discardVoiceReview();
    window.setTimeout(() => {
      void toggleVoiceRecording();
    }, 0);
  }


  async function discardAttachment(attachmentId: string) {
    setPendingAttachments((current) =>
      current.filter((item) => item.id !== attachmentId),
    );

    await fetch(
      `/api/team-chat/attachments?attachmentId=${encodeURIComponent(
        attachmentId,
      )}`,
      { method: "DELETE" },
    ).catch(() => undefined);
  }

  async function startCall() {
    if (!selectedRoomId || callBusy) {
      return;
    }

    setCallBusy(true);
    setCallNotice(null);

    try {
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(
          selectedRoomId,
        )}/call`,
        { method: "POST" },
      );

      const result = await readJsonResponse<{
        success?: boolean;
        error?: string;
        code?: string;
        token?: string;
        serverUrl?: string;
        callRoom?: string;
      }>(response, "Unable to start call");

      if (!response.ok || !result.success) {
        setCallNotice(
          result.code === "CALLS_NOT_CONFIGURED"
            ? t(
                "Group calling is not set up yet. Add your LiveKit keys to enable it.",
                "ការហៅជាក្រុមមិនទាន់ត្រូវបានរៀបចំទេ។ សូមបញ្ចូលកូនសោ LiveKit ដើម្បីបើកវា។",
              )
            : (result.error ?? "Unable to start call."),
        );
        return;
      }

      // The token is minted and room access is verified. Rendering the
      // call surface needs the LiveKit client packages — see
      // GROUP-CHAT-FEATURES.md.
      setCallNotice(
        t(
          "Call ready. The in-app call screen is not installed yet.",
          "ការហៅរួចរាល់។ អេក្រង់ហៅក្នុងកម្មវិធីមិនទាន់ត្រូវបានដំឡើងទេ។",
        ),
      );
    } catch (callError) {
      setCallNotice(
        callError instanceof Error
          ? callError.message
          : "Unable to start call.",
      );
    } finally {
      setCallBusy(false);
    }
  }

  async function sendMessage() {
    if (
      !selectedRoomId ||
      (!messageText.trim() && pendingAttachments.length === 0) ||
      sending
    ) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(
          selectedRoomId,
        )}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageText,
            mentionedMemberIds,
            mentionEveryone,
            attachmentIds: pendingAttachments.map(
              (attachment) => attachment.id,
            ),
          }),
        },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
          message?: TeamMessage;
        }>(response, "Unable to send team message");

      if (!response.ok || !result.success || !result.message) {
        throw new Error(
          result.error ?? "Unable to send team message.",
        );
      }

      const sentMessage = result.message;

      setMessages((current) => {
        const withoutDuplicate = current.filter(
          (message) => message.id !== sentMessage.id,
        );

        return [...withoutDuplicate, sentMessage].sort(
          (first, second) =>
            new Date(first.created_at).getTime() -
            new Date(second.created_at).getTime(),
        );
      });

      setMessageText("");
      setMentionedMemberIds([]);
      setMentionEveryone(false);
      setPendingAttachments([]);
      setEmojiOpen(false);
      void markRoomRead(selectedRoomId);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send team message.",
      );
    } finally {
      setSending(false);
    }
  }

  async function createGroup() {
    if (!createName.trim() || modalBusy) {
      return;
    }

    setModalBusy(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/team-chat/rooms",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: createName,
            description: createDescription,
            memberIds: createMemberIds,
          }),
        },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
          room?: { id?: string };
        }>(response, "Unable to create team group");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to create team group.",
        );
      }

      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
      setCreateMemberIds([]);

      if (result.room?.id) {
        // Select the new room immediately. loadRooms() now preserves the
        // current selection instead of forcing the old URL room.
        chooseRoom(result.room.id);
      }

      await loadRooms();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create team group.",
      );
    } finally {
      setModalBusy(false);
    }
  }

  function openManageMembers() {
    if (!selectedRoom || selectedRoom.is_general) {
      return;
    }

    setManageMemberIds(selectedRoom.member_ids);
    setManageMembersOpen(true);
  }

  async function saveMembers() {
    if (!selectedRoom || modalBusy) {
      return;
    }

    setModalBusy(true);

    try {
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(
          selectedRoom.id,
        )}/members`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            memberIds: manageMemberIds,
          }),
        },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
        }>(response, "Unable to update group members");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to update group members.",
        );
      }

      setManageMembersOpen(false);
      await loadRooms();
    } catch (memberError) {
      setError(
        memberError instanceof Error
          ? memberError.message
          : "Unable to update group members.",
      );
    } finally {
      setModalBusy(false);
    }
  }

  async function deleteGroup() {
    if (
      !selectedRoom ||
      selectedRoom.is_general ||
      !canManage ||
      modalBusy
    ) {
      return;
    }

    setModalBusy(true);
    setError(null);

    try {
      const roomId = selectedRoom.id;
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(roomId)}`,
        { method: "DELETE" },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
        }>(response, "Unable to delete team group");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to delete team group.",
        );
      }

      applyDeletedRoom(roomId);
      setManageMembersOpen(false);
      setDeleteGroupOpen(false);
      await loadRooms();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete team group.",
      );
    } finally {
      setModalBusy(false);
    }
  }

  function beginEditMessage(message: TeamMessage) {
    draftBeforeEditRef.current = messageText;
    setEditingMessageId(message.id);
    setMessageText(message.message_text);
    setMentionedMemberIds([]);
    setMentionEveryone(false);
    setEmojiOpen(false);
    setError(null);

    window.requestAnimationFrame(() => {
      const textarea = composerRef.current?.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
        textarea.select();
        textarea.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setMessageText(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
  }

  async function saveEditedMessage() {
    if (!editingMessageId || !messageText.trim() || sending) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/team-chat/messages/${encodeURIComponent(editingMessageId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageText }),
        },
      );

      const result = await readJsonResponse<{
        success?: boolean;
        error?: string;
        message?: TeamMessage;
      }>(response, "Unable to edit team message");

      if (!response.ok || !result.success || !result.message) {
        throw new Error(result.error ?? "Unable to edit team message.");
      }

      const updatedMessage = result.message;
      setMessages((current) =>
        current.map((item) =>
          item.id === updatedMessage.id ? updatedMessage : item,
        ),
      );

      setEditingMessageId(null);
      setMessageText(draftBeforeEditRef.current);
      draftBeforeEditRef.current = "";
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "Unable to edit team message.",
      );
    } finally {
      setSending(false);
    }
  }

  async function deleteMessage(message: TeamMessage) {
    if (deleteMessageBusy) {
      return;
    }

    setDeleteMessageBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/team-chat/messages/${encodeURIComponent(
          message.id,
        )}`,
        { method: "DELETE" },
      );
      const result = await readJsonResponse<{
        success?: boolean;
        error?: string;
      }>(response, "Unable to delete team message");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to delete team message.",
        );
      }

      if (editingMessageId === message.id) {
        cancelEditMessage();
      }

      setMessages((current) =>
        current.filter((item) => item.id !== message.id),
      );
      setDeleteMessageTarget(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete team message.",
      );
    } finally {
      setDeleteMessageBusy(false);
    }
  }

  const totalUnread = rooms.reduce(
    (sum, room) => sum + (room.badge_count ?? room.unread_count),
    0,
  );

  if (loadingRooms) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
        {t("Loading internal team chat...", "កំពុងផ្ទុកការជជែកក្រុមខាងក្នុង...")}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-white">
      {/* LEFT — GROUP LIST */}
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-5">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-slate-950">
              {t("Group Chat", "ជជែកជាក្រុម")}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {t("Internal team only", "សម្រាប់ក្រុមខាងក្នុងតែប៉ុណ្ណោះ")}
            </p>
          </div>

          {canManage ? (
            <button
              type="button"
              onClick={() => {
                setCreateMemberIds(
                  currentMember ? [currentMember.id] : [],
                );
                setCreateOpen(true);
              }}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              <UserRoundPlus className="h-4 w-4" strokeWidth={2.1} />
              {t("New group", "ក្រុមថ្មី")}
            </button>
          ) : null}

          <button
            type="button"
            disabled
            title={t("Coming soon", "មកដល់ឆាប់ៗនេះ")}
            className={`${canManage ? "mt-2" : "mt-5"} flex min-h-[58px] w-full cursor-not-allowed items-center gap-3 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-left text-slate-400`}
          >
            <Send className="h-4 w-4 shrink-0" strokeWidth={2.1} />
            <span className="min-w-0">
              <span className="block whitespace-normal text-[13px] font-semibold leading-5">
                {t("Add to your Telegram group", "ភ្ជាប់ទៅក្រុម Telegram របស់អ្នក")}
              </span>
              <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {t("Coming soon", "ឆាប់ៗនេះ")}
              </span>
            </span>
          </button>

          <div className="mt-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                aria-label={t("Search groups", "ស្វែងរកក្រុម")}
                placeholder={t("Search groups...", "ស្វែងរកក្រុម...")}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => {
                  const value = event.currentTarget.value.trim().toLowerCase();
                  event.currentTarget.dataset.query = value;
                  const buttons =
                    event.currentTarget
                      .closest("aside")
                      ?.querySelectorAll<HTMLElement>("[data-room-name]");
                  buttons?.forEach((button) => {
                    const name = button.dataset.roomName ?? "";
                    button.style.display =
                      !value || name.includes(value) ? "" : "none";
                  });
                }}
              />
            </div>

            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
              aria-label={t("Filter groups", "តម្រងក្រុម")}
            >
              <Filter className="h-4 w-4" strokeWidth={2.1} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {rooms.map((room) => {
            const selected = room.id === selectedRoomId;

            return (
              <button
                key={room.id}
                type="button"
                data-room-name={`${room.name} ${roomDisplayName(room)}`.toLowerCase()}
                onClick={() => chooseRoom(room.id)}
                className={`mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                  selected
                    ? "border-blue-100 bg-blue-50/80 shadow-sm"
                    : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base font-extrabold text-white ${
                    room.is_general
                      ? "bg-blue-600"
                      : selected
                        ? "bg-violet-600"
                        : "bg-slate-400"
                  }`}
                >
                  #
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="block truncate text-sm font-bold text-slate-900">
                      {roomDisplayName(room)}
                    </span>
                    {selected &&
                    (room.badge_count ?? room.unread_count) === 0 ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {isKhmer
                      ? `សមាជិក ${room.member_count} នាក់`
                      : `${room.member_count} member${room.member_count === 1 ? "" : "s"}`}
                  </span>
                </span>

                {room.is_muted ? (
                  <BellOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                ) : null}

                {(room.badge_count ?? room.unread_count) > 0 ? (
                  <span className="flex min-w-6 items-center justify-center rounded-full bg-blue-600 px-2 py-1 text-[10px] font-extrabold text-white">
                    {(room.badge_count ?? room.unread_count) > 99
                      ? "99+"
                      : (room.badge_count ?? room.unread_count)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

      </aside>

      {/* CENTER — CHAT */}
      <main className="relative flex min-w-0 flex-1 flex-col bg-white">
        {selectedRoom ? (
          <>
            <header className="flex min-h-[82px] shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-extrabold text-slate-900">#</span>
                  <h2 className="truncate text-[24px] font-extrabold tracking-[-0.03em] text-slate-950">
                    {roomDisplayName(selectedRoom)}
                  </h2>

                  {selectedRoom.is_general ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      {t("Everyone", "គ្រប់គ្នា")}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 truncate text-sm text-slate-500">
                  {roomDescription(selectedRoom)}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden shrink-0 -space-x-2 sm:flex">
                  {members
                    .filter((member) =>
                      selectedRoom.member_ids.includes(member.id),
                    )
                    .slice(0, 4)
                    .map((member) =>
                      member.profile_picture_url ? (
                        <img
                          key={member.id}
                          src={member.profile_picture_url}
                          alt=""
                          className="h-9 w-9 rounded-full border-2 border-white object-cover"
                        />
                      ) : (
                        <div
                          key={member.id}
                          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-bold text-slate-600"
                        >
                          {getInitial(member.full_name)}
                        </div>
                      ),
                    )}

                  {selectedRoom.member_count > 4 ? (
                    <div className="flex h-9 min-w-9 items-center justify-center rounded-full border-2 border-white bg-slate-100 px-2 text-xs font-semibold text-slate-500">
                      +{selectedRoom.member_count - 4}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((open) => !open);
                    setSearchResults([]);
                    setSearchTerm("");
                  }}
                  className={`hidden h-10 w-10 items-center justify-center rounded-full border transition lg:flex ${
                    searchOpen
                      ? "border-blue-300 bg-blue-50 text-blue-600"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                  aria-label={t("Search conversation", "ស្វែងរកការសន្ទនា")}
                >
                  <Search className="h-4 w-4" strokeWidth={2.1} />
                </button>

                <button
                  type="button"
                  onClick={() => setShowDetails((value) => !value)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition ${
                    showDetails
                      ? "border-blue-300 bg-blue-50 text-blue-600"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                  aria-pressed={showDetails}
                  aria-label={
                    showDetails
                      ? t("Hide details", "លាក់ព័ត៌មានលម្អិត")
                      : t("Show details", "បង្ហាញព័ត៌មានលម្អិត")
                  }
                  title={
                    showDetails
                      ? t("Hide details", "លាក់ព័ត៌មានលម្អិត")
                      : t("Show details", "បង្ហាញព័ត៌មានលម្អិត")
                  }
                >
                  {showDetails ? (
                    <PanelRightClose className="h-4 w-4" strokeWidth={2.1} />
                  ) : (
                    <PanelRightOpen className="h-4 w-4" strokeWidth={2.1} />
                  )}
                </button>
              </div>
            </header>

            {callNotice ? (
              <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
                <Video className="h-4 w-4 shrink-0" />
                <span className="flex-1">{callNotice}</span>
                <button
                  type="button"
                  onClick={() => setCallNotice(null)}
                  className="rounded-md p-1 hover:bg-amber-100"
                  aria-label={t("Dismiss", "បិទ")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            {searchOpen ? (
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                <div className="mx-auto flex max-w-4xl items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={searchTerm}
                      autoFocus
                      onChange={(event) => {
                        setSearchTerm(event.target.value);
                        queueSearch(event.target.value);
                      }}
                      placeholder={t(
                        "Search this conversation...",
                        "ស្វែងរកការសន្ទនានេះ...",
                      )}
                      className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchTerm("");
                      setSearchResults([]);
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    {t("Close", "បិទ")}
                  </button>
                </div>

                {searchTerm.trim().length >= 2 ? (
                  <div className="mx-auto mt-3 max-w-4xl">
                    {!searching && searchResults.length > 0 ? (
                      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {searchResults.length}
                        {searchHasMore ? "+" : ""}{" "}
                        {t("results", "លទ្ធផល")}
                      </p>
                    ) : null}

                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {searching ? (
                      <p className="px-1 text-sm text-slate-500">
                        {t("Searching...", "កំពុងស្វែងរក...")}
                      </p>
                    ) : searchResults.length === 0 ? (
                      <p className="px-1 text-sm text-slate-500">
                        {t("No messages found.", "រកមិនឃើញសារទេ។")}
                      </p>
                    ) : (
                      searchResults.map((hit) => {
                        const hitSender = normalizeSender(hit.sender);

                        return (
                          <div
                            key={hit.id}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                          >
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-semibold text-slate-700">
                                {hitSender?.full_name ??
                                  t("Team member", "សមាជិកក្រុម")}
                              </span>
                              <span>
                                {formatMessageTime(hit.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-sm text-slate-700">
                              {hit.message_text}
                            </p>
                          </div>
                        );
                      })
                    )}

                    {searchHasMore && !searching ? (
                      <button
                        type="button"
                        onClick={() => {
                          const nextLimit = Math.min(
                            searchLimit + 25,
                            100,
                          );
                          setSearchLimit(nextLimit);
                          void runSearch(searchTerm, nextLimit);
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white py-2 text-sm font-semibold text-blue-600 hover:bg-slate-50"
                      >
                        {t("Load more results", "ផ្ទុកលទ្ធផលបន្ថែម")}
                      </button>
                    ) : null}
                    </div>

                    {searchHasMore && searchLimit >= 100 ? (
                      <p className="mt-2 px-1 text-xs text-slate-400">
                        {t(
                          "Showing the 100 most recent matches. Add another word to narrow it down.",
                          "កំពុងបង្ហាញលទ្ធផលថ្មីបំផុត 100។ សូមបន្ថែមពាក្យមួយទៀតដើម្បីបង្រួម។",
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-5">
              {loadingMessages ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  {t("Loading messages...", "កំពុងផ្ទុកសារ...")}
                </div>
              ) : messages.length === 0 ? (
                <div className="mx-auto mt-16 max-w-md text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-bold text-blue-700">
                    #
                  </div>
                  <h3 className="mt-4 font-bold text-slate-900">
                    {t("Start", "ចាប់ផ្តើម")} #{roomDisplayName(selectedRoom)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {t(
                      "Messages here are private to your internal team and are never sent to customers.",
                      "សារនៅទីនេះជាសារឯកជនសម្រាប់ក្រុមខាងក្នុងរបស់អ្នក ហើយមិនត្រូវបានផ្ញើទៅអតិថិជនទេ។",
                    )}
                  </p>
                </div>
              ) : (
                <div className="mx-auto max-w-4xl space-y-5">
                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-xs font-medium text-slate-400">
                      {t("Today", "ថ្ងៃនេះ")}
                    </span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  {messages.map((message) => {
                    const payloadSender = normalizeSender(message.sender);
                    const sender =
                      members.find(
                        (member) => member.id === message.sender_member_id,
                      ) ?? payloadSender;
                    const mine =
                      message.sender_member_id === currentMember?.id;
                    const canDelete = mine || canManage;
                    const attachments = message.attachments ?? [];
                    const imageAttachments = attachments.filter(
                      (attachment) =>
                        attachment.kind === "image" && Boolean(attachment.url),
                    );
                    const otherAttachments = attachments.filter(
                      (attachment) =>
                        attachment.kind !== "image" || !attachment.url,
                    );

                    return (
                      <article
                        key={message.id}
                        className={`group flex items-start gap-3 ${
                          mine ? "justify-end" : ""
                        }`}
                      >
                        {!mine &&
                          (sender?.profile_picture_url ? (
                            <img
                              src={sender.profile_picture_url}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                              {getInitial(sender?.full_name)}
                            </div>
                          ))}

                        <div
                          className={`min-w-0 ${
                            mine
                              ? "flex max-w-[78%] flex-col items-end"
                              : "flex-1"
                          }`}
                        >
                          {!mine ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-900">
                                {sender?.full_name ??
                                  t("Team member", "សមាជិកក្រុម")}
                              </span>
                            </div>
                          ) : null}

                          {message.message_text ? (
                            <div
                              className={`inline-block max-w-[760px] whitespace-pre-wrap break-words border px-4 pb-2 pt-3 text-left text-sm leading-6 shadow-[0_2px_8px_rgba(15,23,42,0.06)] ${
                                mine
                                  ? "rounded-[18px] rounded-br-[5px] border-blue-600 bg-blue-600 text-white"
                                  : "mt-1.5 rounded-[18px] rounded-bl-[5px] border-slate-200/90 bg-white text-slate-900"
                              }`}
                              style={
                                mine
                                  ? {
                                      backgroundColor:
                                        "var(--tenh-primary, #2563EB)",
                                      borderColor:
                                        "var(--tenh-primary, #2563EB)",
                                    }
                                  : undefined
                              }
                            >
                              <div>{message.message_text}</div>
                              <div
                                className={`mt-1 flex items-center gap-1.5 text-[10px] leading-none ${
                                  mine
                                    ? "justify-end text-white/75"
                                    : "justify-start text-slate-500"
                                }`}
                              >
                                <span>{formatMessageTime(message.created_at)}</span>
                                {message.edited_at ? (
                                  <span
                                    className={
                                      mine ? "text-white/70" : "text-slate-400"
                                    }
                                  >
                                    {t("edited", "បានកែសម្រួល")}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {attachments.length > 0 ? (
                            <div
                              className={`flex max-w-[760px] flex-col gap-2 ${
                                message.message_text ? "mt-2" : mine ? "" : "mt-1.5"
                              } ${mine ? "items-end" : "items-start"}`}
                            >
                              {imageAttachments.length > 0 ? (
                                <div
                                  className={`grid w-full gap-1.5 ${
                                    imageAttachments.length === 1
                                      ? "max-w-[320px] grid-cols-1"
                                      : imageAttachments.length === 2
                                        ? "max-w-[420px] grid-cols-2"
                                        : "max-w-[510px] grid-cols-3"
                                  } ${mine ? "ml-auto" : ""}`}
                                >
                                  {imageAttachments.slice(0, 9).map(
                                    (attachment, index) => (
                                      <a
                                        key={attachment.id}
                                        href={attachment.url ?? undefined}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
                                      >
                                        <img
                                          src={attachment.url ?? ""}
                                          alt={attachment.file_name}
                                          className="h-full w-full object-cover"
                                        />
                                        {index === 8 &&
                                        imageAttachments.length > 9 ? (
                                          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/55 text-lg font-bold text-white">
                                            +{imageAttachments.length - 9}
                                          </span>
                                        ) : null}
                                      </a>
                                    ),
                                  )}
                                </div>
                              ) : null}

                              {otherAttachments.length > 0 ? (
                                <div
                                  className={`flex flex-wrap gap-2 ${
                                    mine ? "justify-end" : "justify-start"
                                  }`}
                                >
                                  {otherAttachments.map((attachment) => {
                                    if (!attachment.url) {
                                      return (
                                        <span
                                          key={attachment.id}
                                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400"
                                        >
                                          {attachment.file_name}
                                        </span>
                                      );
                                    }

                                    if (attachment.kind === "video") {
                                      return (
                                        <video
                                          key={attachment.id}
                                          src={attachment.url}
                                          controls
                                          className="block max-h-[320px] w-full max-w-[360px] rounded-2xl border border-slate-200 bg-slate-950 shadow-sm"
                                        />
                                      );
                                    }

                                    if (attachment.kind === "audio") {
                                      return (
                                        <audio
                                          key={attachment.id}
                                          src={attachment.url}
                                          controls
                                          className="w-64"
                                        />
                                      );
                                    }

                                    return (
                                      <a
                                        key={attachment.id}
                                        href={attachment.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                                      >
                                        <Paperclip className="h-4 w-4 text-slate-400" />
                                        <span className="max-w-[220px] truncate">
                                          {attachment.file_name}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                          {formatBytes(attachment.byte_size)}
                                        </span>
                                      </a>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {mine ? (
                            <div className="mt-1 flex min-h-6 items-center justify-end gap-1.5">
                              {!message.message_text ? (
                                <span className="text-[11px] text-slate-400">
                                  {formatMessageTime(message.created_at)}
                                  {message.edited_at
                                    ? ` · ${t("edited", "បានកែសម្រួល")}`
                                    : ""}
                                </span>
                              ) : null}
                              <div className="ml-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => beginEditMessage(message)}
                                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                                >
                                  {t("Edit", "កែសម្រួល")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteMessageTarget(message)}
                                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 transition hover:bg-red-50 hover:text-red-600"
                                >
                                  {t("Delete", "លុប")}
                                </button>
                              </div>
                            </div>
                          ) : canDelete ? (
                            <div className="mt-1 flex min-h-6 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                              <button
                                type="button"
                                onClick={() => setDeleteMessageTarget(message)}
                                className="rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 transition hover:bg-red-50 hover:text-red-600"
                              >
                                {t("Delete", "លុប")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-white">
              <div className="mx-auto max-w-5xl">
                <div
                  ref={composerRef}
                  className="relative w-full min-w-0 bg-white px-3 py-2"
                >
                  {editingMessageId ? (
                    <div className="mb-2 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                      <span className="font-semibold">
                        {t("Editing message", "កំពុងកែសម្រួលសារ")}
                      </span>
                      <button
                        type="button"
                        onClick={cancelEditMessage}
                        className="rounded-md p-1 text-blue-500 hover:bg-blue-100 hover:text-blue-700"
                        aria-label={t("Cancel editing", "បោះបង់ការកែសម្រួល")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}

                  {recording ? (
                    <div className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-[0_5px_18px_rgba(15,23,42,0.07)]">
                      <div className="flex min-w-[92px] shrink-0 items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            recordingPaused
                              ? "bg-slate-400"
                              : "animate-pulse bg-red-500"
                          }`}
                        />
                        <span className="text-sm font-semibold text-slate-800">
                          {recordingPaused
                            ? t("Paused", "បានផ្អាក")
                            : t("Recording", "កំពុងថត")}
                        </span>
                      </div>

                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[2px] overflow-hidden px-2">
                          {[7,11,6,15,9,18,12,21,14,10,17,23,13,8,16,20,11,15,7,19,12,22,14,9,17,12,20,8,15,11,18,7,13,10,16,8,12,7,14,9,11,6].map((height, index) => (
                            <span
                              key={index}
                              className={`w-[2px] shrink-0 rounded-full ${
                                recordingPaused
                                  ? "bg-slate-300"
                                  : index % 4 === 0
                                    ? "bg-blue-500"
                                    : "bg-slate-400"
                              }`}
                              style={{
                                height: `${Math.max(4, height - (recordingPaused ? 4 : 0))}px`,
                                opacity: recordingPaused ? 0.75 : 1,
                              }}
                            />
                          ))}
                        </div>

                        <div className="w-[62px] shrink-0 text-right">
                          <div className="font-mono text-sm font-bold tabular-nums text-slate-900">
                            {formatVoiceDuration(recordingSeconds)}
                          </div>
                          <div className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                            {formatVoiceDuration(Math.max(0, 300 - recordingSeconds))} {t("left", "នៅសល់")}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={cancelVoiceRecording}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{t("Discard", "បោះចោល")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={recordingPaused ? resumeVoiceRecording : pauseVoiceRecording}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                      >
                        {recordingPaused ? (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                            <path d="M8 5v14l11-7-11-7Z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                            <rect x="7" y="5" width="3.5" height="14" rx="1" />
                            <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
                          </svg>
                        )}
                        <span>{recordingPaused ? t("Resume", "បន្ត") : t("Pause", "ផ្អាក")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={finishVoiceRecording}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(37,99,235,0.22)] transition hover:bg-blue-700"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>{t("Done", "រួចរាល់")}</span>
                      </button>
                    </div>
                  ) : voiceReview && voiceReviewAttachment?.url ? (
                    <div className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-[0_5px_18px_rgba(15,23,42,0.07)]">
                      <button
                        type="button"
                        onClick={() => void toggleVoiceReviewPlayback()}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-blue-600 transition hover:border-blue-200 hover:bg-blue-50"
                        aria-label={voiceReviewPlaying ? t("Pause voice preview", "ផ្អាកសំឡេងមើលជាមុន") : t("Play voice preview", "ចាក់សំឡេងមើលជាមុន")}
                      >
                        {voiceReviewPlaying ? (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                            <rect x="7" y="5" width="3.5" height="14" rx="1" />
                            <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 translate-x-[1px]" aria-hidden="true">
                            <path d="M8 5v14l11-7-11-7Z" />
                          </svg>
                        )}
                      </button>

                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-8 min-w-[180px] flex-1 items-center gap-[2px] overflow-hidden">
                          {[4,8,6,12,9,16,10,19,13,22,17,25,20,14,18,24,15,11,20,17,13,21,16,10,12,18,14,22,19,15,11,17,13,9,12,8,10,7,9,5,7,4].map((height, index) => {
                            const ratio = voiceReview.durationSeconds > 0
                              ? Math.min(1, voicePlaybackSeconds / voiceReview.durationSeconds)
                              : 0;
                            const played = index / 42 <= ratio;
                            return (
                              <span
                                key={index}
                                className={`w-[2px] shrink-0 rounded-full ${played || voicePlaybackSeconds === 0 ? "bg-blue-600" : "bg-blue-300"}`}
                                style={{ height: `${height}px` }}
                              />
                            );
                          })}
                        </div>
                        <div className="w-[68px] shrink-0">
                          <div className="font-mono text-sm font-bold tabular-nums text-slate-900">
                            {formatVoiceDuration(voicePlaybackSeconds > 0 ? voicePlaybackSeconds : voiceReview.durationSeconds)}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {t("of", "នៃ")} {formatVoiceDuration(voiceReview.durationSeconds)}
                          </div>
                        </div>
                      </div>

                      <audio
                        ref={voicePreviewAudioRef}
                        src={voiceReviewAttachment.url}
                        preload="metadata"
                        className="hidden"
                        onTimeUpdate={(event) => setVoicePlaybackSeconds(event.currentTarget.currentTime)}
                        onEnded={() => {
                          setVoiceReviewPlaying(false);
                          setVoicePlaybackSeconds(0);
                        }}
                        onPause={() => setVoiceReviewPlaying(false)}
                        onPlay={() => setVoiceReviewPlaying(true)}
                      />

                      <button
                        type="button"
                        onClick={reRecordVoice}
                        disabled={sending}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                          <path d="M20 11a8 8 0 1 0-2.3 5.7" strokeLinecap="round" />
                          <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>{t("Re-record", "ថតឡើងវិញ")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={discardVoiceReview}
                        disabled={sending}
                        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{t("Discard", "បោះចោល")}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void sendMessage()}
                        disabled={sending || uploading}
                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        <span>{sending ? t("Sending...", "កំពុងផ្ញើ...") : t("Send voice note", "ផ្ញើសារជាសំឡេង")}</span>
                      </button>
                    </div>
                  ) : null}

                  <div className={recording || voiceReview ? "hidden" : ""}>
                    {pendingAttachments.length > 0 ? (
                      <div className="mb-2 flex flex-wrap items-end gap-2 px-1">
                        {pendingAttachments.map((attachment) =>
                          attachment.kind === "image" && attachment.url ? (
                            <div
                              key={attachment.id}
                              className="group/preview relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
                            >
                              <img
                                src={attachment.url}
                                alt=""
                                className="block h-28 w-28 object-cover sm:h-32 sm:w-32"
                              />
                              <button
                                type="button"
                                onClick={() => void discardAttachment(attachment.id)}
                                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/65 text-white shadow-sm transition hover:bg-slate-950/80"
                                aria-label={t("Remove image", "លុបរូបភាពចេញ")}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div
                              key={attachment.id}
                              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                            >
                              <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                              <span className="max-w-[180px] truncate">
                                {attachment.file_name}
                              </span>
                              <button
                                type="button"
                                onClick={() => void discardAttachment(attachment.id)}
                                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                aria-label={t("Remove", "លុបចេញ")}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}

                    <div className="flex min-w-0 items-center gap-1.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => void uploadFiles(event.target.files)}
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading || Boolean(editingMessageId)}
                        className="flex min-w-[56px] shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={t("Attach a file", "ភ្ជាប់ឯកសារ")}
                      >
                        <Paperclip className="h-5 w-5" />
                        <span>{t("Attach", "ភ្ជាប់")}</span>
                      </button>

                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setEmojiOpen((open) => !open)}
                          disabled={sending}
                          className={`flex min-w-[50px] flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 text-[10px] font-medium transition ${
                            emojiOpen
                              ? "bg-blue-50 text-blue-600"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                          } disabled:opacity-40`}
                          aria-label={t("Add emoji", "បញ្ចូលអ៊ីម៉ូជី")}
                          aria-expanded={emojiOpen}
                        >
                          <Smile className="h-5 w-5" />
                          <span>Emoji</span>
                        </button>

                        {emojiOpen ? (
                          <>
                            <button
                              type="button"
                              aria-hidden="true"
                              tabIndex={-1}
                              onClick={() => setEmojiOpen(false)}
                              className="fixed inset-0 z-40 cursor-default bg-transparent"
                            />
                            <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 overflow-hidden rounded-xl shadow-2xl">
                              <EmojiPicker
                                width={330}
                                height={400}
                                lazyLoadEmojis
                                onEmojiClick={(emojiData) => {
                                  setMessageText((current) => current + emojiData.emoji);
                                  setEmojiOpen(false);
                                }}
                              />
                            </div>
                          </>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => void toggleVoiceRecording()}
                        disabled={uploading || sending || Boolean(editingMessageId)}
                        className="flex min-w-[50px] shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                        aria-label={t("Record voice message", "ថតសារជាសំឡេង")}
                      >
                        <Mic className="h-5 w-5" />
                        <span>{t("Voice", "សំឡេង")}</span>
                      </button>

                      <MentionComposer
                        compact
                        value={messageText}
                        onChange={setMessageText}
                        members={members.filter(
                          (member) => member.id !== currentMember?.id,
                        )}
                        mentionedMemberIds={mentionedMemberIds}
                        onMentionedMemberIdsChange={setMentionedMemberIds}
                        mentionEveryone={mentionEveryone}
                        onMentionEveryoneChange={setMentionEveryone}
                        placeholder={
                          isKhmer
                            ? `សារ #${roomDisplayName(selectedRoom)}...`
                            : `Message #${selectedRoom.name}...`
                        }
                        rows={1}
                        disabled={sending}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          void (editingMessageId
                            ? saveEditedMessage()
                            : sendMessage())
                        }
                        disabled={
                          sending ||
                          uploading ||
                          recording ||
                          (editingMessageId
                            ? !messageText.trim()
                            : (!messageText.trim() &&
                              pendingAttachments.length === 0))
                        }
                        className="inline-flex h-12 min-w-[96px] shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" strokeWidth={2.1} />
                        <span>
                          {sending
                            ? editingMessageId
                              ? t("Saving...", "កំពុងរក្សាទុក...")
                              : t("Sending...", "កំពុងផ្ញើ...")
                            : editingMessageId
                              ? t("Save", "រក្សាទុក")
                              : t("Send", "ផ្ញើ")}
                        </span>
                      </button>
                    </div>

                    {uploading ? (
                      <p className="mt-1 px-1 text-[11px] text-slate-400">
                        {t("Uploading...", "កំពុងផ្ទុកឡើង...")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            {t("No team chat rooms available.", "មិនមានបន្ទប់ជជែកក្រុមទេ។")}
          </div>
        )}

        {error ? (
          <div className="absolute bottom-5 right-5 z-50 max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
            <div className="flex items-start gap-3">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="font-bold"
              >
                ×
              </button>
            </div>
          </div>
        ) : null}
      </main>

      {/* RIGHT — DETAILS */}
      {selectedRoom ? (
        <aside
          className={`w-[300px] shrink-0 flex-col border-l border-slate-200 bg-white ${
            showDetails ? "hidden xl:flex" : "hidden"
          }`}
        >
          <div className="flex h-[82px] items-center justify-between border-b border-slate-200 px-5">
            <h3 className="text-lg font-extrabold text-slate-950">
              {t("Details", "ព័ត៌មានលម្អិត")}
            </h3>
            <X className="h-4 w-4 text-slate-400" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <section className="border-b border-slate-200 pb-5">
              <p className="text-sm font-bold text-slate-900">
                {t("About", "អំពី")}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {selectedRoom.description
                  ? (isKhmer && selectedRoom.is_general && selectedRoom.description.trim() === "Company-wide internal team chat."
                      ? "ការជជែកក្រុមខាងក្នុងទូទាំងក្រុមហ៊ុន។"
                      : selectedRoom.description)
                  : t(
                      "Internal team conversation for this workspace.",
                      "ការសន្ទនាក្រុមខាងក្នុងសម្រាប់កន្លែងធ្វើការនេះ។",
                    )}
              </p>
            </section>

            <section className="divide-y divide-slate-200 border-b border-slate-200 py-1">
              <div className="flex items-center justify-between py-4 text-sm">
                <div className="flex items-center gap-3 text-slate-600">
                  <Users className="h-4 w-4" />
                  {t("Members", "សមាជិក")}
                </div>
                <span className="font-medium text-slate-500">
                  {selectedRoom.member_count}
                </span>
              </div>

              <div className="flex items-center justify-between py-4 text-sm">
                <div className="flex items-center gap-3 text-slate-600">
                  <Bell className="h-4 w-4" />
                  {t("Notifications", "ការជូនដំណឹង")}
                </div>
                <span className="font-medium text-slate-500">
                  {t("All messages", "សារទាំងអស់")}
                </span>
              </div>

              <div className="flex items-center justify-between py-4 text-sm">
                <div className="flex items-center gap-3 text-slate-600">
                  <BellOff className="h-4 w-4" />
                  {t("Muted", "បិទសំឡេង")}
                </div>

                <button
                  type="button"
                  onClick={() => void toggleMute()}
                  disabled={muteBusy}
                  className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${
                    selectedRoom.is_muted
                      ? "bg-blue-600"
                      : "bg-slate-300"
                  }`}
                  aria-pressed={selectedRoom.is_muted === true}
                  aria-label={
                    selectedRoom.is_muted
                      ? t("Unmute group", "បើកសំឡេងក្រុម")
                      : t("Mute group", "បិទសំឡេងក្រុម")
                  }
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
                      selectedRoom.is_muted ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>
            </section>

            <section className="border-b border-slate-200 py-5">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">
                  {t("Members", "សមាជិក")} ({selectedRoom.member_count})
                </h4>

                {canManage && !selectedRoom.is_general ? (
                  <button
                    type="button"
                    onClick={openManageMembers}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {t("Manage", "គ្រប់គ្រង")}
                  </button>
                ) : null}
              </div>

              <div className="space-y-3">
                {members
                  .filter((member) =>
                    selectedRoom.member_ids.includes(member.id),
                  )
                  .slice(0, 8)
                  .map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3"
                    >
                      {member.profile_picture_url ? (
                        <img
                          src={member.profile_picture_url}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                          {getInitial(member.full_name)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {member.full_name}
                        </p>
                        <p className="truncate text-xs capitalize text-slate-400">
                          {roleLabel(member.role)}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            <section className="py-5">
              <p className="mb-3 text-sm font-bold text-slate-900">
                {t("Quick actions", "សកម្មភាពរហ័ស")}
              </p>

              <div className="grid gap-2">
                {canManage && !selectedRoom.is_general ? (
                  <>
                    <button
                      type="button"
                      onClick={openManageMembers}
                      disabled={modalBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Settings2 className="h-4 w-4" />
                      {t("Manage members", "គ្រប់គ្រងសមាជិក")}
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeleteGroupOpen(true)}
                      disabled={modalBusy}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      {modalBusy
                        ? t("Please wait...", "សូមរង់ចាំ...")
                        : t("Delete group", "លុបក្រុម")}
                    </button>
                  </>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
                    {t("The General group includes the whole workspace.", "ក្រុម ទូទៅ រួមបញ្ចូលកន្លែងធ្វើការទាំងមូល។")}
                  </div>
                )}
              </div>
            </section>

            <section className="border-t border-slate-200 py-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-slate-900">
                  {t("Files, documents & links", "ឯកសារ ឯកសារសំខាន់ និងតំណ")}
                </p>
                <button
                  type="button"
                  onClick={openTenhStorage}
                  className="shrink-0 text-xs font-semibold text-blue-600 transition hover:text-blue-700"
                >
                  {t("View all", "មើលទាំងអស់")}
                </button>
              </div>

              {sharedPreviewItems.length > 0 ? (
                <div className="space-y-2">
                  {sharedPreviewItems.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:bg-slate-50"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        {item.kind === "link" ? (
                          <Link2 className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-700">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {item.kind === "link"
                            ? t("Link", "តំណ")
                            : (item.meta ?? t("File", "ឯកសារ"))}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-400">
                  {t(
                    "Files and links shared in this group will appear here.",
                    "ឯកសារ និងតំណដែលបានចែករំលែកក្នុងក្រុមនេះនឹងបង្ហាញនៅទីនេះ។",
                  )}
                </div>
              )}
            </section>
          </div>
        </aside>
      ) : null}

      {storageOpen && selectedRoom ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tenh-storage-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setStorageOpen(false);
          }}
        >
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <FileText className="h-[18px] w-[18px]" />
                  </div>
                  <div>
                    <h2 id="tenh-storage-title" className="text-lg font-bold text-slate-950">
                      TENH Storage
                    </h2>
                    <p className="truncate text-xs text-slate-500">
                      #{roomDisplayName(selectedRoom)} · {t("Files, documents & links", "ឯកសារ ឯកសារសំខាន់ និងតំណ")}
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStorageOpen(false)}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label={t("Close TENH Storage", "បិទ TENH Storage")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-slate-200 px-5 py-3 sm:px-6">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={storageQuery}
                  onChange={(event) => setStorageQuery(event.target.value)}
                  placeholder={t("Search TENH Storage...", "ស្វែងរកក្នុង TENH Storage...")}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"
                />
              </div>

              <div className="mt-3 flex items-center gap-2">
                {([
                  ["file", t("File", "ឯកសារ"), FileText, storageCounts.file],
                  ["image", t("Image", "រូបភាព"), ImageIcon, storageCounts.image],
                  ["video", t("Video", "វីដេអូ"), Video, storageCounts.video],
                ] as const).map(([tab, label, TabIcon, count]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStorageTab(tab)}
                    className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                      storageTab === tab
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    }`}
                  >
                    <TabIcon className="h-4 w-4" />
                    <span>{label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      storageTab === tab
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                    }`}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {storageError ? (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {storageError}
                </div>
              ) : null}

              {storageLoading && storageItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  {t("Loading TENH Storage...", "កំពុងផ្ទុក TENH Storage...")}
                </div>
              ) : filteredStorageItems.length > 0 ? (
                storageTab === "image" ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {filteredStorageItems.map((item) => (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/storage relative aspect-square overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
                        aria-label={t("Open image", "បើករូបភាព")}
                      >
                        <img
                          src={item.url}
                          alt=""
                          className="h-full w-full object-cover transition duration-200 group-hover/storage:scale-[1.02]"
                        />
                      </a>
                    ))}
                  </div>
                ) : storageTab === "video" ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {filteredStorageItems.map((item) => (
                      <div
                        key={item.id}
                        className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950"
                      >
                        <video
                          src={item.url}
                          controls
                          preload="metadata"
                          className="aspect-video w-full bg-slate-950 object-contain"
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredStorageItems.map((item) => (
                      <a
                        key={item.id}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 transition hover:border-blue-200 hover:bg-blue-50/40"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          {item.kind === "link" ? (
                            <Link2 className="h-4 w-4" />
                          ) : (
                            <FileText className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-800">
                            {item.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {item.kind === "link"
                              ? t("Link", "តំណ")
                              : (item.meta ?? t("File", "ឯកសារ"))}
                            {" · "}
                            {formatMessageTime(item.createdAt)}
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                )
              ) : (
                <div className="py-12 text-center text-sm text-slate-400">
                  {storageQuery.trim()
                    ? t("No matching items.", "រកមិនឃើញធាតុដែលត្រូវគ្នាទេ។")
                    : storageTab === "image"
                      ? t("No images have been shared in this group yet.", "មិនទាន់មានរូបភាពត្រូវបានចែករំលែកក្នុងក្រុមនេះទេ។")
                      : storageTab === "video"
                        ? t("No videos have been shared in this group yet.", "មិនទាន់មានវីដេអូត្រូវបានចែករំលែកក្នុងក្រុមនេះទេ។")
                        : t("No files or links have been shared in this group yet.", "មិនទាន់មានឯកសារ ឬតំណត្រូវបានចែករំលែកក្នុងក្រុមនេះទេ។")}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3 sm:px-6">
              <span className="text-xs text-slate-400">
                {storageItems.length} {t("items loaded", "ធាតុបានផ្ទុក")}
              </span>
              {storageHasMore ? (
                <button
                  type="button"
                  onClick={() => void loadStorageItems(false)}
                  disabled={storageLoading}
                  className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50"
                >
                  {storageLoading
                    ? t("Loading...", "កំពុងផ្ទុក...")
                    : t("Load older", "ផ្ទុកចាស់ជាង")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {deleteMessageTarget ? (
        <ConfirmDeleteModal
          title={t("Delete message?", "លុបសារនេះ?")}
          description={t(
            "This message will be permanently deleted from the group. This action cannot be undone.",
            "សារនេះនឹងត្រូវលុបជាអចិន្ត្រៃយ៍ពីក្រុម។ សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។",
          )}
          confirmLabel={t("Delete", "លុប")}
          busy={deleteMessageBusy}
          onConfirm={() => void deleteMessage(deleteMessageTarget)}
          onClose={() => {
            if (!deleteMessageBusy) {
              setDeleteMessageTarget(null);
            }
          }}
        />
      ) : null}

      {deleteGroupOpen && selectedRoom && !selectedRoom.is_general ? (
        <ConfirmDeleteModal
          title={
            isKhmer
              ? `លុប #${roomDisplayName(selectedRoom)}?`
              : `Delete #${selectedRoom.name}?`
          }
          description={t(
            "All messages and memberships in this group will be permanently deleted. This action cannot be undone.",
            "សារ និងសមាជិកភាពទាំងអស់ក្នុងក្រុមនេះនឹងត្រូវលុបជាអចិន្ត្រៃយ៍។ សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។",
          )}
          confirmLabel={t("Delete group", "លុបក្រុម")}
          busy={modalBusy}
          onConfirm={() => void deleteGroup()}
          onClose={() => {
            if (!modalBusy) {
              setDeleteGroupOpen(false);
            }
          }}
        />
      ) : null}

      {createOpen ? (
        <RoomMembersModal
          title={t("Create team group", "បង្កើតក្រុមការងារ")}
          members={members}
          selectedMemberIds={createMemberIds}
          onSelectedMemberIdsChange={setCreateMemberIds}
          name={createName}
          onNameChange={setCreateName}
          description={createDescription}
          onDescriptionChange={setCreateDescription}
          showRoomFields
          busy={modalBusy}
          confirmLabel={t("Create group", "បង្កើតក្រុម")}
          onConfirm={() => void createGroup()}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}

      {manageMembersOpen && selectedRoom ? (
        <RoomMembersModal
          title={
            isKhmer
              ? `សមាជិកនៃ #${roomDisplayName(selectedRoom)}`
              : `Members of #${selectedRoom.name}`
          }
          members={members}
          selectedMemberIds={manageMemberIds}
          onSelectedMemberIdsChange={setManageMemberIds}
          busy={modalBusy}
          confirmLabel={t("Save members", "រក្សាទុកសមាជិក")}
          onConfirm={() => void saveMembers()}
          onClose={() => setManageMembersOpen(false)}
        />
      ) : null}
    </div>
  );

}

type ConfirmDeleteModalProps = {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

function ConfirmDeleteModal({
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tenh-delete-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Trash2 className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <h3
              id="tenh-delete-dialog-title"
              className="truncate text-base font-bold text-slate-950"
            >
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
            aria-label={t("Close", "បិទ")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm leading-6 text-slate-600">
            {description}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {t("Cancel", "បោះបង់")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-wait disabled:bg-red-300"
          >
            {busy ? t("Deleting...", "កំពុងលុប...") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type RoomMembersModalProps = {
  title: string;
  members: TeamMember[];
  selectedMemberIds: string[];
  onSelectedMemberIdsChange: (ids: string[]) => void;
  name?: string;
  onNameChange?: (value: string) => void;
  description?: string;
  onDescriptionChange?: (value: string) => void;
  showRoomFields?: boolean;
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

function RoomMembersModal({
  title,
  members,
  selectedMemberIds,
  onSelectedMemberIdsChange,
  name = "",
  onNameChange,
  description = "",
  onDescriptionChange,
  showRoomFields = false,
  busy,
  confirmLabel,
  onConfirm,
  onClose,
}: RoomMembersModalProps) {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const selected = new Set(selectedMemberIds);

  function toggle(memberId: string) {
    if (selected.has(memberId)) {
      onSelectedMemberIdsChange(
        selectedMemberIds.filter(
          (id) => id !== memberId,
        ),
      );
    } else {
      onSelectedMemberIdsChange([
        ...selectedMemberIds,
        memberId,
      ]);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="font-bold text-slate-950">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5">
          {showRoomFields ? (
            <div className="mb-5 space-y-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  {t("Group name", "ឈ្មោះក្រុម")}
                </label>
                <input
                  value={name}
                  onChange={(event) =>
                    onNameChange?.(event.target.value)
                  }
                  maxLength={80}
                  placeholder={t("Support Team", "ក្រុមគាំទ្រ")}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  {t("Description", "ការពិពណ៌នា")}
                </label>
                <input
                  value={description}
                  onChange={(event) =>
                    onDescriptionChange?.(
                      event.target.value,
                    )
                  }
                  placeholder={t("Optional group description", "ការពិពណ៌នាក្រុម (ស្រេចចិត្ត)")}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              {t("Team members", "សមាជិកក្រុម")}
            </p>
            <span className="text-xs text-slate-400">
              {isKhmer
                ? `បានជ្រើស ${selectedMemberIds.length}`
                : `${selectedMemberIds.length} selected`}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => toggle(member.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                  selected.has(member.id)
                    ? "bg-blue-50"
                    : ""
                }`}
              >
                {member.profile_picture_url ? (
                  <img
                    src={member.profile_picture_url}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {getInitial(member.full_name)}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {member.full_name}
                  </span>
                  <span className="block truncate text-xs capitalize text-slate-400">
                    {isKhmer
                      ? (member.role?.toLowerCase() === "owner"
                          ? "ម្ចាស់"
                          : member.role?.toLowerCase() === "agent"
                            ? "ភ្នាក់ងារ"
                            : "សមាជិកក្រុម")
                      : member.role}
                  </span>
                </span>

                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                    selected.has(member.id)
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-300 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            {t("Cancel", "បោះបង់")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={
              busy ||
              (showRoomFields && !name.trim())
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {busy ? t("Saving...", "កំពុងរក្សាទុក...") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
