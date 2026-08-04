"use client";

import { useEffect, useMemo, useState } from "react";

import type { CustomerTag } from "@/types/inbox";

type QuickTagBarProps = {
  contactId: string;
  businessId: string;
  initialAssignedTags?: CustomerTag[];
};

type TagResponse = {
  success?: boolean;
  error?: string;
  tags?: CustomerTag[];
};

function getReadableTextColor(hexColor: string) {
  const normalized = hexColor.replace("#", "");

  if (!/^[0-9A-F]{6}$/i.test(normalized)) {
    return "#FFFFFF";
  }

  const red = Number.parseInt(
    normalized.slice(0, 2),
    16,
  );
  const green = Number.parseInt(
    normalized.slice(2, 4),
    16,
  );
  const blue = Number.parseInt(
    normalized.slice(4, 6),
    16,
  );

  const luminance =
    (0.299 * red +
      0.587 * green +
      0.114 * blue) /
    255;

  return luminance > 0.65
    ? "#0F172A"
    : "#FFFFFF";
}

export function QuickTagBar({
  contactId,
  businessId,
  initialAssignedTags = [],
}: QuickTagBarProps) {
  const [allTags, setAllTags] =
    useState<CustomerTag[]>([]);

  const [assignedIds, setAssignedIds] =
  useState<Set<string>>(
    new Set(
      (initialAssignedTags ?? []).map(
        (tag) => tag.id,
      ),
    ),
  );

  const [busyTagId, setBusyTagId] =
    useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
  setAssignedIds(
    new Set(
      (initialAssignedTags ?? []).map(
        (tag) => tag.id,
      ),
    ),
  );
}, [contactId, initialAssignedTags]);

  useEffect(() => {
    let cancelled = false;

    async function loadActiveTags() {
      setError(null);

      try {
        const response = await fetch(
          `/api/tags?businessId=${encodeURIComponent(
            businessId,
          )}&activeOnly=true`,
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as TagResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ??
              "Unable to load quick tags.",
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
              : "Unable to load quick tags.",
          );
        }
      }
    }

    void loadActiveTags();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const sortedTags = useMemo(
    () =>
      [...allTags].sort(
        (first, second) =>
          first.sort_index -
            second.sort_index ||
          first.name.localeCompare(
            second.name,
          ),
      ),
    [allTags],
  );

  async function toggleTag(tag: CustomerTag) {
    if (busyTagId) {
      return;
    }

    const isAssigned = assignedIds.has(tag.id);

    setBusyTagId(tag.id);
    setError(null);

    setAssignedIds((current) => {
      const next = new Set(current);

      if (isAssigned) {
        next.delete(tag.id);
      } else {
        next.add(tag.id);
      }

      return next;
    });

    try {
      const response = await fetch(
        `/api/contacts/${contactId}/tags`,
        {
          method: isAssigned
            ? "DELETE"
            : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tagId: tag.id,
          }),
        },
      );

      const result =
        (await response.json()) as TagResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to update customer tag.",
        );
      }
    } catch (toggleError) {
      setAssignedIds((current) => {
        const next = new Set(current);

        if (isAssigned) {
          next.add(tag.id);
        } else {
          next.delete(tag.id);
        }

        return next;
      });

      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update customer tag.",
      );
    } finally {
      setBusyTagId(null);
    }
  }

  if (sortedTags.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-slate-200 bg-white px-4 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Quick tags
        </p>

        <a
          href="/dashboard/settings/tags"
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          Manage tags
        </a>
      </div>

      <div className="mt-2 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 p-1">
        {sortedTags.map((tag) => {
          const isAssigned =
            assignedIds.has(tag.id);
          const isBusy =
            busyTagId === tag.id;

          return (
            <button
              key={tag.id}
              type="button"
              onClick={() =>
                void toggleTag(tag)
              }
              disabled={Boolean(busyTagId)}
              className={`min-w-[110px] shrink-0 rounded-md px-3 py-2 text-xs font-semibold transition ${
                isAssigned
                  ? "opacity-100"
                  : "opacity-55 grayscale-[25%] hover:opacity-80"
              } disabled:cursor-wait`}
              style={{
                backgroundColor: tag.color,
                color: getReadableTextColor(
                  tag.color,
                ),
                boxShadow: isAssigned
                  ? "inset 0 -3px 0 rgba(15,23,42,0.25)"
                  : "none",
              }}
              title={
                isAssigned
                  ? `Remove ${tag.name}`
                  : `Assign ${tag.name}`
              }
            >
              <span className="inline-flex items-center gap-1">
                {isAssigned ? (
                  <span aria-hidden="true">
                    ✓
                  </span>
                ) : null}

                <span>{tag.name}</span>

                {isBusy ? (
                  <span aria-hidden="true">
                    …
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
