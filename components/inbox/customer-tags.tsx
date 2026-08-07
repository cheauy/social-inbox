"use client";

import { useEffect, useMemo, useState } from "react";

import { TagBadge } from "@/components/inbox/tag-badge";
import type {
  CustomerTag,
  TagColor,
} from "@/types/inbox";

type CustomerTagsProps = {
  contactId: string;
  businessId: string;
  conversationId: string;
  initialTags: CustomerTag[];
};

type TagResponse = {
  success?: boolean;
  error?: string;
  tags?: CustomerTag[];
  tag?: CustomerTag;
};

const colors: Array<{
  value: TagColor;
  label: string;
}> = [
  { value: "slate", label: "Slate" },
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "emerald", label: "Emerald" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "pink", label: "Pink" },
];

export function CustomerTags({
  contactId,
  businessId,
  initialTags,
   conversationId,
}: CustomerTagsProps) {
  const [allTags, setAllTags] =
    useState<CustomerTag[]>([]);
  const [assignedTags, setAssignedTags] =
    useState<CustomerTag[]>(initialTags);
  const [selectedTagId, setSelectedTagId] =
    useState("");
  const [showCreate, setShowCreate] =
    useState(false);
  const [newName, setNewName] =
    useState("");
  const [newColor, setNewColor] =
    useState<TagColor>("slate");
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    setAssignedTags(initialTags);
  }, [contactId, initialTags]);

  useEffect(() => {
    let cancelled = false;

    async function loadTags() {
      try {
        const response = await fetch(
          `/api/tags?businessId=${encodeURIComponent(
            businessId,
          )}`,
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as TagResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to load tags.",
          );
        }

        if (!cancelled) {
          setAllTags(result.tags ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load tags.",
          );
        }
      }
    }

    void loadTags();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const unassignedTags = useMemo(() => {
    const assignedIds = new Set(
      assignedTags.map((tag) => tag.id),
    );

    return allTags.filter(
      (tag) => !assignedIds.has(tag.id),
    );
  }, [allTags, assignedTags]);

  async function assignTag() {
    if (!selectedTagId) {
      return;
    }

    const tag = allTags.find(
      (item) => item.id === selectedTagId,
    );

    if (!tag) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/contacts/${contactId}/tags`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tagId: tag.id,
             conversationId,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to assign tag.",
        );
      }

      setAssignedTags((current) => [
        ...current,
        tag,
      ]);
      setSelectedTagId("");
    } catch (assignError) {
      setError(
        assignError instanceof Error
          ? assignError.message
          : "Unable to assign tag.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeFromCustomer(
    tag: CustomerTag,
  ) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/contacts/${contactId}/tags`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tagId: tag.id,
             conversationId,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to remove customer tag.",
        );
      }

      setAssignedTags((current) =>
        current.filter(
          (item) => item.id !== tag.id,
        ),
      );
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove customer tag.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createTag() {
    const name = newName.trim();

    if (!name) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/tags",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            businessId,
            name,
            color: newColor,
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
          result.error ?? "Unable to create tag.",
        );
      }

      setAllTags((current) => [
        ...current,
        result.tag as CustomerTag,
      ]);
      setNewName("");
      setNewColor("slate");
      setShowCreate(false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create tag.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag(
    tag: CustomerTag,
  ) {
    const confirmed = window.confirm(
      `Delete "${tag.name}" completely? It will be removed from every customer.`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

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
          result.error ?? "Unable to delete tag.",
        );
      }

      setAllTags((current) =>
        current.filter(
          (item) => item.id !== tag.id,
        ),
      );

      setAssignedTags((current) =>
        current.filter(
          (item) => item.id !== tag.id,
        ),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete tag.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t border-slate-200 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Customer tags
          </p>

          <p className="mt-1 text-xs text-slate-500">
            Default tags can also be deleted.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setShowCreate((current) => !current)
          }
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          {showCreate ? "Cancel" : "New tag"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {assignedTags.length === 0 ? (
          <p className="text-sm text-slate-500">
            No tags assigned.
          </p>
        ) : (
          assignedTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              removable
              onRemove={() =>
                void removeFromCustomer(tag)
              }
            />
          ))
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <select
          value={selectedTagId}
          onChange={(event) =>
            setSelectedTagId(event.target.value)
          }
          disabled={busy}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">
            Select a tag
          </option>

          {unassignedTags.map((tag) => (
            <option
              key={tag.id}
              value={tag.id}
            >
              {tag.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void assignTag()}
          disabled={busy || !selectedTagId}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
        >
          Add
        </button>
      </div>

      {showCreate ? (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input
            value={newName}
            onChange={(event) =>
              setNewName(event.target.value)
            }
            maxLength={50}
            placeholder="Custom tag name"
            disabled={busy}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <select
            value={newColor}
            onChange={(event) =>
              setNewColor(
                event.target.value as TagColor,
              )
            }
            disabled={busy}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {colors.map((color) => (
              <option
                key={color.value}
                value={color.value}
              >
                {color.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void createTag()}
            disabled={busy || !newName.trim()}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
          >
            Create custom tag
          </button>
        </div>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          Manage all tags
        </summary>

        <div className="mt-3 space-y-2">
          {allTags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2"
            >
              <TagBadge tag={tag} />

              <button
                type="button"
                onClick={() =>
                  void deleteTag(tag)
                }
                disabled={busy}
                className="text-xs font-medium text-red-600 hover:underline disabled:text-slate-400"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </details>

      {error ? (
        <p className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
