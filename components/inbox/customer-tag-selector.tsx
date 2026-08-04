"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { CustomerTag } from "@/types/inbox";

type CustomerTagSelectorProps = {
  contactId: string;
  businessId: string;
  initialTags: CustomerTag[];
};

type TagsResponse = {
  success?: boolean;
  error?: string;
  tags?: CustomerTag[];
};

function getTextColor(background: string) {
  const hex = background.replace("#", "");

  if (!/^[0-9A-F]{6}$/i.test(hex)) {
    return "#FFFFFF";
  }

  const red = Number.parseInt(
    hex.slice(0, 2),
    16,
  );

  const green = Number.parseInt(
    hex.slice(2, 4),
    16,
  );

  const blue = Number.parseInt(
    hex.slice(4, 6),
    16,
  );

  const brightness =
    (red * 299 +
      green * 587 +
      blue * 114) /
    1000;

  return brightness > 165
    ? "#0F172A"
    : "#FFFFFF";
}

function TagIcon() {
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
        d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="9"
        cy="9"
        r="1.3"
      />
    </svg>
  );
}

export function CustomerTagSelector({
  contactId,
  businessId,
  initialTags,
}: CustomerTagSelectorProps) {
  const [open, setOpen] =
    useState(false);

  const [allTags, setAllTags] =
    useState<CustomerTag[]>([]);

  const [assignedIds, setAssignedIds] =
    useState<Set<string>>(
      new Set(
        (initialTags ?? []).map(
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
        (initialTags ?? []).map(
          (tag) => tag.id,
        ),
      ),
    );
  }, [contactId, initialTags]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadTags() {
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
          (await response.json()) as TagsResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ??
              "Unable to load tags.",
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
  }, [open, businessId]);

  async function toggleTag(
    tag: CustomerTag,
  ) {
    if (busyTagId) {
      return;
    }

    const assigned =
      assignedIds.has(tag.id);

    setBusyTagId(tag.id);
    setError(null);

    setAssignedIds((current) => {
      const next = new Set(current);

      if (assigned) {
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
          method: assigned
            ? "DELETE"
            : "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            tagId: tag.id,
          }),
        },
      );

      const result =
        (await response.json()) as TagsResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to update tag.",
        );
      }
    } catch (toggleError) {
      setAssignedIds((current) => {
        const next = new Set(current);

        if (assigned) {
          next.add(tag.id);
        } else {
          next.delete(tag.id);
        }

        return next;
      });

      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to update tag.",
      );
    } finally {
      setBusyTagId(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen((current) => !current)
        }
        className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
          open
            ? "border-blue-500 bg-blue-50 text-blue-700"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        }`}
        aria-label="Select customer tags"
        aria-expanded={open}
      >
        <TagIcon />

        {assignedIds.size > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
            {assignedIds.size}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
         <button
  type="button"
  onClick={() => setOpen(false)}
  className="fixed inset-0 z-40 cursor-default bg-slate-950/10"
  aria-label="Close tags"
/>
          <div className="fixed bottom-28 left-[55%] z-50 w-[340px] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">
                  Quick tags
                </p>

                <p className="text-xs text-slate-500">
                  Select tags for this customer
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
                className="rounded-lg px-2 py-1 text-lg text-slate-500 hover:bg-slate-100"
              >
                ×
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto p-3">
              {allTags.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  No active tags found.
                </p>
              ) : (
                <div className="space-y-2">
                  {allTags.map((tag) => {
                    const assigned =
                      assignedIds.has(tag.id);

                    const busy =
                      busyTagId === tag.id;

                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          void toggleTag(tag)
                        }
                        disabled={Boolean(
                          busyTagId,
                        )}
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 transition ${
  assigned
    ? "border-blue-300 bg-blue-50"
    : "border-slate-200 bg-white hover:bg-slate-50"
}`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                         <span
  className="h-3.5 w-3.5 rounded-full ring-2 ring-white shadow"
  style={{
    backgroundColor: tag.color,
  }}
/>

                          <span className="truncate text-sm font-medium text-slate-800">
                            {tag.name}
                          </span>
                        </div>

                       {assigned ? (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    className="h-5 w-5 text-emerald-600"
  >
    <path
      d="M5 13l4 4L19 7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
) : (
  <div className="h-5 w-5" />
)}
                      </button>
                    );
                  })}
                </div>
              )}

              {error ? (
                <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-600">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <Link
                href="/dashboard/settings/tags"
                className="flex w-full items-center justify-center rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                Go to add new tag
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}