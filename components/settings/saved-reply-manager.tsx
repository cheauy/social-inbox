"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  SavedReplyFormModal,
  type SavedReplyFormValue,
} from "@/components/settings/saved-reply-form-modal";

import type { SavedReply } from "@/types/inbox";

type SavedReplyManagerProps = {
  businessId: string;
  initialSavedReplies: SavedReply[];
};

type SavedReplyResponse = {
  success?: boolean;
  error?: string;
  savedReply?: SavedReply;
};

function emptyForm(
  nextIndex: number,
): SavedReplyFormValue {
  return {
    title: "",
    shortcut: "",
    category: "",
    messageText: "",
    sortIndex: nextIndex,
    isActive: true,

    existingAttachments: [],
    newAttachments: [],
    removedAttachmentIds: [],
  };
}

function formFromReply(
  reply: SavedReply,
): SavedReplyFormValue {
  return {
    title: reply.title,
    shortcut: reply.shortcut ?? "",
    category: reply.category ?? "",
    messageText: reply.message_text,
    sortIndex: reply.sort_index,
    isActive: reply.is_active,

    existingAttachments:
      reply.attachments ?? [],

    newAttachments: [],

    removedAttachmentIds: [],
  };
}

export function SavedReplyManager({
  businessId,
  initialSavedReplies,
}: SavedReplyManagerProps) {
  const [savedReplies, setSavedReplies] =
    useState<SavedReply[]>(
      initialSavedReplies,
    );

  const [search, setSearch] =
    useState("");

  const [modalMode, setModalMode] =
    useState<"create" | "edit" | null>(
      null,
    );

  const [selectedReply, setSelectedReply] =
    useState<SavedReply | null>(null);

  const [form, setForm] =
    useState<SavedReplyFormValue>(
      emptyForm(
        initialSavedReplies.length + 1,
      ),
    );

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const filteredReplies = useMemo(() => {
    const query = search
      .trim()
      .toLowerCase();

    if (!query) {
      return savedReplies;
    }

    return savedReplies.filter((reply) =>
      [
        reply.title,
        reply.shortcut ?? "",
        reply.category ?? "",
        reply.message_text,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [savedReplies, search]);

  const sortedReplies = useMemo(
    () =>
      [...filteredReplies].sort(
        (first, second) => {
          if (
            first.is_active !==
            second.is_active
          ) {
            return first.is_active
              ? -1
              : 1;
          }

          return (
            first.sort_index -
              second.sort_index ||
            first.title.localeCompare(
              second.title,
            )
          );
        },
      ),
    [filteredReplies],
  );

  function openCreate() {
    const nextIndex =
      savedReplies.reduce(
        (largest, reply) =>
          Math.max(
            largest,
            reply.sort_index,
          ),
        0,
      ) + 1;

    setSelectedReply(null);
    setForm(emptyForm(nextIndex));
    setError(null);
    setModalMode("create");
  }

  function openEdit(
    reply: SavedReply,
  ) {
    setSelectedReply(reply);
    setForm(formFromReply(reply));
    setError(null);
    setModalMode("edit");
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalMode(null);
    setSelectedReply(null);
    setError(null);
  }

  async function submitForm() {
    setSaving(true);
    setError(null);

    try {
      const isEditing =
        modalMode === "edit" &&
        selectedReply !== null;

      const response = await fetch(
        isEditing
          ? `/api/saved-replies/${selectedReply.id}`
          : "/api/saved-replies",
        {
          method: isEditing
            ? "PATCH"
            : "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            ...(isEditing
              ? {}
              : {
                  businessId,
                }),

            title: form.title,

            shortcut:
              form.shortcut,

            category:
              form.category,

            messageText:
              form.messageText,

            sortIndex:
              form.sortIndex,

            isActive:
              form.isActive,
          }),
        },
      );

      const result =
        (await response.json()) as SavedReplyResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.savedReply
      ) {
        throw new Error(
          result.error ??
            "Unable to save quick reply.",
        );
      }

      if (isEditing) {
        setSavedReplies((current) =>
          current.map((reply) =>
            reply.id ===
            result.savedReply?.id
              ? (result.savedReply as SavedReply)
              : reply,
          ),
        );
      } else {
        setSavedReplies((current) => [
          ...current,
          result.savedReply as SavedReply,
        ]);
      }

      setModalMode(null);
      setSelectedReply(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save quick reply.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(
    reply: SavedReply,
  ) {
    try {
      const response = await fetch(
        `/api/saved-replies/${reply.id}`,
        {
          method: "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            isActive:
              !reply.is_active,
          }),
        },
      );

      const result =
        (await response.json()) as SavedReplyResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.savedReply
      ) {
        throw new Error(
          result.error ??
            "Unable to update quick reply.",
        );
      }

      setSavedReplies((current) =>
        current.map((item) =>
          item.id === reply.id
            ? (result.savedReply as SavedReply)
            : item,
        ),
      );
    } catch (toggleError) {
      window.alert(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update quick reply.",
      );
    }
  }

  async function deleteReply(
    reply: SavedReply,
  ) {
    const confirmed =
      window.confirm(
        `Delete "${reply.title}"?`,
      );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `/api/saved-replies/${reply.id}`,
        {
          method: "DELETE",
        },
      );

      const result =
        (await response.json()) as SavedReplyResponse;

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to delete quick reply.",
        );
      }

      setSavedReplies((current) =>
        current.filter(
          (item) =>
            item.id !== reply.id,
        ),
      );
    } catch (deleteError) {
      window.alert(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete quick reply.",
      );
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Search quick replies..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:max-w-md"
          />

          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700"
          >
            + New quick reply
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Index
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Quick reply
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Category
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Message
                </th>

                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>

                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {sortedReplies.length ===
              0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-sm text-slate-500"
                  >
                    No quick replies found.
                  </td>
                </tr>
              ) : (
                sortedReplies.map(
                  (reply) => (
                    <tr
                      key={reply.id}
                      className={
                        reply.is_active
                          ? ""
                          : "bg-slate-50 opacity-70"
                      }
                    >
                      <td className="px-5 py-4 text-sm text-slate-600">
                        {
                          reply.sort_index
                        }
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">
                          {reply.title}
                        </p>

                        {reply.shortcut ? (
                          <span className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-600">
                            {
                              reply.shortcut
                            }
                          </span>
                        ) : null}
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {reply.category ??
                          "Uncategorized"}
                      </td>

                      <td className="max-w-md px-5 py-4">
                        <p className="line-clamp-2 text-sm leading-6 text-slate-600">
                          {
                            reply.message_text
                          }
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() =>
                            void toggleActive(
                              reply,
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            reply.is_active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {reply.is_active
                            ? "Active"
                            : "Disabled"}
                        </button>
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              openEdit(
                                reply,
                              )
                            }
                            className="text-sm font-medium text-blue-700 hover:underline"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              void deleteReply(
                                reply,
                              )
                            }
                            className="text-sm font-medium text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode ? (
        <SavedReplyFormModal
          mode={modalMode}
          value={form}
          saving={saving}
          error={error}
          onChange={setForm}
          onClose={closeModal}
          onSubmit={() =>
            void submitForm()
          }
        />
      ) : null}
    </>
  );
}