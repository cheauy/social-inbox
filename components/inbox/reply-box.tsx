"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import EmojiPicker from "emoji-picker-react";

import { CustomerTagSelector } from "@/components/inbox/customer-tag-selector";
import {
  LocationPickerDialog,
  type PickedLocation,
} from "@/components/inbox/location-picker-dialog";
import { SavedReplySelector } from "@/components/inbox/saved-reply-selector";
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";

import type {
  ConversationStatus,
  CustomerTag,
} from "@/types/inbox";

import type {
  AgentPresence,
} from "@/lib/inbox/use-agent-presence";

export type ReplyAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "file";

export type ReplyAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  kind: ReplyAttachmentKind;
};

type ReplyBoxProps = {
  reply: string;
  conversationId: string;
  sending: boolean;
  error: string | null;
  blockedReason?: string | null;
  blockedTitle?: string | null;
  advisoryReason?: string | null;
  advisoryTitle?: string | null;

  contactId: string;
  businessId: string;
  initialTags: CustomerTag[];
  typingAgents?: AgentPresence[];

  onTagsChange?: (
    tags: CustomerTag[],
  ) => void;

  allowAttachments?: boolean;

  onReplyChange: (value: string) => void;

  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void;

  onSendAttachments?: (
    attachments: ReplyAttachment[],
  ) => Promise<boolean>;

  onStatusChange?: (
    status: ConversationStatus,
  ) => void;
};

const TENH_ATTACHMENT_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
} satisfies Record<
  ReplyAttachmentKind,
  number
