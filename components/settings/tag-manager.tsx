"use client";

import { useMemo, useState } from "react";

import {
  TagFormModal,
  type TagFormValue,
} from "@/components/settings/tag-form-modal";
import type {
  CustomerTag,
  TagColor,
} from "@/types/inbox";

type TagManagerProps = {
  businessId: string;
  initialTags: CustomerTag[];
};

type TagResponse = {
  success?: boolean;
  error?: string;
  tag?: CustomerTag;
};

const badgeClasses: Record<
  TagColor,
  string
> = {
  slate: "bg-slate-500 text-white",
  red: "bg-red-500 text-white",
  orange: "bg-orange-500 text-white",
  amber: "bg-amber-500 text-white",
  teal: "bg-teal-500 text-white",
  blue: "bg-blue-500 text-white",
  indigo: "bg-indigo-500 text-white",
  violet: "bg-violet-500 text-white",
  yellow: "bg-amber-400 text-slate-900",
  emerald: "bg-emerald-600 text-white",
  pink: "bg-pink-500 text-white",
};

function emptyForm(nextIndex: number): TagFormValue {
  return {
    name: "",
    color: "emerald",
    sortIndex: nextIndex,
    description: "",
    isActive: true,
  };
}

function formFromTag(
  tag: CustomerTag,
): TagFormValue {
  return {
    name: tag.name,
    color: tag.color,
    sortIndex: tag.sort_index,
    description: tag.description ?? "",
    isActive: tag.is_active,
  };
}

export function TagManager({
  businessId,
  initialTags,
}: TagManagerProps) {
  const [tags, setTags] =
    useState<CustomerTag[]>(initialTags);
  const [search, setSearch] =
    useState("");
  const [modalMode, setModalMode] =
    useState<"create" | "edit" | null>(
      null,
    );
  const [selectedTag, setSelectedTag] =
    useState<CustomerTag | null>(null);
  const [form, setForm] =
    useState<TagFormValue>(
      emptyForm(initialTags.length + 1),
    );
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  const filteredTags = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return tags;
    }

    return tags.filter((tag) =>
      `${tag.name} ${tag.description ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [search, tags]);

  function openCreate() {
    const nextIndex =
      tags.reduce(
        (largest, tag) =>
          Math.max(
            largest,
            tag.sort_index,
          ),
        0,
      ) + 1;

    setSelectedTag(null);
    setForm(emptyForm(nextIndex));
    setError(null);
    setModalMode("create");
  }

  function openEdit(tag: CustomerTag) {
    setSelectedTag(tag);
    setForm(formFromTag(tag));
    setError(null);
    setModalMode("edit");
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setModalMode(null);
    setSelectedTag(null);
    setError(null);
  }

  async function submitForm() {
    setSaving(true);
    setError(null);

    try {
      const isEditing =
        modalMode === "edit" &&
        selectedTag;

      const response = await fetch(
        isEditing
          ? `/api/tags/${selectedTag.id}`
          : "/api/tags",
        {
          method: isEditing
            ? "PATCH"
            : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(isEditing
              ? {}
              : { businessId }),
            name: form.name,
            color: form.color,
            sortIndex: form.sortIndex,
            description: form.description,
            isActive: form.isActive,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.tag
      ) {
        throw new Error(
          result.error ??
            "Unable to save tag.",
        );
      }

      if (isEditing) {
        setTags((current) =>
          current.map((tag) =>
            tag.id === result.tag?.id
              ? (result.tag as CustomerTag)
              : tag,
          ),
        );
      } else {
        setTags((current) => [
          ...current,
          result.tag as CustomerTag,
        ]);
      }

      closeModal();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save tag.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(
    tag: CustomerTag,
  ) {
    try {
      const response = await fetch(
        `/api/tags/${tag.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            isActive: !tag.is_active,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (
        !response.ok ||
        !result.success ||
        !result.tag
      ) {
        throw new Error(
          result.error ??
            "Unable to update tag.",
        );
      }

      setTags((current) =>
        current.map((item) =>
          item.id === tag.id
            ? (result.tag as CustomerTag)
            : item,
        ),
      );
    } catch (toggleError) {
      window.alert(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update tag.",
      );
    }
  }

  async function deleteTag(
    tag: CustomerTag,
  ) {
    const confirmed = window.confirm(
      `Delete "${tag.name}"? This removes it from every customer.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `/api/tags/${tag.id}`,
        {
          method: "DELETE",
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to delete tag.",
        );
      }

      setTags((current) =>
        current.filter(
          (item) => item.id !== tag.id,
        ),
      );
    } catch (deleteError) {
      window.alert(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete tag.",
      );
    }
  }

  const sortedTags = [...filteredTags].sort(
    (a, b) => {
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }

      return (
        a.sort_index - b.sort_index ||
        a.name.localeCompare(b.name)
      );
    },
  );

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search tags..."
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:max-w-sm"
          />

          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-700"
          >
            + New tag
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
                  Tag
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Description
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
              {sortedTags.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-12 text-center text-sm text-slate-500"
                  >
                    No tags found.
                  </td>
                </tr>
              ) : (
                sortedTags.map((tag) => (
                  <tr
                    key={tag.id}
                    className={
                      tag.is_active
                        ? ""
                        : "bg-slate-50 opacity-70"
                    }
                  >
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {tag.sort_index}
                    </td>

                    <td className="px-5 py-4">
                      <span
                        className="inline-flex max-w-48 items-center truncate rounded-md border px-3 py-1.5 text-sm font-semibold shadow-sm"
                        style={{
                          color: tag.color,
                          borderColor: `${tag.color}33`,
                          backgroundColor: `${tag.color}14`,
                        }}
                        title={tag.name}
                      >
                        {tag.name}
                      </span>
                    </td>

                    <td className="max-w-md px-5 py-4 text-sm text-slate-600">
                      {tag.description ??
                        "No description"}
                    </td>

                    <td className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() =>
                          void toggleActive(tag)
                        }
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          tag.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {tag.is_active
                          ? "Active"
                          : "Disabled"}
                      </button>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            openEdit(tag)
                          }
                          className="text-sm font-medium text-blue-700 hover:underline"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            void deleteTag(tag)
                          }
                          className="text-sm font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode ? (
        <TagFormModal
          mode={modalMode}
          value={form}
          saving={saving}
          error={error}
          onChange={setForm}
          onClose={closeModal}
          onSubmit={() => void submitForm()}
        />
      ) : null}
    </>
  );
}
