"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import EmojiPicker from "emoji-picker-react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

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
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";

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

  const titleCount = value.title.length;
  const shortcutCount = value.shortcut.length;
  const messageCount = value.messageText.length;

  const existingPreviewSrc = (
    attachment: SavedReplyAttachment,
  ) =>
    ((attachment as any).previewUrl ??
      (attachment as any).url ??
      (attachment as any).file_url ??
      (attachment as any).fileUrl ??
      null) as string | null;

  const existingDisplayName = (
    attachment: SavedReplyAttachment,
  ) =>
    ((attachment as any).file_name ??
      (attachment as any).fileName ??
      (attachment as any).name ??
      "Attachment") as string;

  const attachmentCount =
    value.existingAttachments.length +
    value.newAttachments.length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45 p-3 sm:p-5">
      <div className="mx-auto flex h-full max-h-[96vh] w-full max-w-[980px] items-center justify-center">
        <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 shadow-inner ring-1 ring-violet-100">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6" aria-hidden="true">
                  <path d="M8 12h8M12 8v8" strokeLinecap="round" />
                  <path d="M7.5 4h9A3.5 3.5 0 0 1 20 7.5v6.3a3.5 3.5 0 0 1-3.5 3.5h-5l-4.5 3v-3H7.5A3.5 3.5 0 0 1 4 13.8V7.5A3.5 3.5 0 0 1 7.5 4Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <div>
                <h2 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-slate-900">
                  {mode === "create"
                    ? (isKhmer ? "បន្ថែមការឆ្លើយតបរហ័ស" : "Add quick reply")
                    : (isKhmer ? "កែសម្រួលការឆ្លើយតបរហ័ស" : "Edit quick reply")}
                </h2>
                <p className="mt-1 text-[15px] text-slate-600">
                  {mode === "create"
                    ? (isKhmer
                        ? "បង្កើតការឆ្លើយតបរហ័ស ដើម្បីសន្សំពេលវេលា និងឆ្លើយតបបានលឿនជាងមុន។"
                        : "Create a quick reply to save time and respond faster.")
                    : (isKhmer
                        ? "កែប្រែការឆ្លើយតបរហ័សនេះ ដោយរក្សារបៀបដំណើរការដែលមានស្រាប់។"
                        : "Update this quick reply while keeping its existing behavior.")}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={isKhmer ? "បិទ" : "Close"}
            >
              <span className="text-[28px] leading-none">×</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div className="space-y-4">
              <div className="rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-violet-500 ring-1 ring-violet-100">
                    <span className="text-sm font-bold">i</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{isKhmer ? "ការរៀបតាមលំដាប់លេខ" : "Index ordering"}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {isKhmer
                        ? "ការឆ្លើយតបត្រូវបានតម្រៀបតាមលេខពីតូចទៅធំ។ លេខតូចជាងបង្ហាញមុន។"
                        : "Replies are sorted by index in ascending order. Lower numbers appear first."}
                    </p>
                  </div>
                </div>
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="text-[15px] font-semibold text-slate-900">{isKhmer ? "លំដាប់ការឆ្លើយតប" : "Reply index"}</label>
                    <span className="text-sm text-slate-500">{isKhmer ? "លេខតូចជាងបង្ហាញមុន។" : "Lower numbers appear first."}</span>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={value.sortIndex}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        sortIndex: Math.max(0, Number(event.target.value || 0)),
                      })
                    }
                    disabled={saving}
                    className="h-12 w-full rounded-xl border border-slate-300 px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  />
                </div>

                <div>
                  <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <label className="text-[15px] font-semibold text-slate-900">{isKhmer ? "ចំណងជើងការឆ្លើយតប" : "Reply title"}</label>
                    <span className="text-sm text-slate-500">{isKhmer ? "ចំណងជើងខ្លីសម្រាប់សម្គាល់ការឆ្លើយតបរហ័សនេះ។" : "A short title to identify this quick reply."}</span>
                  </div>
                  <div className="relative">
                    <input
                      value={value.title}
                      maxLength={100}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          title: event.target.value,
                        })
                      }
                      disabled={saving}
                      placeholder={isKhmer ? "ព័ត៌មានអំពីការដឹកជញ្ជូន" : "Delivery information"}
                      className="h-12 w-full rounded-xl border border-slate-300 px-4 pr-20 text-[15px] font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      {titleCount}/100
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <label className="text-[15px] font-semibold text-slate-900">{isKhmer ? "ផ្លូវកាត់" : "Shortcut"}</label>
                    <span className="text-sm text-slate-500">{isKhmer ? "(ស្រេចចិត្ត)" : "(optional)"}</span>
                  </div>
                  <p className="mb-2 text-sm text-slate-500">
                    {isKhmer
                      ? "វាយ / + ពាក្យគន្លឹះ ដើម្បីបញ្ចូលការឆ្លើយតបនេះបានរហ័ស។"
                      : "Type / + keyword to insert this reply quickly."}
                  </p>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-slate-500">/</span>
                    <input
                      value={value.shortcut}
                      maxLength={50}
                      onChange={(event) =>
                        onChange({
                          ...value,
                          shortcut: event.target.value.replace(/^\//, ""),
                        })
                      }
                      disabled={saving}
                      placeholder={isKhmer ? "ដឹកជញ្ជូន" : "delivery"}
                      className="h-12 w-full rounded-xl border border-slate-300 px-10 pr-16 text-[15px] font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                      {shortcutCount}/50
                    </span>
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <label className="text-[15px] font-semibold text-slate-900">
                      {isKhmer ? "ប្រភេទ" : "Category"}
                    </label>
                  </div>

                  <p className="mb-2 text-sm text-slate-500">
                    {isKhmer
                      ? "រៀបចំការឆ្លើយតបរហ័សរបស់អ្នកតាមប្រភេទ។"
                      : "Organize your quick replies."}
                  </p>

                  <input
                    value={value.category}
                    maxLength={100}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        category: event.target.value,
                      })
                    }
                    disabled={saving}
                    placeholder={isKhmer ? "ការលក់" : "Sales"}
                    className="h-12 w-full rounded-xl border border-slate-300 px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="text-[15px] font-semibold text-slate-900">{isKhmer ? "សារឆ្លើយតប" : "Reply message"}</label>
                    <span className="text-sm text-slate-500">{isKhmer ? "សរសេរសារដែលនឹងត្រូវផ្ញើទៅអតិថិជន។" : "Write the message that will be sent to customers."}</span>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setEmojiOpen((current) => !current)}
                      disabled={saving}
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <EmojiIcon />
                      {isKhmer ? "បញ្ចូល Emoji" : "Insert emoji"}
                    </button>

                    {emojiOpen ? (
                      <>
                        <button
                          type="button"
                          className="fixed inset-0 z-50 cursor-default"
                          onClick={() => setEmojiOpen(false)}
                          aria-label={isKhmer ? "បិទឧបករណ៍ជ្រើស Emoji" : "Close emoji picker"}
                        />
                        <div className="absolute right-0 top-[calc(100%+10px)] z-[60] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                          <EmojiPicker
                            onEmojiClick={(emojiData) => {
                              insertEmoji(emojiData.emoji);
                              setEmojiOpen(false);
                            }}
                            lazyLoadEmojis
                            width={320}
                            height={380}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <textarea
                  rows={7}
                  value={value.messageText}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      messageText: event.target.value,
                    })
                  }
                  disabled={saving}
                  placeholder={isKhmer ? "សរសេរការឆ្លើយតបដែលបានរៀបចំ..." : "Write the prepared response..."}
                  className="min-h-[170px] w-full resize-y rounded-2xl border border-slate-300 px-4 py-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
                />
                <p className="mt-2 text-right text-sm text-slate-400">{messageCount}/5000</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-slate-900">{isKhmer ? "មាតិកាការឆ្លើយតប" : "Reply content"}</h3>
                    <span className="text-sm text-slate-500">{isKhmer ? "(ស្រេចចិត្ត)" : "(optional)"}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {isKhmer
                      ? "បន្ថែមរូបភាព ឬវីដេអូទៅការឆ្លើយតបរហ័សនេះ។"
                      : "Add images or videos to this quick reply."}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ImageIcon />
                    {isKhmer ? "បន្ថែមរូបភាព" : "Add images"}
                  </button>

                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={saving}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <VideoIcon />
                    {isKhmer ? "បន្ថែមវីដេអូ" : "Add videos"}
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

                <div className="mt-4 rounded-2xl border border-dashed border-violet-300 bg-violet-50/25 px-4 py-8 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-500">
                    <ImageIcon />
                  </div>
                  <p className="text-[15px] font-medium text-slate-600">
                    {isKhmer
                      ? "បន្ថែមរូបភាព ឬវីដេអូដោយប្រើប៊ូតុងខាងលើ។"
                      : "Add images or videos using the buttons above."}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {isKhmer
                      ? "រូបភាពអតិបរមា 10MB • វីដេអូអតិបរមា 50MB"
                      : "Images max 10MB • Videos max 50MB"}
                  </p>
                </div>

                {attachmentCount > 0 ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {value.existingAttachments.map((attachment) => {
                      const previewSrc = existingPreviewSrc(attachment);
                      const attachmentType =
                        (((attachment as any).attachment_type ??
                          (attachment as any).attachmentType ??
                          "image") as SavedReplyAttachmentType);

                      return (
                        <div
                          key={attachment.id}
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                        >
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                            {previewSrc && attachmentType === "image" ? (
                              <img
                                src={previewSrc}
                                alt={existingDisplayName(attachment)}
                                className="h-full w-full object-cover"
                              />
                            ) : attachmentType === "video" ? (
                              <VideoIcon />
                            ) : (
                              <ImageIcon />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {existingDisplayName(attachment)}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              {isKhmer
                                ? `${attachmentType === "image" ? "រូបភាព" : "វីដេអូ"}ដែលមានស្រាប់`
                                : `Existing ${attachmentType}`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeExistingAttachment(attachment.id)}
                            disabled={saving}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-white hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={isKhmer ? "ដកឯកសារភ្ជាប់ចេញ" : "Remove attachment"}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}

                    {value.newAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3"
                      >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                          {attachment.attachmentType === "image" ? (
                            <img
                              src={attachment.previewUrl}
                              alt={attachment.file.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <VideoIcon />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {attachment.file.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {isKhmer
                              ? `${attachment.attachmentType === "image" ? "រូបភាព" : "វីដេអូ"}ថ្មី`
                              : `New ${attachment.attachmentType}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeNewAttachment(attachment.id)}
                          disabled={saving}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-white hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={isKhmer ? "ដកឯកសារភ្ជាប់ចេញ" : "Remove attachment"}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200 px-4 py-4">
                <label className="flex items-start gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!value.isActive}
                    onClick={() =>
                      onChange({
                        ...value,
                        isActive: !value.isActive,
                      })
                    }
                    disabled={saving}
                    className={`mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
                      value.isActive ? "bg-slate-200" : "bg-violet-600"
                    }`}
                  >
                    <span
                      className={`h-5 w-5 rounded-full bg-white shadow transition ${
                        value.isActive ? "translate-x-0" : "translate-x-5"
                      }`}
                    />
                  </button>

                  <span className="block">
                    <span className="text-[15px] font-semibold text-slate-900">
                      {isKhmer ? "បិទការឆ្លើយតបរហ័សនេះ" : "Disable this quick reply"}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {isKhmer
                        ? "ការឆ្លើយតបដែលបានបិទ នឹងមិនបង្ហាញក្នុងបញ្ជីការឆ្លើយតបរហ័សទេ។"
                        : "Disabled replies won’t be shown in the quick reply list."}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-300 px-6 text-[15px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isKhmer ? "បោះបង់" : "Cancel"}
            </button>

            <button
              type="button"
              onClick={onSubmit}
              disabled={
                saving ||
                !value.title.trim() ||
                !value.messageText.trim()
              }
              className="inline-flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 text-[15px] font-semibold text-white shadow-[0_12px_24px_rgba(124,58,237,0.28)] transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {saving
                ? (isKhmer ? "កំពុងរក្សាទុក..." : "Saving...")
                : mode === "create"
                  ? (isKhmer ? "បង្កើតការឆ្លើយតបរហ័ស" : "Create quick reply")
                  : (isKhmer ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
