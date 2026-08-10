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
import { SavedReplySelector } from "@/components/inbox/saved-reply-selector";

import type { CustomerTag } from "@/types/inbox";

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

  contactId: string;
  businessId: string;
  initialTags: CustomerTag[];

  allowAttachments?: boolean;

  onReplyChange: (value: string) => void;

  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void;

  onSendAttachments?: (
    attachments: ReplyAttachment[],
  ) => Promise<boolean>;
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

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M12 5v14M5 12h14"
        strokeLinecap="round"
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

export function ReplyBox({
  reply,
  sending,
  error,
  contactId,
  businessId,
  initialTags,
  conversationId,
  allowAttachments = true,
  onReplyChange,
  onSubmit,
  onSendAttachments,
}: ReplyBoxProps) {
  const [sendingContent, setSendingContent] =
    useState(false);

  const isSending =
    sending || sendingContent;

  const imageInputRef =
    useRef<HTMLInputElement | null>(null);

  const videoInputRef =
    useRef<HTMLInputElement | null>(null);


  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const [attachments, setAttachments] =
    useState<ReplyAttachment[]>([]);

  const [emojiOpen, setEmojiOpen] =
    useState(false);

  const [moreOpen, setMoreOpen] =
    useState(false);

  const [gettingLocation, setGettingLocation] =
    useState(false);

  const [
    recordingVoice,
    setRecordingVoice,
  ] = useState(false);

  const [
    recordingSeconds,
    setRecordingSeconds,
  ] = useState(0);

  const [
    recordingError,
    setRecordingError,
  ] = useState<string | null>(null);

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
      isSending
    ) {
      return;
    }

    setEmojiOpen(false);
    setMoreOpen(false);
    setRecordingError(null);

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
      };

      recorder.onerror = () => {
        clearRecordingTimer();
        stopRecordingTracks();
        setRecordingVoice(false);
        setRecordingError(
          "Voice recording stopped because the browser reported an audio error.",
        );
      };

      recorder.start(250);
      setRecordingSeconds(0);
      setRecordingVoice(true);

      recordingTimerRef.current =
        setInterval(() => {
          setRecordingSeconds(
            (current) => {
              const next =
                current + 1;

              /*
               * Prevent accidental extremely long recordings.
               */
              if (
                next >= 300 &&
                mediaRecorderRef
                  .current
                  ?.state ===
                  "recording"
              ) {
                mediaRecorderRef
                  .current.stop();
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
    }

    setRecordingSeconds(0);
  }

  useEffect(() => {
    return () => {
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
    if (!navigator.geolocation) {
      window.alert(
        "Location is not supported by this browser.",
      );
      return;
    }

    setGettingLocation(true);
    setMoreOpen(false);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude =
          position.coords.latitude;

        const longitude =
          position.coords.longitude;

        const locationMessage =
          `📍 Location: https://www.google.com/maps?q=${latitude},${longitude}`;

        onReplyChange(
          reply.trim()
            ? `${reply}\n${locationMessage}`
            : locationMessage,
        );

        setGettingLocation(false);
      },
      (locationError) => {
        setGettingLocation(false);

        if (
          locationError.code ===
          locationError.PERMISSION_DENIED
        ) {
          window.alert(
            "Location permission was denied. Please allow location access in your browser.",
          );
          return;
        }

        window.alert(
          "Unable to get your current location.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    );
  }

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    if (isSending) {
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

    if (attachments.length > 0) {
      event.preventDefault();
      void sendAttachments();
      return;
    }

    onSubmit(event);
  }

  async function sendAttachments() {
    if (
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

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white">
      {attachments.length > 0 ? (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {attachments.map(
              (attachment) => (
                <div
                  key={attachment.id}
                  className="relative shrink-0"
                >
                  {attachment.kind ===
                  "image" ? (
                    <img
                      src={
                        attachment.previewUrl
                      }
                      alt={
                        attachment.file.name
                      }
                      className="h-24 w-24 rounded-xl border border-slate-200 object-cover shadow-sm"
                    />
                  ) : attachment.kind ===
                    "video" ? (
                    <video
                      src={
                        attachment.previewUrl
                      }
                      className="h-24 w-32 rounded-xl border border-slate-200 bg-black object-cover shadow-sm"
                      muted
                    />
                  ) : attachment.kind ===
                    "audio" ? (
                    <div className="flex h-24 w-64 flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center gap-2 text-slate-600">
                        <AudioIcon />
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          Audio
                        </span>
                      </div>
                      <audio
                        src={attachment.previewUrl}
                        controls
                        preload="metadata"
                        className="h-8 w-full"
                      />
                    </div>
                  ) : (
                    <div className="flex h-24 w-44 flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex items-center gap-2 text-slate-600">
                        <FileIcon />
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          File
                        </span>
                      </div>

                      <div>
                        <p className="truncate text-xs font-medium text-slate-800">
                          {
                            attachment.file
                              .name
                          }
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {formatFileSize(
                            attachment.file
                              .size,
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

                  {attachment.kind !==
                  "file" ? (
                    <span className="absolute bottom-1 left-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] text-white">
                      {attachment.kind ===
                      "image"
                        ? "Image"
                        : attachment.kind ===
                            "video"
                          ? "Video"
                          : "Audio"}
                    </span>
                  ) : null}
                </div>
              ),
            )}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {attachments.length}{" "}
            attachment
            {attachments.length === 1
              ? ""
              : "s"}{" "}
            selected
          </p>
        </div>
      ) : null}

      <div className="relative flex items-center gap-2 px-4 py-2">
        <div
          className={
            isSending
              ? "pointer-events-none opacity-50"
              : ""
          }
        >
          <CustomerTagSelector
            contactId={contactId}
            businessId={businessId}
            conversationId={
              conversationId
            }
            initialTags={initialTags}
          />
        </div>

        <div
          className={
            isSending
              ? "pointer-events-none opacity-50"
              : ""
          }
        >
          <SavedReplySelector
            businessId={businessId}
            onSelect={onReplyChange}
          />
        </div>

        <div
          className={
            isSending
              ? "pointer-events-none opacity-50"
              : ""
          }
        >
          <button
            type="button"
            onClick={() => {
              setEmojiOpen(
                (current) => !current,
              );
              setMoreOpen(false);
            }}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
              emojiOpen
                ? "bg-blue-50 text-blue-700"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
            aria-label="Choose emoji"
            title="Choose emoji"
            aria-expanded={emojiOpen}
          >
            <EmojiIcon />
          </button>
        </div>

        <div
          className={
            isSending
              ? "pointer-events-none opacity-50"
              : ""
          }
        >
          <button
            type="button"
            disabled={!allowAttachments}
            onClick={() =>
              void startVoiceRecording()
            }
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-35 ${
              recordingVoice
                ? "bg-red-50 text-red-600"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
            aria-label="Record voice message"
            title={
              allowAttachments
                ? "Record voice message"
                : "Voice messages are available for Messenger conversations"
            }
          >
            <AudioIcon />
          </button>
        </div>

        <div
          className={
            isSending
              ? "pointer-events-none opacity-50"
              : ""
          }
        >
          <button
            type="button"
            disabled={!allowAttachments}
            onClick={() => {
              setMoreOpen(
                (current) => !current,
              );
              setEmojiOpen(false);
            }}
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
              moreOpen
                ? "bg-blue-50 text-blue-700"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            } disabled:cursor-not-allowed disabled:opacity-35`}
            aria-label="Add content"
            title={
              allowAttachments
                ? "Add content"
                : "Attachments are available for Messenger conversations"
            }
            aria-expanded={moreOpen}
          >
            <PlusIcon />

            {attachments.length > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {attachments.length}
              </span>
            ) : null}
          </button>
        </div>

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

        {emojiOpen ? (
          <>
            <button
              type="button"
              onClick={() =>
                setEmojiOpen(false)
              }
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
                onEmojiClick={(
                  emojiData,
                ) =>
                  insertEmoji(
                    emojiData.emoji,
                  )
                }
              />
            </div>
          </>
        ) : null}

        {moreOpen ? (
          <>
            <button
              type="button"
              onClick={() =>
                setMoreOpen(false)
              }
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
                <span>Add images</span>
                <span className="ml-auto text-xs text-slate-400">
                  Multiple
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
                <span>Add videos</span>
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
                <span>Add files</span>
              </button>

              <button
                type="button"
                onClick={addLocation}
                disabled={gettingLocation}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:text-slate-400"
              >
                <LocationIcon />
                <span>
                  {gettingLocation
                    ? "Getting location..."
                    : "Send location"}
                </span>
              </button>
            </div>
          </>
        ) : null}
      </div>

      {recordingVoice ? (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-red-700">
              Recording voice
            </p>
            <p className="text-xs text-red-600">
              {Math.floor(
                recordingSeconds / 60,
              )}
              :
              {String(
                recordingSeconds % 60,
              ).padStart(2, "0")}
              {" · "}
              max 5 minutes
            </p>
          </div>

          <button
            type="button"
            onClick={
              cancelVoiceRecording
            }
            className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={
              finishVoiceRecording
            }
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
          >
            Stop
          </button>
        </div>
      ) : null}

      {recordingError ? (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {recordingError}
        </div>
      ) : null}

      <div className="px-4 pb-3">
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-3"
        >
          <div className="min-w-0 flex-1">
            <textarea
              name="message"
              value={reply}
              onChange={(event) =>
                onReplyChange(
                  event.target.value,
                )
              }
              placeholder="Write a reply..."
              disabled={isSending}
              rows={1}
              className="max-h-32 min-h-11 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />

            {attachments.length > 0 &&
            reply.trim() ? (
              <p className="mt-1 text-[11px] text-slate-400">
                V2.4 sends the selected attachments first. Your typed text stays in the composer so you can send it next.
              </p>
            ) : null}

            {error ? (
              <p className="mt-1 text-xs text-red-600">
                {error}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={
              isSending ||
              (!reply.trim() &&
                attachments.length === 0)
            }
            className="flex h-11 min-w-24 items-center justify-center rounded-xl bg-blue-600 px-5 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSending ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Sending...
              </span>
            ) : (
              "Send"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
