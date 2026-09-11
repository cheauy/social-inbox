"use client";

import { CustomerFileLibrary, type LibraryItem, type LibraryTab } from "./customer-file-library";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createClient,
} from "@/lib/supabase/client";

type SavedCustomerFile = {
  id: string;
  conversationId:
    | string
    | null;
  itemType:
    | "file"
    | "link";
  displayName: string;
  externalUrl:
    | string
    | null;
  mimeType:
    | string
    | null;
  sizeBytes:
    | number
    | null;
  description:
    | string
    | null;
  previewUrl:
    | string
    | null;
  createdAt: string;
  updatedAt: string;
  uploadedByMemberId:
    | string
    | null;
  uploader:
    | {
        id: string;
        full_name: string;
        profile_picture_url:
          | string
          | null;
      }
    | null;
};

type ConversationAttachment = {
  id: string;
  conversationId: string;
  direction: string;
  messageType: string;
  messageText:
    | string
    | null;
  attachmentUrl: string;
  createdAt: string;
};

type FilesResponse = {
  success?: boolean;
  error?: string;
  savedFiles?:
    SavedCustomerFile[];
  conversationAttachments?:
    ConversationAttachment[];
};

type CustomerFilesModalProps = {
  contactId: string;
  conversationId: string;
  customerName: string;
  onClose: () => void;
};

const MAX_FILE_SIZE =
  20 * 1024 * 1024;

const ACCEPT =
  "image/*,video/*,audio/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip";

