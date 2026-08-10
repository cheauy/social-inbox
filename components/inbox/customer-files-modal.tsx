"use client";

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

function FileIcon({
  kind,
}: {
  kind:
    | "file"
    | "link"
    | "attachment";
}) {
  if (
    kind === "link"
  ) {
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
          d="M10.5 13.5 13.5 10.5"
          strokeLinecap="round"
        />
        <path
          d="M8 17H7a5 5 0 0 1 0-10h3"
          strokeLinecap="round"
        />
        <path
          d="M16 7h1a5 5 0 1 1 0 10h-3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (
    kind ===
    "attachment"
  ) {
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
          d="M21 11.5 12.5 20a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9.1 9.1a2 2 0 1 1-2.8-2.8l8.4-8.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h5" />
      <path
        d="M9 13h6M9 17h5"
        strokeLinecap="round"
      />
    </svg>
  );
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
    useState<
      "saved"
      | "attachments"
    >("saved");

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
      setActiveTab(
        "saved",
      );
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
      setActiveTab(
        "saved",
      );
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

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close customer files"
      />

      <section className="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
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

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  "saved",
                )
              }
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab ===
                "saved"
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Saved ({savedFiles.length})
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveTab(
                  "attachments",
                )
              }
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab ===
                "attachments"
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Conversation attachments ({attachments.length})
            </button>
          </div>

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

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              Loading customer files...
            </div>
          ) : activeTab ===
            "saved" ? (
            savedFiles.length ===
            0 ? (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <FileIcon kind="file" />
                </div>

                <p className="mt-4 font-semibold text-slate-800">
                  No saved files or links yet
                </p>

                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Upload a customer document, product image, payment proof, or save an important link.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {savedFiles.map(
                  (item) => (
                    <article
                      key={
                        item.id
                      }
                      className="flex items-start gap-3 px-5 py-4"
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          item.itemType ===
                          "link"
                            ? "bg-violet-50 text-violet-600"
                            : "bg-blue-50 text-blue-600"
                        }`}
                      >
                        <FileIcon
                          kind={
                            item.itemType
                          }
                        />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="max-w-full truncate text-sm font-semibold text-slate-950">
                            {
                              item.displayName
                            }
                          </p>

                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            {item.itemType ===
                            "link"
                              ? "Link"
                              : fileKindLabel(
                                  item.mimeType,
                                )}
                          </span>
                        </div>

                        {item.itemType ===
                          "link" &&
                        item.externalUrl ? (
                          <p className="mt-1 truncate text-xs text-blue-600">
                            {
                              item.externalUrl
                            }
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">
                            {formatFileSize(
                              item.sizeBytes,
                            )}
                            {item.uploader
                              ?.full_name
                              ? ` · Added by ${item.uploader.full_name}`
                              : ""}
                          </p>
                        )}

                        <p className="mt-1 text-[11px] text-slate-400">
                          {formatDate(
                            item.createdAt,
                          )}
                        </p>

                        {item.description ? (
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            {
                              item.description
                            }
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {item.itemType ===
                          "link" &&
                        item.externalUrl ? (
                          <a
                            href={
                              item.externalUrl
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                          >
                            Open
                          </a>
                        ) : (
                          <>
                            {item.previewUrl ? (
                              <a
                                href={
                                  item.previewUrl
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                              >
                                View
                              </a>
                            ) : null}

                            <button
                              type="button"
                              onClick={() =>
                                void downloadFile(
                                  item,
                                )
                              }
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                            >
                              Download
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            void deleteItem(
                              item,
                            )
                          }
                          disabled={
                            deletingId ===
                            item.id
                          }
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId ===
                          item.id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      </div>
                    </article>
                  ),
                )}
              </div>
            )
          ) : attachments.length ===
            0 ? (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <FileIcon kind="attachment" />
              </div>

              <p className="mt-4 font-semibold text-slate-800">
                No conversation attachments found
              </p>

              <p className="mt-1 text-sm text-slate-500">
                Messenger photos, videos, audio, and files saved in message history will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {attachments.map(
                (
                  attachment,
                ) => (
                  <article
                    key={
                      attachment.id
                    }
                    className="flex items-start gap-3 px-5 py-4"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <FileIcon kind="attachment" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-950">
                          {messageAttachmentLabel(
                            attachment,
                          )}
                        </p>

                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            attachment.direction ===
                            "incoming"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {attachment.direction ===
                          "incoming"
                            ? "Customer"
                            : "Team"}
                        </span>
                      </div>

                      {attachment.messageText ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                          {
                            attachment.messageText
                          }
                        </p>
                      ) : null}

                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatDate(
                          attachment.createdAt,
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={
                          attachment.attachmentUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        Open
                      </a>

                      <a
                        href={`/dashboard/inbox?conversation=${encodeURIComponent(
                          attachment.conversationId,
                        )}`}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-600 transition hover:bg-blue-50"
                      >
                        Conversation
                      </a>
                    </div>
                  </article>
                ),
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-[11px] leading-5 text-slate-500">
          Saved customer files use private TENH storage. “Conversation attachments” are existing message attachments and are not copied into customer storage.
        </footer>
      </section>
    </div>
  );
}
