"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import EmojiPicker from "emoji-picker-react";

import type {
  SavedReplyAttachment,
  SavedReplyAttachmentType,
} from "@/types/inbox";

export type NewSavedReplyAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  attachmentType: SavedReplyAttachmentType;
};

export type SavedReplyFormValue = {
  title: string;
  shortcut: string;
  category: string;
  messageText: string;
  sortIndex: number;
  isActive: boolean;

  existingAttachments: SavedReplyAttachment[];
  newAttachments: NewSavedReplyAttachment[];
  removedAttachmentIds: string[];
};

type SavedReplyFormModalProps = {
  mode: "create" | "edit";
  value: SavedReplyFormValue;
  saving: boolean;
  error: string | null;

  onChange: (
    value: SavedReplyFormValue,
  ) => void;

  onClose: () => void;
  onSubmit: () => void;
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

export function SavedReplyFormModal({
  mode,
  value,
  saving,
  error,
  onChange,
  onClose,
  onSubmit,
}: SavedReplyFormModalProps) {
  const imageInputRef =
    useRef<HTMLInputElement | null>(null);

  const videoInputRef =
    useRef<HTMLInputElement | null>(null);

  const [emojiOpen, setEmojiOpen] =
    useState(false);

  function addFiles(
    files: FileList | null,
    attachmentType:
      SavedReplyAttachmentType,
  ) {
    if (!files?.length) {
      return;
    }

    const maximumSize =
      attachmentType === "image"
        ? 10 * 1024 * 1024
        : 50 * 1024 * 1024;

    const selectedFiles =
      Array.from(files);

    const validFiles =
      selectedFiles.filter((file) => {
        const validType =
          attachmentType === "image"
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
        attachmentType === "image"
          ? "Some images were rejected. Each image must be under 10 MB."
          : "Some videos were rejected. Each video must be under 50 MB.",
      );
    }

    const newAttachments =
      validFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl:
          URL.createObjectURL(file),
        attachmentType,
      }));

    onChange({
      ...value,

      newAttachments: [
        ...value.newAttachments,
        ...newAttachments,
      ],
    });
  }

  function handleImageChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    addFiles(
      event.target.files,
      "image",
    );

    event.target.value = "";
  }

  function handleVideoChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    addFiles(
      event.target.files,
      "video",
    );

    event.target.value = "";
  }

  function removeNewAttachment(
    attachmentId: string,
  ) {
    const attachment =
      value.newAttachments.find(
        (item) =>
          item.id === attachmentId,
      );

    if (attachment) {
      URL.revokeObjectURL(
        attachment.previewUrl,
      );
    }

    onChange({
      ...value,

      newAttachments:
        value.newAttachments.filter(
          (item) =>
            item.id !== attachmentId,
        ),
    });
  }

  function removeExistingAttachment(
    attachmentId: string,
  ) {
    onChange({
      ...value,

      existingAttachments:
        value.existingAttachments.filter(
          (attachment) =>
            attachment.id !==
            attachmentId,
        ),

      removedAttachmentIds: [
        ...value.removedAttachmentIds,
        attachmentId,
      ],
    });
  }

  function insertEmoji(
    emoji: string,
  ) {
    onChange({
      ...value,
      messageText:
        `${value.messageText}${emoji}`,
    });
  }

  const attachmentCount =
    value.existingAttachments.length +
    value.newAttachments.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-slate-900">
            {mode === "create"
              ? "Add quick reply"
              : "Edit quick reply"}
          </h2>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-2xl leading-none text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <label className="text-sm font-medium text-slate-700">
              Reply index
            </label>

            <input
              type="number"
              min={0}
              value={value.sortIndex}
              onChange={(event) =>
                onChange({
                  ...value,

                  sortIndex: Math.max(
                    0,
                    Number(
                      event.target.value,
                    ),
                  ),
                })
              }
              disabled={saving}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />

            <p className="mt-1 text-xs text-slate-500">
              Lower numbers appear first.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700">
              Reply title
            </label>

            <input
              value={value.title}
              maxLength={100}
              onChange={(event) =>
                onChange({
                  ...value,
                  title:
                    event.target.value,
                })
              }
              disabled={saving}
              placeholder="Delivery information"
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-slate-700">
                Shortcut
              </label>

              <input
                value={value.shortcut}
                maxLength={50}
                onChange={(event) =>
                  onChange({
                    ...value,

                    shortcut:
                      event.target.value,
                  })
                }
                disabled={saving}
                placeholder="/delivery"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Category
              </label>

              <input
                value={value.category}
                maxLength={100}
                onChange={(event) =>
                  onChange({
                    ...value,

                    category:
                      event.target.value,
                  })
                }
                disabled={saving}
                placeholder="Sales"
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-slate-700">
                Reply message
              </label>

              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setEmojiOpen(
                      (current) =>
                        !current,
                    )
                  }
                  disabled={saving}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                    emojiOpen
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                  aria-label="Insert emoji"
                >
                  <EmojiIcon />
                </button>

                {emojiOpen ? (
                  <>
                    <button
                      type="button"
                      className="fixed inset-0 z-50 cursor-default"
                      onClick={() =>
                        setEmojiOpen(false)
                      }
                      aria-label="Close emoji picker"
                    />

                    <div className="fixed bottom-10 left-1/2 z-[60] -translate-x-1/2 overflow-hidden rounded-xl shadow-2xl">
                      <EmojiPicker
                        width={350}
                        height={420}
                        lazyLoadEmojis
                        searchDisabled={false}
                        skinTonesDisabled={
                          false
                        }
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
              </div>
            </div>

            <textarea
              value={value.messageText}
              maxLength={5000}
              rows={8}
              onChange={(event) =>
                onChange({
                  ...value,

                  messageText:
                    event.target.value,
                })
              }
              disabled={saving}
              placeholder="Write the prepared response..."
              className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />

            <p className="mt-1 text-right text-xs text-slate-400">
              {value.messageText.length}
              /5000
            </p>
          </div>

          <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-medium text-slate-900">
                  Reply content
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  Add multiple images or
                  videos to this quick reply.
                </p>
              </div>

              {attachmentCount > 0 ? (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {attachmentCount} selected
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  imageInputRef.current?.click()
                }
                disabled={saving}
                className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <ImageIcon />

                Add images
              </button>

              <button
                type="button"
                onClick={() =>
                  videoInputRef.current?.click()
                }
                disabled={saving}
                className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <VideoIcon />

                Add videos
              </button>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={
                  handleImageChange
                }
                className="hidden"
              />

              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                multiple
                onChange={
                  handleVideoChange
                }
                className="hidden"
              />
            </div>

            {attachmentCount === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                No images or videos added.
              </div>
            ) : (
              <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
                {value.existingAttachments.map(
                  (attachment) => (
                    <div
                      key={attachment.id}
                      className="relative shrink-0"
                    >
                      {attachment.attachment_type ===
                      "image" ? (
                        <img
                          src={
                            attachment.public_url
                          }
                          alt={
                            attachment.file_name
                          }
                          className="h-28 w-28 rounded-xl border border-slate-200 object-cover"
                        />
                      ) : (
                        <video
                          src={
                            attachment.public_url
                          }
                          className="h-28 w-40 rounded-xl border border-slate-200 bg-black object-cover"
                          muted
                        />
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          removeExistingAttachment(
                            attachment.id,
                          )
                        }
                        disabled={saving}
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm font-semibold text-white shadow"
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  ),
                )}

                {value.newAttachments.map(
                  (attachment) => (
                    <div
                      key={attachment.id}
                      className="relative shrink-0"
                    >
                      {attachment.attachmentType ===
                      "image" ? (
                        <img
                          src={
                            attachment.previewUrl
                          }
                          alt={
                            attachment.file.name
                          }
                          className="h-28 w-28 rounded-xl border border-slate-200 object-cover"
                        />
                      ) : (
                        <video
                          src={
                            attachment.previewUrl
                          }
                          className="h-28 w-40 rounded-xl border border-slate-200 bg-black object-cover"
                          muted
                        />
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          removeNewAttachment(
                            attachment.id,
                          )
                        }
                        disabled={saving}
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-sm font-semibold text-white shadow"
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!value.isActive}
              onChange={(event) =>
                onChange({
                  ...value,

                  isActive:
                    !event.target.checked,
                })
              }
              disabled={saving}
              className="mt-1 h-5 w-5 rounded border-slate-300"
            />

            <span>
              <span className="font-medium text-slate-800">
                Disable this quick reply
              </span>

              <span className="mt-1 block text-sm text-slate-500">
                Disabled quick replies are
                hidden from the inbox reply
                selector.
              </span>
            </span>
          </label>

          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl bg-slate-100 px-5 py-3 font-medium text-slate-700 hover:bg-slate-200"
          >
            Close
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={
              saving ||
              !value.title.trim() ||
              !value.messageText.trim()
            }
            className="min-w-36 rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {saving
              ? "Saving..."
              : mode === "create"
                ? "Add quick reply"
                : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}