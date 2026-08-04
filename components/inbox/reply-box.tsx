"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import EmojiPicker from "emoji-picker-react";

import { CustomerTagSelector } from "@/components/inbox/customer-tag-selector";
import { SavedReplySelector } from "@/components/inbox/saved-reply-selector";

import type { CustomerTag } from "@/types/inbox";

type ReplyBoxProps = {
  reply: string;
  sending: boolean;
  error: string | null;

  contactId: string;
  businessId: string;
  initialTags: CustomerTag[];

  onReplyChange: (value: string) => void;

  onSubmit: (
    event: FormEvent<HTMLFormElement>,
  ) => void;
};

type SelectedAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "video";
};

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
      <circle
        cx="12"
        cy="12"
        r="9"
      />

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

      <circle
        cx="12"
        cy="10"
        r="2.5"
      />
    </svg>
  );
}

export function ReplyBox({
  reply,
  sending,
  error,
  contactId,
  businessId,
  initialTags,
  onReplyChange,
  onSubmit,
}: ReplyBoxProps) {

  const [sendingContent, setSendingContent] =
  useState(false);

  const isSending =
  sending || sendingContent;

  const imageInputRef =
    useRef<HTMLInputElement | null>(null);

  const videoInputRef =
    useRef<HTMLInputElement | null>(null);

  const [attachments, setAttachments] =
    useState<SelectedAttachment[]>([]);

  const [emojiOpen, setEmojiOpen] =
    useState(false);

  const [moreOpen, setMoreOpen] =
    useState(false);

  const [
    gettingLocation,
    setGettingLocation,
  ] = useState(false);

  function addAttachments(
    files: FileList | null,
    kind: "image" | "video",
  ) {
    if (!files?.length) {
      return;
    }

    const selectedFiles =
      Array.from(files);

    const maximumSize =
      kind === "image"
        ? 10 * 1024 * 1024
        : 50 * 1024 * 1024;

    const validFiles =
      selectedFiles.filter((file) => {
        const validType =
          kind === "image"
            ? file.type.startsWith(
                "image/",
              )
            : file.type.startsWith(
                "video/",
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
      window.alert(
        kind === "image"
          ? "Some images were rejected. Each image must be smaller than 10 MB."
          : "Some videos were rejected. Each video must be smaller than 50 MB.",
      );
    }

    const newAttachments =
      validFiles.map((file) => ({
        id: crypto.randomUUID(),
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
  setSendingContent(true);

  try {
    window.alert(
      "Attachment sending still needs to be connected to the Facebook media API.",
    );
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
    <div className="border-t border-slate-200 bg-white">
      {/* Multiple image/video preview */}
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
                  ) : (
                    <video
                      src={
                        attachment.previewUrl
                      }
                      className="h-24 w-32 rounded-xl border border-slate-200 bg-black object-cover shadow-sm"
                      muted
                    />
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

                  <span className="absolute bottom-1 left-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] text-white">
                    {attachment.kind ===
                    "image"
                      ? "Image"
                      : "Video"}
                  </span>
                </div>
              ),
            )}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {attachments.length} attachment
            {attachments.length === 1
              ? ""
              : "s"}{" "}
            selected
          </p>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="relative flex items-center gap-2 border-b border-slate-100 px-4 py-2">
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
        {/* Emoji */}
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
        {/* Add content */}
        
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
            setMoreOpen(
              (current) => !current,
            );

            setEmojiOpen(false);
          }}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition ${
            moreOpen
              ? "bg-blue-50 text-blue-700"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          }`}
          aria-label="Add content"
          title="Add content"
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

                <span>Add media</span>

                <span className="ml-auto text-xs text-slate-400">
                  Videos
                </span>
              </button>

              <button
                type="button"
                onClick={addLocation}
                disabled={
                  gettingLocation
                }
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

      {/* Message input */}
      <div className="p-4">
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-3"
        >
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
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
          />

        <button
  type="submit"
  disabled={
    isSending ||
    (!reply.trim() &&
      attachments.length === 0)
  }
  className="flex min-w-24 items-center justify-center rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
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

        {error ? (
          <p className="mt-2 text-sm text-red-600">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            Replies are sent through the
            connected Facebook Page.
          </p>
        )}
      </div>
    </div>
  );
}