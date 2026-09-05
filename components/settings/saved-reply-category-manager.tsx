"use client";

import { useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import type { SavedReplyCategory } from "@/types/inbox";

type SavedReplyCategoryManagerProps = {
  categories: SavedReplyCategory[];
  canManage: boolean;

  onChange: (
    categories: SavedReplyCategory[],
  ) => void;

  /* Renaming and deleting change how replies are filed, so the list reloads. */
  onRepliesChanged: () => void;
};

function GripIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="7" cy="5" r="1.4" />
      <circle cx="13" cy="5" r="1.4" />
      <circle cx="7" cy="10" r="1.4" />
      <circle cx="13" cy="10" r="1.4" />
      <circle cx="7" cy="15" r="1.4" />
      <circle cx="13" cy="15" r="1.4" />
    </svg>
  );
}

export function SavedReplyCategoryManager({
  categories,
  canManage,
  onChange,
  onRepliesChanged,
}: SavedReplyCategoryManagerProps) {
  const isKhmer =
    useWorkspaceLanguageId() === "km";
  const t = (en: string, km: string) =>
    isKhmer ? km : en;

  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<
    string | null
  >(null);

  const [editingId, setEditingId] = useState<
    string | null
  >(null);
  const [editingName, setEditingName] =
    useState("");

  const [draggingId, setDraggingId] = useState<
    string | null
  >(null);

  async function createCategory() {
    const name = newName.trim();

    if (!name || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/saved-reply-categories",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({ name }),
        },
      );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          category?: SavedReplyCategory;
        };

      if (
        !response.ok ||
        !result.success ||
        !result.category
      ) {
        throw new Error(
          result.error ??
            "Unable to create that category.",
        );
      }

      onChange([
        ...categories,
        result.category,
      ]);
      setNewName("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create that category.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameCategory(
    category: SavedReplyCategory,
  ) {
    const name = editingName.trim();

    if (!name || busy) {
      return;
    }

    if (name === category.name) {
      setEditingId(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/saved-reply-categories/${category.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({ name }),
        },
      );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          category?: SavedReplyCategory;
        };

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.error ??
            "Unable to rename that category.",
        );
      }

      onChange(
        categories.map((item) =>
          item.id === category.id
            ? result.category ?? {
                ...item,
                name,
              }
            : item,
        ),
      );

      setEditingId(null);

      /* Replies carry the name, so their rows are now stale. */
      onRepliesChanged();
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "Unable to rename that category.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory(
    category: SavedReplyCategory,
  ) {
    if (busy) {
      return;
    }

    const confirmed = window.confirm(
      t(
        `Delete "${category.name}"? Its quick replies are kept and become uncategorised.`,
        `លុប "${category.name}"? ការឆ្លើយតបរហ័សរបស់វានឹងត្រូវរក្សាទុក ហើយក្លាយជាគ្មានប្រភេទ។`,
      ),
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/saved-reply-categories/${category.id}`,
        { method: "DELETE" },
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
            "Unable to delete that category.",
        );
      }

      onChange(
        categories.filter(
          (item) => item.id !== category.id,
        ),
      );

      onRepliesChanged();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that category.",
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * Reorder on the client first, then save.
   *
   * A drag should land where it was dropped and stay there; waiting for a round
   * trip to redraw makes the list twitch under the cursor. If the save fails
   * the error says so and a reload restores the stored order.
   */
  async function persistOrder(
    ordered: SavedReplyCategory[],
  ) {
    onChange(ordered);
    setError(null);

    try {
      const response = await fetch(
        "/api/saved-reply-categories",
        {
          method: "PUT",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            categoryIds: ordered.map(
              (item) => item.id,
            ),
          }),
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
            "Unable to save the new order.",
        );
      }
    } catch (orderError) {
      setError(
        orderError instanceof Error
          ? orderError.message
          : "Unable to save the new order.",
      );
    }
  }

  function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }

    const from = categories.findIndex(
      (item) => item.id === draggingId,
    );
    const to = categories.findIndex(
      (item) => item.id === targetId,
    );

    setDraggingId(null);

    if (from < 0 || to < 0) {
      return;
    }

    const ordered = [...categories];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);

    void persistOrder(ordered);
  }

  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">
          {t("Categories", "ប្រភេទ")}
        </h2>
        <p className="text-sm text-slate-500">
          {t(
            "Drag to set the order agents see.",
            "អូសដើម្បីកំណត់លំដាប់ដែលភ្នាក់ងារឃើញ។",
          )}
        </p>
      </div>

      {/*
        Said plainly because the names are chosen quickly and can end up
        candid -- "Angry customers", "Refund excuses". Categories are filing,
        not message text: nothing here is ever sent or shown outside the
        workspace, and knowing that up front is what makes them useful.
      */}
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
        {t(
          "Categories group your quick replies so your team can find them fast. They are used inside TENH only — customers never see a category name.",
          "ប្រភេទជួយដាក់ក្រុមការឆ្លើយតបរហ័ស ដើម្បីឲ្យក្រុមការងាររបស់អ្នករកឃើញបានលឿន។ វាប្រើនៅក្នុង TENH ប៉ុណ្ណោះ — អតិថិជនមិនឃើញឈ្មោះប្រភេទឡើយ។",
        )}
      </p>

      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {categories.length === 0 ? (
        <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
          {t(
            "No categories yet.",
            "មិនទាន់មានប្រភេទទេ។",
          )}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {categories.map((category) => (
            <li
              key={category.id}
              draggable={
                canManage &&
                editingId !== category.id
              }
              onDragStart={() =>
                setDraggingId(category.id)
              }
              onDragOver={(event) =>
                event.preventDefault()
              }
              onDrop={() =>
                handleDrop(category.id)
              }
              onDragEnd={() =>
                setDraggingId(null)
              }
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition ${
                draggingId === category.id
                  ? "border-violet-300 bg-violet-50 opacity-60"
                  : "border-slate-200 bg-white"
              }`}
            >
              {canManage ? (
                <span
                  className="cursor-grab text-slate-400"
                  aria-hidden="true"
                >
                  <GripIcon />
                </span>
              ) : null}

              {editingId === category.id ? (
                <input
                  value={editingName}
                  autoFocus
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) =>
                    setEditingName(
                      event.target.value,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void renameCategory(
                        category,
                      );
                    }

                    if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  onBlur={() =>
                    void renameCategory(category)
                  }
                  className="min-w-0 flex-1 rounded-lg border border-violet-300 px-2 py-1 text-sm font-medium text-slate-900 outline-none focus:ring-4 focus:ring-violet-100"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                  {category.name}
                </span>
              )}

              {canManage &&
              editingId !== category.id ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(category.id);
                      setEditingName(
                        category.name,
                      );
                    }}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    {t("Rename", "ប្តូរឈ្មោះ")}
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void deleteCategory(
                        category,
                      )
                    }
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    {t("Delete", "លុប")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createCategory();
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={newName}
            maxLength={100}
            disabled={busy}
            onChange={(event) =>
              setNewName(event.target.value)
            }
            placeholder={t(
              "New category",
              "ប្រភេទថ្មី",
            )}
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("Add", "បន្ថែម")}
          </button>
        </form>
      ) : null}
    </section>
  );
}