>;

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function ImageIcon() {
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
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
      />
      <circle
        cx="8.5"
        cy="9"
        r="1.5"
      />
      <path
        d="m4 17 4.5-4.5 3.5 3 2.5-2.5L20 18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon() {
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
        x="3"
        y="5"
        width="14"
        height="14"
        rx="2"
      />
      <path
        d="m17 10 4-2v8l-4-2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AudioIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 11.5v.5a6.5 6.5 0 0 0 13 0v-.5M12 18.5V22M9 22h6"
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
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5"
        strokeLinejoin="round"
      />
      <path
        d="M9 13h6M9 17h6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EmojiIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path
        d="M8.5 10h.01M15.5 10h.01"
        strokeLinecap="round"
      />
      <path
        d="M8.5 14.5c1 1.3 2.1 2 3.5 2s2.5-.7 3.5-2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m8.5 12.5 6.8-6.8a3 3 0 1 1 4.2 4.2l-8.9 8.9a5 5 0 0 1-7.1-7.1l8.2-8.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function formatVoiceDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function ReplyBox({
  reply,
  sending,
  error,
  blockedReason = null,
  blockedTitle = null,
  advisoryReason = null,
  advisoryTitle = null,
  contactId,
  businessId,
  initialTags,
  typingAgents = [],
  onTagsChange,
  conversationId,
  allowAttachments = true,
  onReplyChange,
  onSubmit,
  onSendAttachments,
  onStatusChange,
}: ReplyBoxProps) {
  const isKhmer = useWorkspaceLanguageId() === "km";

  const [sendingContent, setSendingContent] =
    useState(false);

  const isSending =
    sending || sendingContent;

  const isComposerBlocked =
    Boolean(blockedReason);
  const isComposerDisabled =
    isSending || isComposerBlocked;

  const imageInputRef =
    useRef<HTMLInputElement | null>(null);

  const videoInputRef =
    useRef<HTMLInputElement | null>(null);


  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const replyInputRef =
    useRef<HTMLTextAreaElement | null>(null);

  const [attachments, setAttachments] =
    useState<ReplyAttachment[]>([]);

  const [emojiOpen, setEmojiOpen] =
    useState(false);

  const [moreOpen, setMoreOpen] =
    useState(false);

  const [locationPickerOpen, setLocationPickerOpen] =
    useState(false);

  const [lastPickedLocation, setLastPickedLocation] =
    useState<PickedLocation | null>(null);

  type SendMode =
    | "now"
    | "close"
    | "pending";

  const [sendMode, setSendMode] =
    useState<SendMode>("now");

  const [sendMenuOpen, setSendMenuOpen] =
    useState(false);

  type ToolbarPanel =
    | "quick-tag"
    | "quick-reply"
    | "emoji"
    | "attach"
    | null;

  const [activeToolbarPanel, setActiveToolbarPanel] =
    useState<ToolbarPanel>(null);

  const pendingPostSendStatusRef =
    useRef<ConversationStatus | null>(null);

  const previousSendingRef =
    useRef(sending);

  const [
    recordingVoice,
    setRecordingVoice,
  ] = useState(false);

  const [
    recordingPaused,
    setRecordingPaused,
  ] = useState(false);

  const [
    recordingSeconds,
    setRecordingSeconds,
  ] = useState(0);

  const [
    recordingError,
    setRecordingError,
  ] = useState<string | null>(null);

  const [
    voiceReview,
    setVoiceReview,
  ] = useState<{
    attachmentId: string;
    durationSeconds: number;
  } | null>(null);

  const [
    voiceReviewPlaying,
    setVoiceReviewPlaying,
  ] = useState(false);

  const [
    voicePlaybackSeconds,
    setVoicePlaybackSeconds,
  ] = useState(0);

  const voicePreviewAudioRef =
    useRef<HTMLAudioElement | null>(null);

  const recordingSecondsRef =
    useRef(0);

  const mediaRecorderRef =
    useRef<MediaRecorder | null>(null);

  const mediaStreamRef =
    useRef<MediaStream | null>(null);

  const recordedChunksRef =
    useRef<BlobPart[]>([]);

  const recordingTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(
      null,
    );

  const discardRecordingRef =
    useRef(false);

  function closeExpandedChildSelector(
    ariaLabel: "Quick tags" | "Quick replies",
  ) {
    if (typeof document === "undefined") {
      return;
    }

    const trigger = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${ariaLabel}"][aria-expanded="true"]`,
    );

    trigger?.click();
  }

  function dismissToolbarPanels() {
    setEmojiOpen(false);
    setMoreOpen(false);
    setSendMenuOpen(false);
    closeExpandedChildSelector("Quick tags");
    closeExpandedChildSelector("Quick replies");

    if (typeof window !== "undefined") {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );

      const activeElement =
        document.activeElement;

      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
    }
  }

  function clearToolbarPanel() {
    setActiveToolbarPanel(null);
  }

  /*
   * Keep the two existing selector components mutually exclusive.
   * They own their own open state, so we mirror aria-expanded and
   * close the opposite selector after React finishes its click cycle.
   */
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    let frame = 0;

    const syncSelectorState = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const quickTagOpen = Boolean(
          document.querySelector(
            'button[aria-label="Quick tags"][aria-expanded="true"]',
          ),
        );
        const quickReplyOpen = Boolean(
          document.querySelector(
            'button[aria-label="Quick replies"][aria-expanded="true"]',
          ),
        );

        if (quickTagOpen && quickReplyOpen) {
          if (activeToolbarPanel === "quick-reply") {
            closeExpandedChildSelector("Quick tags");
          } else {
            closeExpandedChildSelector("Quick replies");
          }
          return;
        }

        if (quickTagOpen) {
          setActiveToolbarPanel("quick-tag");
          return;
        }

        if (quickReplyOpen) {
          setActiveToolbarPanel("quick-reply");
          return;
        }

        if (!emojiOpen && !moreOpen) {
          setActiveToolbarPanel(null);
        }
      });
    };

    const observer = new MutationObserver(syncSelectorState);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
      childList: true,
    });

    syncSelectorState();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [activeToolbarPanel, emojiOpen, moreOpen]);

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      clearInterval(
        recordingTimerRef.current,
      );
      recordingTimerRef.current = null;
    }
  }

  function stopRecordingTracks() {
    for (
      const track of
      mediaStreamRef.current?.getTracks() ??
      []
    ) {
      track.stop();
    }

    mediaStreamRef.current = null;
  }

  function supportedRecordingMimeType() {
    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      return "";
    }

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];

    return (
      candidates.find(
        (candidate) =>
          MediaRecorder.isTypeSupported(
            candidate,
          ),
      ) ?? ""
    );
  }

  async function startVoiceRecording() {
    if (!allowAttachments) {
      setRecordingError(
        "Voice messages are available for Messenger conversations only.",
      );
      return;
    }

    if (
      typeof navigator ===
        "undefined" ||
      !navigator.mediaDevices
        ?.getUserMedia ||
      typeof MediaRecorder ===
        "undefined"
    ) {
      setRecordingError(
        "Voice recording is not supported by this browser.",
      );
      return;
    }

    if (
      recordingVoice ||
      isComposerDisabled
    ) {
      return;
    }

    setEmojiOpen(false);
    setMoreOpen(false);
    setSendMenuOpen(false);
    clearToolbarPanel();
    setRecordingError(null);
    setVoiceReviewPlaying(false);
    setVoicePlaybackSeconds(0);

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          },
        );

      const mimeType =
        supportedRecordingMimeType();

      const recorder =
        mimeType
          ? new MediaRecorder(
              stream,
              {
                mimeType,
                audioBitsPerSecond:
                  128000,
              },
            )
          : new MediaRecorder(
              stream,
            );

      mediaStreamRef.current =
        stream;
      mediaRecorderRef.current =
        recorder;
      recordedChunksRef.current =
        [];
      discardRecordingRef.current =
        false;

      recorder.ondataavailable = (
        event,
      ) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(
            event.data,
          );
        }
      };

      recorder.onstop = () => {
        clearRecordingTimer();
        stopRecordingTracks();
        setRecordingVoice(false);
        setRecordingPaused(false);

        if (
          discardRecordingRef.current
        ) {
          recordedChunksRef.current =
            [];
          discardRecordingRef.current =
            false;
          return;
        }

        const actualType =
          recorder.mimeType ||
          mimeType ||
          "audio/webm";

        const blob = new Blob(
          recordedChunksRef.current,
          {
            type: actualType,
          },
        );

        recordedChunksRef.current =
          [];

        if (blob.size <= 0) {
          setRecordingError(
            "No audio was recorded. Please try again.",
          );
          return;
        }

        if (
          blob.size >
          TENH_ATTACHMENT_LIMITS.audio
        ) {
          setRecordingError(
            "Voice message is larger than 25 MB.",
          );
          return;
        }

        const extension =
          actualType.includes("ogg")
            ? "ogg"
            : "webm";

        const file = new File(
          [blob],
          `voice-message-${Date.now()}.${extension}`,
          {
            type: actualType,
          },
        );

        const attachment:
          ReplyAttachment = {
          id: createId(),
          file,
          previewUrl:
            URL.createObjectURL(blob),
          kind: "audio",
        };

        setAttachments(
          (current) => [
            ...current,
            attachment,
          ],
        );

        setVoiceReview({
          attachmentId: attachment.id,
          durationSeconds: Math.max(1, recordingSecondsRef.current),
        });
        setVoiceReviewPlaying(false);
        setVoicePlaybackSeconds(0);
      };

      recorder.onerror = () => {
        clearRecordingTimer();
        stopRecordingTracks();
        setRecordingVoice(false);
        setRecordingPaused(false);
        setRecordingError(
          "Voice recording stopped because the browser reported an audio error.",
        );
      };

      recorder.start(250);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
      setRecordingPaused(false);
      setRecordingVoice(true);

      recordingTimerRef.current =
        setInterval(() => {
          if (
            mediaRecorderRef.current?.state !==
            "recording"
          ) {
            return;
          }

          setRecordingSeconds(
            (current) => {
              const next = current + 1;
              recordingSecondsRef.current = next;

              /*
               * Prevent accidental extremely long recordings.
               */
              if (
                next >= 300 &&
                mediaRecorderRef.current?.state ===
                  "recording"
              ) {
                mediaRecorderRef.current.stop();
              }

              return next;
            },
          );
        }, 1000);
    } catch (recordError) {
      stopRecordingTracks();

      const errorName =
        recordError instanceof
        DOMException
          ? recordError.name
          : "";

      setRecordingError(
        errorName ===
          "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in the browser and try again."
          : "Unable to start the microphone.",
      );
    }
  }

  function pauseVoiceRecording() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.pause();
    setRecordingPaused(true);
  }

  function resumeVoiceRecording() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "paused") {
      return;
    }

    recorder.resume();
    setRecordingPaused(false);
  }

  function finishVoiceRecording() {
    const recorder =
      mediaRecorderRef.current;

    if (
      !recorder ||
      recorder.state ===
        "inactive"
    ) {
      return;
    }

    discardRecordingRef.current =
      false;
    recorder.stop();
  }

  function cancelVoiceRecording() {
    discardRecordingRef.current =
      true;

    const recorder =
      mediaRecorderRef.current;

    if (
      recorder &&
      recorder.state !==
        "inactive"
    ) {
      recorder.stop();
    } else {
      clearRecordingTimer();
      stopRecordingTracks();
      setRecordingVoice(false);
      setRecordingPaused(false);
    }

    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
    setVoiceReviewPlaying(false);
    setVoicePlaybackSeconds(0);
  }

  function getVoiceReviewAttachment() {
    if (!voiceReview) {
      return null;
    }

    return (
      attachments.find(
        (attachment) => attachment.id === voiceReview.attachmentId,
      ) ?? null
    );
  }

  function discardVoiceReview() {
    if (!voiceReview) {
      return;
    }

    const attachment = getVoiceReviewAttachment();

    if (voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.pause();
    }

    if (attachment) {
      URL.revokeObjectURL(attachment.previewUrl);
    }

    setAttachments((current) =>
      current.filter((item) => item.id !== voiceReview.attachmentId),
    );
    setVoiceReview(null);
    setVoiceReviewPlaying(false);
    setVoicePlaybackSeconds(0);
    recordingSecondsRef.current = 0;
    setRecordingSeconds(0);
  }

  function reRecordVoice() {
    discardVoiceReview();

    window.setTimeout(() => {
      void startVoiceRecording();
    }, 0);
  }

  async function toggleVoiceReviewPlayback() {
    const audio = voicePreviewAudioRef.current;

    if (!audio) {
      return;
    }

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

  async function sendVoiceReview() {
    const attachment = getVoiceReviewAttachment();

    if (!attachment || !onSendAttachments || isComposerDisabled) {
      return;
    }

    if (voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current.pause();
    }

    setVoiceReviewPlaying(false);
    setSendingContent(true);
    setRecordingError(null);

    try {
      const success = await onSendAttachments([attachment]);

      if (!success) {
        return;
      }

      URL.revokeObjectURL(attachment.previewUrl);
      setAttachments((current) =>
        current.filter((item) => item.id !== attachment.id),
      );
      setVoiceReview(null);
      setVoicePlaybackSeconds(0);
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);
    } catch (sendError) {
      console.error(
        "Unable to send voice message:",
        sendError,
      );

      setRecordingError(
        "Unable to send voice message. Please try again.",
      );
    } finally {
      setSendingContent(false);
    }
  }

  useEffect(() => {
    return () => {
      if (voicePreviewAudioRef.current) {
        voicePreviewAudioRef.current.pause();
      }

      discardRecordingRef.current =
        true;

      const recorder =
        mediaRecorderRef.current;

      if (
        recorder &&
        recorder.state !==
          "inactive"
      ) {
        recorder.stop();
      }

      clearRecordingTimer();
      stopRecordingTracks();
    };
  }, []);

  /*
   * Safe post-send status action.
   * We only close/mark pending AFTER the parent send cycle finishes
   * without a send error. This reuses the existing status handler.
   */
  useEffect(() => {
    const wasSending =
      previousSendingRef.current;

    previousSendingRef.current =
      sending;

    if (
      !wasSending ||
      sending ||
      !pendingPostSendStatusRef.current
    ) {
      return;
    }

    const nextStatus =
      pendingPostSendStatusRef.current;

    pendingPostSendStatusRef.current =
      null;

    if (!error && onStatusChange) {
      onStatusChange(nextStatus);
      setSendMode("now");
    }
  }, [error, onStatusChange, sending]);

  function addAttachments(
    files: FileList | null,
    kind: ReplyAttachmentKind,
  ) {
    if (!files?.length) {
      return;
    }

    if (!allowAttachments) {
      window.alert(
        "Attachments are currently available for Messenger conversations only.",
      );
      return;
    }

    const selectedFiles =
      Array.from(files);

    const maximumSize =
      TENH_ATTACHMENT_LIMITS[kind];

    const validFiles =
      selectedFiles.filter((file) => {
        const validType =
          kind === "image"
            ? file.type.startsWith(
                "image/",
              )
            : kind === "video"
              ? file.type.startsWith(
                  "video/",
                )
              : kind === "audio"
                ? file.type.startsWith(
                    "audio/",
                  ) ||
                  /\.(mp3|m4a|aac|wav|ogg|opus)$/i.test(
                    file.name,
                  )
                : !file.type.startsWith(
                      "image/",
                    ) &&
                  !file.type.startsWith(
                    "video/",
                  ) &&
                  !file.type.startsWith(
                    "audio/",
                  );

        return (
          validType &&
          file.size <= maximumSize
        );
      });

    if (
      validFiles.length !==
      selectedFiles.length
    ) {
      const limitLabel =
        kind === "image"
          ? "10 MB"
          : kind === "video"
            ? "50 MB"
            : "25 MB";

      window.alert(
        `Some ${kind} files were rejected. Each selected ${kind} must be ${limitLabel} or smaller.`,
      );
    }

    const newAttachments =
      validFiles.map((file) => ({
        id: createId(),
        file,
        previewUrl:
          URL.createObjectURL(file),
        kind,
      }));

    setAttachments((current) => [
      ...current,
      ...newAttachments,
    ]);

    setMoreOpen(false);
    clearToolbarPanel();
  }

  function handleImageChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    addAttachments(
      event.target.files,
      "image",
    );
    event.target.value = "";
  }

  function handleVideoChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    addAttachments(
      event.target.files,
      "video",
    );
    event.target.value = "";
  }

  function handleFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    addAttachments(
      event.target.files,
      "file",
    );
    event.target.value = "";
  }

  function removeAttachment(
    attachmentId: string,
  ) {
    setAttachments((current) => {
      const attachment =
        current.find(
          (item) =>
            item.id === attachmentId,
        );

      if (attachment) {
        URL.revokeObjectURL(
          attachment.previewUrl,
        );
      }

      return current.filter(
        (item) =>
          item.id !== attachmentId,
      );
    });
  }

  function clearAttachments() {
    setAttachments((current) => {
      for (const attachment of current) {
        URL.revokeObjectURL(
          attachment.previewUrl,
        );
      }

      return [];
    });
  }

  function insertEmoji(emoji: string) {
    onReplyChange(`${reply}${emoji}`);
  }

  function addLocation() {
    setMoreOpen(false);
    clearToolbarPanel();
    setLocationPickerOpen(true);
  }

  function confirmPickedLocation(location: PickedLocation) {
    const latitude = Number(location.latitude.toFixed(6));
    const longitude = Number(location.longitude.toFixed(6));
    const locationMessage =
      `📍 Location: https://www.google.com/maps?q=${latitude},${longitude}`;

    setLastPickedLocation({ latitude, longitude });
    onReplyChange(
      reply.trim()
        ? `${reply}\n${locationMessage}`
        : locationMessage,
    );
    setLocationPickerOpen(false);
  }

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    if (isComposerDisabled) {
      event.preventDefault();
      return;
    }

    if (
      !reply.trim() &&
      attachments.length === 0
    ) {
      event.preventDefault();
      return;
    }

    const postSendStatus:
      | ConversationStatus
      | null =
      sendMode === "close"
        ? "closed"
        : sendMode === "pending"
          ? "pending"
          : null;

    pendingPostSendStatusRef.current =
      postSendStatus;

    setSendMenuOpen(false);

    if (attachments.length > 0) {
      event.preventDefault();
      void sendAttachments(
        postSendStatus,
      );
      return;
    }

    onSubmit(event);
  }

  async function sendAttachments(
    postSendStatus:
      | ConversationStatus
      | null = null,
  ) {
    if (
      isComposerBlocked ||
      !onSendAttachments ||
      attachments.length === 0
    ) {
      return;
    }

    setSendingContent(true);

    try {
      const success =
        await onSendAttachments(
          attachments,
        );

      if (success) {
        clearAttachments();

        pendingPostSendStatusRef.current =
          null;

        if (
          postSendStatus &&
          onStatusChange
        ) {
          onStatusChange(
            postSendStatus,
          );
          setSendMode("now");
        }
      } else {
        pendingPostSendStatusRef.current =
          null;
      }
    } catch (sendError) {
      console.error(
        "Unable to send attachments:",
        sendError,
      );

      window.alert(
        "Unable to send attachments.",
      );
    } finally {
      setSendingContent(false);
    }
  }

  useEffect(() => {
    const textarea = replyInputRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "48px";
    const nextHeight = Math.min(128, Math.max(48, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
  }, [reply]);


  return (
    <div className="shrink-0 w-full border-t border-slate-200 bg-white">
      {attachments.some(
        (attachment) => attachment.id !== voiceReview?.attachmentId,
      ) ? (
        <div className="mx-3 mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {attachments
              .filter(
                (attachment) => attachment.id !== voiceReview?.attachmentId,
              )
              .map(
              (attachment) => (
                <div
                  key={attachment.id}
                  className="relative shrink-0"
                >
                  {attachment.kind === "image" ? (
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="h-20 w-20 rounded-xl border border-slate-200 object-cover shadow-sm"
                    />
                  ) : attachment.kind === "video" ? (
                    <video
                      src={attachment.previewUrl}
                      className="h-20 w-28 rounded-xl border border-slate-200 bg-black object-cover shadow-sm"
                      muted
                    />
                  ) : attachment.kind === "audio" ? (
                    <div className="flex h-20 w-60 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <AudioIcon />
                      <audio
                        src={attachment.previewUrl}
                        controls
                        preload="metadata"
                        className="h-8 min-w-0 flex-1"
                      />
                    </div>
                  ) : (
                    <div className="flex h-20 w-44 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <FileIcon />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-800">
                          {attachment.file.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {formatFileSize(
                            attachment.file.size,
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      removeAttachment(
                        attachment.id,
                      )
                    }
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm font-semibold text-white shadow"
                    aria-label={`Remove ${attachment.file.name}`}
                  >
                    ×
                  </button>
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}

      {recordingVoice ? (
        <div className="w-full border-t border-slate-200 bg-white px-3 py-2.5">
          <div className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-[0_5px_18px_rgba(15,23,42,0.07)]">
            <div className="flex min-w-[92px] shrink-0 items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  recordingPaused
                    ? "bg-slate-400"
                    : "animate-pulse bg-red-500"
                }`}
                aria-hidden="true"
              />
              <span className="text-sm font-semibold text-slate-800">
                {recordingPaused ? (isKhmer ? "បានផ្អាក" : "Paused") : (isKhmer ? "កំពុងថត" : "Recording")}
              </span>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div
                className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[2px] overflow-hidden px-2"
                aria-label="Voice recording waveform"
              >
                {[
                  7, 11, 6, 15, 9, 18, 12, 21, 14, 10, 17, 23,
                  13, 8, 16, 20, 11, 15, 7, 19, 12, 22, 14, 9,
                  17, 12, 20, 8, 15, 11, 18, 7, 13, 10, 16, 8,
                  12, 7, 14, 9, 11, 6,
                ].map((height, index) => (
                  <span
                    key={index}
                    className={`w-[2px] shrink-0 rounded-full transition-all ${
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

              <div className="w-[58px] shrink-0 text-right">
                <div className="font-mono text-sm font-bold tabular-nums text-slate-900">
                  {String(Math.floor(recordingSeconds / 60)).padStart(1, "0")}:{String(
                    recordingSeconds % 60,
                  ).padStart(2, "0")}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                  {Math.floor(Math.max(0, 300 - recordingSeconds) / 60)}:{String(
                    Math.max(0, 300 - recordingSeconds) % 60,
                  ).padStart(2, "0")} left
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={cancelVoiceRecording}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              title="Discard recording"
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
                <path d="m9 7 .6-2h4.8l.6 2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m7 7 .8 13h8.4L17 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{isKhmer ? "បោះចោល" : "Discard"}</span>
            </button>

            <button
              type="button"
              onClick={
                recordingPaused
                  ? resumeVoiceRecording
                  : pauseVoiceRecording
              }
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              {recordingPaused ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7-11-7Z" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <rect x="7" y="5" width="3.5" height="14" rx="1" />
                  <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
                </svg>
              )}
              <span>{recordingPaused ? (isKhmer ? "បន្ត" : "Resume") : (isKhmer ? "ផ្អាក" : "Pause")}</span>
            </button>

            <button
              type="button"
              onClick={finishVoiceRecording}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(37,99,235,0.22)] transition hover:bg-blue-700"
              title="Finish recording"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{isKhmer ? "រួចរាល់" : "Done"}</span>
            </button>
          </div>
        </div>
      ) : voiceReview && getVoiceReviewAttachment() ? (
        <div className="w-full border-t border-slate-200 bg-white px-3 py-2.5">
          <div className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-[0_5px_18px_rgba(15,23,42,0.07)]">
            <button
              type="button"
              onClick={() => void toggleVoiceReviewPlayback()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-blue-600 transition hover:border-blue-200 hover:bg-blue-50"
              aria-label={voiceReviewPlaying ? "Pause voice preview" : "Play voice preview"}
              title={voiceReviewPlaying ? "Pause" : "Play"}
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
              <div
                className="flex h-8 min-w-[190px] flex-1 items-center gap-[2px] overflow-hidden"
                aria-label="Recorded voice waveform"
              >
                {[
                  4, 8, 6, 12, 9, 16, 10, 19, 13, 22, 17, 25,
                  20, 14, 18, 24, 15, 11, 20, 17, 13, 21, 16, 10,
                  12, 18, 14, 22, 19, 15, 11, 17, 13, 9, 12, 8,
                  10, 7, 9, 5, 7, 4,
                ].map((height, index) => {
                  const playedRatio = voiceReview.durationSeconds > 0
                    ? Math.min(1, voicePlaybackSeconds / voiceReview.durationSeconds)
                    : 0;
                  const played = index / 42 <= playedRatio;

                  return (
                    <span
                      key={index}
                      className={`w-[2px] shrink-0 rounded-full ${
                        played || voicePlaybackSeconds === 0
                          ? "bg-blue-600"
                          : "bg-blue-300"
                      }`}
                      style={{ height: `${height}px` }}
                    />
                  );
                })}
              </div>

              <div className="w-[62px] shrink-0 text-left">
                <div className="font-mono text-sm font-bold tabular-nums text-slate-900">
                  {formatVoiceDuration(
                    voicePlaybackSeconds > 0
                      ? voicePlaybackSeconds
                      : voiceReview.durationSeconds,
                  )}
                </div>
                <div className="mt-0.5 text-[10px] tabular-nums text-slate-400">
                  of {formatVoiceDuration(voiceReview.durationSeconds)}
                </div>
              </div>
            </div>

            <audio
              ref={voicePreviewAudioRef}
              src={getVoiceReviewAttachment()?.previewUrl}
              preload="metadata"
              className="hidden"
              onTimeUpdate={(event) => {
                setVoicePlaybackSeconds(event.currentTarget.currentTime);
              }}
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
              disabled={isSending}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
              title="Re-record voice note"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0-2.3 5.7" strokeLinecap="round" />
                <path d="M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{isKhmer ? "ថតឡើងវិញ" : "Re-record"}</span>
            </button>

            <button
              type="button"
              onClick={discardVoiceReview}
              disabled={isSending}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
              title="Discard voice note"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M4 7h16" strokeLinecap="round" />
                <path d="m9 7 .6-2h4.8l.6 2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="m7 7 .8 13h8.4L17 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Discard</span>
            </button>

            <button
              type="button"
              onClick={() => void sendVoiceReview()}
              disabled={isComposerDisabled || !onSendAttachments}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_5px_12px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Send voice note"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
                <path d="M21 3 10 14" strokeLinecap="round" />
                <path d="m21 3-7 18-4-7-7-4 18-7Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{isSending ? (isKhmer ? "កំពុងផ្ញើ..." : "Sending...") : (isKhmer ? "ផ្ញើសារជាសំឡេង" : "Send voice note")}</span>
            </button>
          </div>
        </div>
      ) : (
      <>
        {typingAgents.length > 0 ? (
          <div className="border-b border-amber-100 bg-amber-50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-amber-800">
              <span className="flex -space-x-1.5">
                {typingAgents.slice(0, 2).map((agent) => (
                  <span
                    key={agent.user_id}
                    className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-amber-50 bg-blue-500 text-[9px] font-bold text-white"
                    title={agent.name}
                  >
                    {agent.profile_picture_url ? (
                      <img src={agent.profile_picture_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      agent.name.trim().charAt(0).toUpperCase() || "?"
                    )}
                  </span>
                ))}
              </span>

              <span className="min-w-0 truncate">
                {typingAgents.length === 1
                  ? `${typingAgents[0].name} is writing a reply`
                  : typingAgents.length === 2
                    ? `${typingAgents[0].name} and ${typingAgents[1].name} are writing a reply`
                    : `${typingAgents.length} teammates are writing a reply`}
              </span>

              <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
                <span className="h-1 w-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.2s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.1s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-amber-500" />
              </span>
            </div>
          </div>
        ) : null}

        {blockedReason || advisoryReason ? (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900">
            <div className="mx-auto flex max-w-[1500px] items-start gap-2.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16.5h.01" strokeLinecap="round" />
              </svg>
              <div className="min-w-0">
                <p className="text-xs font-bold">
                  {blockedReason
                    ? blockedTitle ??
                      (isKhmer
                        ? "មិនអាចផ្ញើសារបាន"
                        : "Messaging unavailable")
                    : advisoryTitle ??
                      (isKhmer
                        ? "ព័ត៌មានអំពីការផ្ញើសារ"
                        : "Messaging notice")}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-amber-800">
                  {blockedReason ?? advisoryReason}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <form
        onSubmit={handleSubmit}
        className="relative w-full min-w-0 bg-white px-3 py-2"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {/* Real TENH quick tag selector */}
          <div
            onMouseDownCapture={() => {
              if (!isSending) {
                setEmojiOpen(false);
                setMoreOpen(false);
                setSendMenuOpen(false);
                setActiveToolbarPanel("quick-tag");

                window.setTimeout(() => {
                  closeExpandedChildSelector("Quick replies");
                }, 0);
              }
            }}
            onClick={(event) => {
              if (isSending) {
                return;
              }

              const target = event.target as HTMLElement;
              const clickedControlSurface =
                event.target === event.currentTarget ||
                Boolean(target.closest('[data-quick-control-label="quick-tag"]'));

              if (!clickedControlSurface) {
                return;
              }

              event.currentTarget.querySelector<HTMLButtonElement>(
                'button[aria-label="Quick tags"]',
              )?.click();
            }}
            className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl transition [&>div>button]:!h-5 [&>div>button]:!w-5 [&>div>button]:!rounded-none [&>div>button]:!border-0 [&>div>button]:!bg-transparent [&>div>button]:!p-0 [&>div>button]:!shadow-none [&>div>button]:!text-current ${
              isSending
                ? "pointer-events-none opacity-50"
                : activeToolbarPanel === "quick-tag"
                  ? "bg-blue-50 text-blue-600"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            <CustomerTagSelector
              contactId={contactId}
              businessId={businessId}
              conversationId={conversationId}
              initialTags={initialTags}
              onTagsChange={onTagsChange}
            />
          </div>

          {/* Real TENH saved reply selector */}
          <div
            onMouseDownCapture={() => {
              if (!isSending) {
                setEmojiOpen(false);
                setMoreOpen(false);
                setSendMenuOpen(false);
                setActiveToolbarPanel("quick-reply");

                window.setTimeout(() => {
                  closeExpandedChildSelector("Quick tags");
                }, 0);
              }
            }}
            onClick={(event) => {
              if (isSending) {
                return;
              }

              const target = event.target as HTMLElement;
              const clickedControlSurface =
                event.target === event.currentTarget ||
                Boolean(target.closest('[data-quick-control-label="quick-reply"]'));

              if (!clickedControlSurface) {
                return;
              }

              event.currentTarget.querySelector<HTMLButtonElement>(
                'button[aria-label="Quick replies"]',
              )?.click();
            }}
            className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl transition [&>div>button]:!h-5 [&>div>button]:!w-5 [&>div>button]:!rounded-none [&>div>button]:!border-0 [&>div>button]:!bg-transparent [&>div>button]:!p-0 [&>div>button]:!shadow-none [&>div>button]:!text-current ${
              isSending
                ? "pointer-events-none opacity-50"
                : activeToolbarPanel === "quick-reply"
                  ? "bg-blue-50 text-blue-600"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            }`}
          >
            <SavedReplySelector
              businessId={businessId}
              onSelect={onReplyChange}
            />
          </div>

          {/* Real emoji picker */}
          <button
            type="button"
            disabled={isSending}
            onClick={() => {
              const nextOpen = !emojiOpen;

              closeExpandedChildSelector("Quick tags");
              closeExpandedChildSelector("Quick replies");
              setActiveToolbarPanel(nextOpen ? "emoji" : null);
              setEmojiOpen(nextOpen);
              setMoreOpen(false);
              setSendMenuOpen(false);
            }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
              emojiOpen
                ? "bg-blue-50 text-blue-600"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            } disabled:opacity-40`}
            aria-label={isKhmer ? "ជ្រើសរើស Emoji" : "Choose emoji"}
            aria-expanded={emojiOpen}
          >
            <EmojiIcon />
          </button>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageChange}
            className="hidden"
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleVideoChange}
            className="hidden"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="min-w-0 flex-[1_1_320px] pl-1">
            <div className="flex min-h-12 min-w-0 items-center rounded-2xl border border-slate-200 bg-white pl-1.5 pr-1 transition focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-100">
              <button
                type="button"
                disabled={isComposerDisabled || !allowAttachments}
                onClick={() => {
                  const nextOpen = !moreOpen;

                  closeExpandedChildSelector("Quick tags");
                  closeExpandedChildSelector("Quick replies");
                  setActiveToolbarPanel(nextOpen ? "attach" : null);
                  setMoreOpen(nextOpen);
                  setEmojiOpen(false);
                  setSendMenuOpen(false);
                }}
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                  moreOpen
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-35`}
                aria-label={isKhmer ? "ភ្ជាប់មាតិកា" : "Attach content"}
                title={isKhmer ? "ភ្ជាប់មាតិកា" : "Attach content"}
                aria-expanded={moreOpen}
              >
                <span className="relative">
                  <AttachIcon />
                  {attachments.length > 0 ? (
                    <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
                      {attachments.length}
                    </span>
                  ) : null}
                </span>
              </button>

              <button
                type="button"
                disabled={isComposerDisabled || !allowAttachments}
                onClick={() => void startVoiceRecording()}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                  recordingVoice
                    ? "bg-red-50 text-red-600"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-35`}
                aria-label={isKhmer ? "ថតសារជាសំឡេង" : "Record voice message"}
                title={
                  allowAttachments
                    ? isKhmer ? "ថតសារជាសំឡេង" : "Record voice message"
                    : isKhmer ? "មិនអាចប្រើសារជាសំឡេង ខណៈកំពុងឆ្លើយតបផ្ទាល់ទៅមតិយោបល់ Facebook" : "Voice messages are unavailable while replying directly to a Facebook comment"
                }
              >
                <AudioIcon />
              </button>

              <span className="mx-1 h-6 w-px shrink-0 bg-slate-200" aria-hidden="true" />

              <textarea
                ref={replyInputRef}
                name="message"
                value={reply}
                onChange={(event) => onReplyChange(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return;
                  }

                  event.preventDefault();

                  if (
                    isComposerDisabled ||
                    (!reply.trim() && attachments.length === 0)
                  ) {
                    return;
                  }

                  /*
                   * Use the form's real submit path so Enter behaves exactly
                   * like the Send button, including attachments and Send &
                   * close/pending modes. Shift + Enter keeps the normal
                   * textarea newline behavior.
                   */
                  event.currentTarget.form?.requestSubmit();
                }}
                placeholder={
                  blockedReason
                    ? blockedTitle ??
                      (isKhmer
                        ? "មិនអាចផ្ញើសារបាន..."
                        : "Messaging unavailable...")
                    : isKhmer
                      ? "សរសេរការឆ្លើយតប..."
                      : "Write a reply..."
                }
                disabled={isComposerDisabled}
                rows={1}
                className="block h-12 max-h-32 min-h-12 min-w-0 flex-1 resize-none overflow-y-hidden border-0 bg-transparent px-2 py-3 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0 disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* Safe split Send button */}
          <div className="relative shrink-0">
            <div className="flex overflow-hidden rounded-xl bg-blue-600 text-white shadow-[0_6px_16px_rgba(37,99,235,0.22)]">
              <button
                type="submit"
                disabled={
                  isComposerDisabled ||
                  (!reply.trim() &&
                    attachments.length === 0)
                }
                className="inline-flex h-12 min-w-[96px] items-center justify-center gap-2 px-4 text-sm font-semibold transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  blockedReason
                    ? blockedReason
                    : sendMode === "close"
                    ? isKhmer ? "ផ្ញើ និងបិទការសន្ទនា" : "Send & close conversation"
                    : sendMode === "pending"
                      ? isKhmer ? "ផ្ញើ និងសម្គាល់ថាកំពុងរង់ចាំ" : "Send & mark pending"
                      : isKhmer ? "ផ្ញើឥឡូវ" : "Send now"
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
                    d="M21 3 10 14"
                    strokeLinecap="round"
                  />
                  <path
                    d="m21 3-7 18-4-7-7-4 18-7Z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>
                  {isSending
                    ? isKhmer ? "កំពុងផ្ញើ..." : "Sending..."
                    : isKhmer ? "ផ្ញើ" : "Send"}
                </span>
              </button>

              <button
                type="button"
                disabled={isComposerDisabled}
                onClick={() => {
                  const nextOpen = !sendMenuOpen;

                  if (nextOpen) {
                    closeExpandedChildSelector("Quick tags");
                    closeExpandedChildSelector("Quick replies");
                    setEmojiOpen(false);
                    setMoreOpen(false);
                    clearToolbarPanel();
                  }

                  setSendMenuOpen(nextOpen);
                  setEmojiOpen(false);
                  setMoreOpen(false);
                }}
                className="flex h-12 w-10 items-center justify-center border-l border-white/20 transition hover:bg-blue-700 disabled:opacity-50"
                aria-label={isKhmer ? "ជម្រើសផ្ញើ" : "Send options"}
                aria-expanded={sendMenuOpen}
                title={isKhmer ? "ជម្រើសផ្ញើ" : "Send options"}
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
              </button>
            </div>

            {sendMenuOpen ? (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default bg-transparent"
                  onClick={() => {
                    setSendMenuOpen(false);
                    clearToolbarPanel();
                  }}
                  aria-label="Close send options"
                />
                <div className="absolute bottom-[calc(100%+10px)] right-0 z-50 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.18)]">
                  {(
                    [
                      [
                        "now",
                        isKhmer ? "ផ្ញើឥឡូវ" : "Send now",
                        isKhmer ? "ផ្ញើដោយមិនប្តូរស្ថានភាព" : "Send without changing status",
                      ],
                      [
                        "close",
                        isKhmer ? "ផ្ញើ និងបិទការសន្ទនា" : "Send & close conversation",
                        isKhmer ? "បិទតែបន្ទាប់ពីផ្ញើបានជោគជ័យ" : "Closes only after a successful send",
                      ],
                      [
                        "pending",
                        isKhmer ? "ផ្ញើ និងសម្គាល់ថាកំពុងរង់ចាំ" : "Send & mark pending",
                        isKhmer ? "សម្គាល់ថាកំពុងរង់ចាំតែបន្ទាប់ពីផ្ញើបានជោគជ័យ" : "Marks pending only after a successful send",
                      ],
                    ] as const
                  ).map(
                    ([mode, label, help]) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={
                          mode !== "now" &&
                          !onStatusChange
                        }
                        onClick={() => {
                          setSendMode(mode);
                          setSendMenuOpen(false);
                        }}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          sendMode === mode
                            ? "bg-violet-50 text-violet-700"
                            : "text-slate-700 hover:bg-slate-50"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-xs">
                          {sendMode === mode
                            ? "✓"
                            : ""}
                        </span>
                        <span>
                          <span className="block text-sm font-semibold">
                            {label}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                            {help}
                          </span>
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-2 px-1 text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </form>
      </>
      )}

      {/* Existing, functional emoji picker */}
      {emojiOpen ? (
        <>
          <button
            type="button"
            onClick={() => {
              setEmojiOpen(false);
              clearToolbarPanel();
            }}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/5"
            aria-label="Close emoji picker"
          />
          <div className="fixed bottom-28 left-1/2 z-50 -translate-x-1/2 overflow-hidden rounded-xl shadow-2xl">
            <EmojiPicker
              width={350}
              height={420}
              lazyLoadEmojis
              searchDisabled={false}
              skinTonesDisabled={false}
              onEmojiClick={(emojiData) =>
                insertEmoji(
                  emojiData.emoji,
                )
              }
            />
          </div>
        </>
      ) : null}

      <LocationPickerDialog
        open={locationPickerOpen}
        isKhmer={isKhmer}
        initialLocation={lastPickedLocation}
        onClose={() => setLocationPickerOpen(false)}
        onConfirm={confirmPickedLocation}
      />

      {/* Existing, functional Plus/content menu */}
      {moreOpen ? (
        <>
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              clearToolbarPanel();
            }}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/5"
            aria-label="Close content menu"
          />
          <div className="fixed bottom-28 left-1/2 z-50 w-64 -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                imageInputRef.current?.click();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <ImageIcon />
              <span>{isKhmer ? "បន្ថែមរូបភាព" : "Add images"}</span>
              <span className="ml-auto text-xs text-slate-400">
                {isKhmer ? "ច្រើន" : "Multiple"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                videoInputRef.current?.click();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <VideoIcon />
              <span>{isKhmer ? "បន្ថែមវីដេអូ" : "Add videos"}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                fileInputRef.current?.click();
              }}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <FileIcon />
              <span>{isKhmer ? "បន្ថែមឯកសារ" : "Add files"}</span>
            </button>
            <button
              type="button"
              onClick={addLocation}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <LocationIcon />
              <span>{isKhmer ? "ផ្ញើទីតាំង" : "Send location"}</span>
              <span className="ml-auto text-xs text-slate-400">
                {isKhmer ? "ជ្រើសលើផែនទី" : "Choose on map"}
              </span>
            </button>
          </div>
        </>
      ) : null}

      {recordingError ? (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {recordingError}
        </div>
      ) : null}
    </div>
  );
}