function formatFileSize(
  value:
    | number
    | null,
) {
  if (
    value === null ||
    !Number.isFinite(
      value,
    )
  ) {
    return "";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (
    value <
    1024 * 1024
  ) {
    return `${(
      value / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    value /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function formatDate(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function fileKindLabel(
  mimeType:
    | string
    | null,
) {
  if (!mimeType) {
    return "File";
  }

  if (
    mimeType.startsWith(
      "image/",
    )
  ) {
    return "Image";
  }

  if (
    mimeType.startsWith(
      "video/",
    )
  ) {
    return "Video";
  }

  if (
    mimeType.startsWith(
      "audio/",
    )
  ) {
    return "Audio";
  }

  if (
    mimeType ===
    "application/pdf"
  ) {
    return "PDF";
  }

  return "Document";
}

function messageAttachmentLabel(
  attachment:
    ConversationAttachment,
) {
  const raw =
    attachment.messageType
      ?.trim()
      .toLowerCase();

  if (
    raw === "image" ||
    raw === "photo"
  ) {
    return "Image";
  }

  if (
    raw === "video"
  ) {
    return "Video";
  }

  if (
    raw === "audio"
  ) {
    return "Audio";
  }

  if (
    raw === "file"
  ) {
    return "File";
  }

  return "Attachment";
}

function CloseIcon() {
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
        d="M6 6l12 12M18 6 6 18"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CustomerFilesModal({
  contactId,
  conversationId,
  customerName,
  onClose,
}: CustomerFilesModalProps) {
  const supabase =
    useMemo(
      () =>
        createClient(),
      [],
    );

  const [
    activeTab,
    setActiveTab,
  ] =
    useState<LibraryTab>("media");

  const [
    savedFiles,
    setSavedFiles,
  ] =
    useState<
      SavedCustomerFile[]
    >([]);

  const [
    attachments,
    setAttachments,
  ] =
    useState<
      ConversationAttachment[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    uploading,
    setUploading,
  ] =
    useState(false);

  const [
    deletingId,
    setDeletingId,
  ] =
    useState<
      string | null
    >(null);

  const [error, setError] =
    useState<
      string | null
    >(null);

  const [
    linkFormOpen,
    setLinkFormOpen,
  ] =
    useState(false);

  const [
    linkTitle,
    setLinkTitle,
  ] =
    useState("");

  const [
    linkUrl,
    setLinkUrl,
  ] =
    useState("");

  const [
    savingLink,
    setSavingLink,
  ] =
    useState(false);

  const inputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const loadFiles =
    useCallback(
      async (
        silent = false,
      ) => {
        if (!silent) {
          setLoading(true);
        }

        setError(null);

        try {
          const response =
            await fetch(
              `/api/customers/${encodeURIComponent(
                contactId,
              )}/files`,
              {
                cache:
                  "no-store",
              },
            );

          const result =
            (await response.json()) as
              FilesResponse;

          if (
            !response.ok ||
            !result.success
          ) {
            throw new Error(
              result.error ??
                "Unable to load customer files.",
            );
          }

          setSavedFiles(
            result.savedFiles ??
              [],
          );

          setAttachments(
            result.conversationAttachments ??
              [],
          );
        } catch (
          loadError
        ) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load customer files.",
          );
        } finally {
          if (!silent) {
            setLoading(false);
          }
        }
      },
      [contactId],
    );

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const channel =
      supabase
        .channel(
          `tenh-customer-files-${contactId}`,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table:
              "customer_files",
            filter:
              `contact_id=eq.${contactId}`,
          },
          () => {
            void loadFiles(
              true,
            );
          },
        )
        .subscribe(
          (status) => {
            if (
              status ===
              "SUBSCRIBED"
            ) {
              console.log(
                "[Tenh Customer Files V2.18] ✅ REALTIME READY",
              );
            }
          },
        );

    return () => {
      void supabase
        .removeChannel(
          channel,
        );
    };
  }, [
    contactId,
    loadFiles,
    supabase,
  ]);

  useEffect(() => {
    function onKeyDown(
      event:
        KeyboardEvent,
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        onClose();
      }
    }

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [onClose]);

  async function uploadFile(
    file: File,
  ) {
    if (
      file.size <= 0 ||
      file.size >
        MAX_FILE_SIZE
    ) {
      setError(
        "Choose a file between 1 byte and 20 MB.",
      );
      return;
    }

    if (!file.type) {
      setError(
        "This file has no recognized MIME type. Choose a supported image, video, audio, PDF, Office document, text/CSV, or ZIP file.",
      );
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const prepareResponse =
        await fetch(
          `/api/customers/${encodeURIComponent(
            contactId,
          )}/files`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                {
                  action:
                    "prepare-upload",
                  fileName:
                    file.name,
                  mimeType:
                    file.type,
                  sizeBytes:
                    file.size,
                  conversationId,
                },
              ),
          },
        );

      const prepareResult =
        (await prepareResponse.json()) as {
          success?: boolean;
          error?: string;
          upload?: {
            bucket: string;
            path: string;
            token: string;
          };
        };

      if (
        !prepareResponse.ok ||
        !prepareResult.success ||
        !prepareResult.upload
      ) {
        throw new Error(
          prepareResult.error ??
            "Unable to prepare the upload.",
        );
      }

      const {
        bucket,
        path,
        token,
      } =
        prepareResult.upload;

      const {
        error:
          uploadError,
      } =
        await supabase
          .storage
          .from(bucket)
          .uploadToSignedUrl(
            path,
            token,
            file,
            {
              contentType:
                file.type,
            },
          );

      if (uploadError) {
        throw new Error(
          uploadError.message,
        );
      }

      const finalizeResponse =
        await fetch(
          `/api/customers/${encodeURIComponent(
            contactId,
          )}/files`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                {
                  action:
                    "finalize-upload",
                  fileName:
                    file.name,
                  mimeType:
                    file.type,
                  sizeBytes:
                    file.size,
                  storagePath:
                    path,
                  conversationId,
                },
              ),
          },
        );

      const finalizeResult =
        (await finalizeResponse.json()) as {
          success?: boolean;
          error?: string;
        };

      if (
        !finalizeResponse.ok ||
        !finalizeResult.success
      ) {
        throw new Error(
          finalizeResult.error ??
            "Unable to save the customer file.",
        );
      }

      await loadFiles(
        true,
      );
      setActiveTab(file.type.startsWith("image/") || file.type.startsWith("video/") ? "media" : "files");
    } catch (
      uploadError
    ) {
      setError(
        uploadError instanceof
          Error
          ? uploadError.message
          : "Unable to upload the customer file.",
      );
    } finally {
      setUploading(false);

      if (
        inputRef.current
      ) {
        inputRef.current.value =
          "";
      }
    }
  }

  async function addLink() {
    if (
      !linkUrl.trim()
    ) {
      setError(
        "Enter a link first.",
      );
      return;
    }

    setSavingLink(true);
    setError(null);

    try {
      const response =
        await fetch(
          `/api/customers/${encodeURIComponent(
            contactId,
          )}/files`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                {
                  action:
                    "add-link",
                  linkTitle:
                    linkTitle.trim(),
                  linkUrl:
                    linkUrl.trim(),
                  conversationId,
                },
              ),
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
        };

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to save this link.",
        );
      }

      setLinkFormOpen(
        false,
      );
      setLinkTitle("");
      setLinkUrl("");

      await loadFiles(
        true,
      );
      setActiveTab("links");
    } catch (
      linkError
    ) {
      setError(
        linkError instanceof
          Error
          ? linkError.message
          : "Unable to save this link.",
      );
    } finally {
      setSavingLink(false);
    }
  }

  async function deleteItem(
    item:
      SavedCustomerFile,
  ) {
    const confirmed =
      window.confirm(
        item.itemType ===
          "link"
          ? `Delete "${item.displayName}" from this customer?`
          : `Delete "${item.displayName}" from this customer and storage?`,
      );

    if (!confirmed) {
      return;
    }

    setDeletingId(
      item.id,
    );
    setError(null);

    try {
      const response =
        await fetch(
          `/api/customers/${encodeURIComponent(
            contactId,
          )}/files/${encodeURIComponent(
            item.id,
          )}`,
          {
            method:
              "DELETE",
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
        };

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to delete the item.",
        );
      }

      setSavedFiles(
        (current) =>
          current.filter(
            (existing) =>
              existing.id !==
              item.id,
          ),
      );
    } catch (
      deleteError
    ) {
      setError(
        deleteError instanceof
          Error
          ? deleteError.message
          : "Unable to delete the item.",
      );
    } finally {
      setDeletingId(
        null,
      );
    }
  }

  async function downloadFile(
    item:
      SavedCustomerFile,
  ) {
    setError(null);

    try {
      const response =
        await fetch(
          `/api/customers/${encodeURIComponent(
            contactId,
          )}/files`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                {
                  action:
                    "get-file-url",
                  fileId:
                    item.id,
                },
              ),
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          signedUrl?: string;
        };

      if (
        !response.ok ||
        !result.success ||
        !result.signedUrl
      ) {
        throw new Error(
          result.error ??
            "Unable to download the file.",
        );
      }

      window.open(
        result.signedUrl,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (
      downloadError
    ) {
      setError(
        downloadError instanceof
          Error
          ? downloadError.message
          : "Unable to download the file.",
      );
    }
  }

  const libraryItems = useMemo<LibraryItem[]>(() => {
    const kind = (type: string): LibraryItem["kind"] => {
      const value = type.toLowerCase();
      if (value === "link") return "link";
      if (value === "photo" || value === "image" || value.startsWith("image/")) return "image";
      if (value === "video" || value.startsWith("video/")) return "video";
      if (value === "audio" || value === "voice" || value.startsWith("audio/")) return "audio";
      return "file";
    };
    return [
      ...savedFiles.map((item): LibraryItem => ({
        id: `saved:${item.id}`, savedId: item.id,
        kind: item.itemType === "link" ? "link" : kind(item.mimeType ?? ""),
        name: item.displayName, url: item.itemType === "link" ? item.externalUrl : item.previewUrl,
        createdAt: item.createdAt,
        detail: [fileKindLabel(item.mimeType), formatFileSize(item.sizeBytes), formatDate(item.createdAt)].filter(Boolean).join(" · "),
      })),
      ...attachments.map((item): LibraryItem => ({
        id: `attachment:${item.id}`, conversationId: item.conversationId,
        kind: kind(item.messageType), name: item.messageText || messageAttachmentLabel(item),
        url: item.attachmentUrl, createdAt: item.createdAt,
        detail: `${item.direction === "incoming" ? "Customer" : "Team"} · ${formatDate(item.createdAt)}`,
      })),
    ];
  }, [savedFiles, attachments]);

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close customer files"
      />

      <section role="dialog" aria-modal="true" aria-label="Files, documents and links" className="relative z-10 flex h-[min(88dvh,850px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Files, documents & links
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              {customerName}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept={ACCEPT}
              onChange={(
                event,
              ) => {
                const file =
                  event.target.files?.[0];

                if (file) {
                  void uploadFile(
                    file,
                  );
                }
              }}
            />

            <button
              type="button"
              onClick={() =>
                setLinkFormOpen(
                  (current) =>
                    !current,
                )
              }
              disabled={
                uploading
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add link
            </button>

            <button
              type="button"
              onClick={() =>
                inputRef.current?.click()
              }
              disabled={
                uploading
              }
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {uploading
                ? "Uploading..."
                : "Upload file"}
            </button>
          </div>
        </div>

        {linkFormOpen ? (
          <div className="border-b border-slate-200 bg-white px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(160px,0.45fr)_minmax(0,1fr)_auto]">
              <input
                value={
                  linkTitle
                }
                onChange={(
                  event,
                ) =>
                  setLinkTitle(
                    event.target.value,
                  )
                }
                placeholder="Link title (optional)"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <input
                value={linkUrl}
                onChange={(
                  event,
                ) =>
                  setLinkUrl(
                    event.target.value,
                  )
                }
                placeholder="https://..."
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <button
                type="button"
                onClick={() =>
                  void addLink()
                }
                disabled={
                  savingLink
                }
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {savingLink
                  ? "Saving..."
                  : "Save link"}
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <CustomerFileLibrary
          items={libraryItems}
          tab={activeTab}
          onTab={setActiveTab}
          loading={loading}
          deletingId={deletingId}
          onDelete={(id) => { const item = savedFiles.find((file) => file.id === id); if (item) void deleteItem(item); }}
          onDownload={(id) => { const item = savedFiles.find((file) => file.id === id); if (item) void downloadFile(item); }}
        />
      </section>
    </div>
  );
}
