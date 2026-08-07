"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type CustomerTag = {
  id: string;
  business_id?: string;
  name: string;
  color: string;
  description?: string | null;
  is_active?: boolean;
};

type CustomerTagsManagerProps = {
  contactId: string;
  conversationId: string;
  businessId: string;
  initialTags: CustomerTag[];

  onTagsChange?: (
    tags: CustomerTag[],
  ) => void;
};

type TagsResponse = {
  success?: boolean;
  error?: string;
  tags?: CustomerTag[];
};

type TagMutationResponse = {
  success?: boolean;
  error?: string;
  tags?: CustomerTag[];
  tag?: CustomerTag;
  activityRecorded?: boolean;
};

function getReadableTextColor(
  backgroundColor: string,
) {
  const normalized =
    backgroundColor.replace("#", "");

  if (normalized.length !== 6) {
    return "#0F172A";
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

  const brightness =
    (red * 299 +
      green * 587 +
      blue * 114) /
    1000;

  return brightness > 155
    ? "#0F172A"
    : "#FFFFFF";
}

export function CustomerTagsManager({
 contactId,
  conversationId,
  businessId,
  initialTags,
  onTagsChange,
}: CustomerTagsManagerProps) {
  const [open, setOpen] =
    useState(false);

  const [search, setSearch] =
    useState("");

  const [
    availableTags,
    setAvailableTags,
  ] = useState<CustomerTag[]>([]);

  const [
    selectedTags,
    setSelectedTags,
  ] = useState<CustomerTag[]>(
    initialTags,
  );

  const [loading, setLoading] =
    useState(false);

  const [
    updatingTagId,
    setUpdatingTagId,
  ] = useState<string | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    setSelectedTags(initialTags);
  }, [initialTags]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function loadTags() {
      setLoading(true);
      setError(null);

      try {
        /*
         * Reuse your existing Settings tags API.
         * If your existing route is named differently,
         * change only this URL.
         */
      const params =
  new URLSearchParams({
    businessId,
    activeOnly: "true",
  });

const response = await fetch(
  `/api/tags?${params.toString()}`,
  {
    cache: "no-store",
  },
);

        const text =
          await response.text();

        const result =
          text.trim()
            ? (JSON.parse(
                text,
              ) as TagsResponse)
            : null;

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ??
              "Unable to load tags.",
          );
        }

        if (!cancelled) {
          setAvailableTags(
            result.tags ?? [],
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load tags.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTags();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedTagIds =
    useMemo(
      () =>
        new Set(
          selectedTags.map(
            (tag) => tag.id,
          ),
        ),
      [selectedTags],
    );

  const filteredTags =
    useMemo(() => {
      const normalizedSearch =
        search.trim().toLowerCase();

      if (!normalizedSearch) {
        return availableTags;
      }

      return availableTags.filter(
        (tag) =>
          tag.name
            .toLowerCase()
            .includes(
              normalizedSearch,
            ) ||
          tag.description
            ?.toLowerCase()
            .includes(
              normalizedSearch,
            ),
      );
    }, [
      availableTags,
      search,
    ]);

  function updateSelectedTags(
    nextTags: CustomerTag[],
  ) {
    setSelectedTags(nextTags);
    onTagsChange?.(nextTags);
  }

  async function addTag(
    tag: CustomerTag,
  ) {
    if (
      updatingTagId ||
      selectedTagIds.has(tag.id)
    ) {
      return;
    }

    setUpdatingTagId(tag.id);
    setError(null);

    try {
      /*
       * Reuse the same endpoint used by your
       * Inbox Quick Tag component.
       */
      const response = await fetch(
        `/api/contacts/${encodeURIComponent(
          contactId,
        )}/tags`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            tagId: tag.id,
            conversationId,
          }),
        },
      );

      const text =
        await response.text();

      const result =
        text.trim()
          ? (JSON.parse(
              text,
            ) as TagMutationResponse)
          : null;

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            "Unable to add tag.",
        );
      }

      const nextTags =
        result.tags ??
        [
          ...selectedTags,
          result.tag ?? tag,
        ];

      updateSelectedTags(nextTags);
    } catch (addError) {
      setError(
        addError instanceof Error
          ? addError.message
          : "Unable to add tag.",
      );
    } finally {
      setUpdatingTagId(null);
    }
  }

  async function removeTag(
    tag: CustomerTag,
  ) {
    if (updatingTagId) {
      return;
    }

    setUpdatingTagId(tag.id);
    setError(null);

    try {
      const params =
        new URLSearchParams({
          conversationId,
        });

      /*
       * Reuse the same DELETE endpoint used by
       * your Inbox Quick Tag component.
       */
      const response = await fetch(
        `/api/contacts/${encodeURIComponent(
          contactId,
        )}/tags/${encodeURIComponent(
          tag.id,
        )}?${params.toString()}`,
        {
          method: "DELETE",
        },
      );

      const text =
        await response.text();

      const result =
        text.trim()
          ? (JSON.parse(
              text,
            ) as TagMutationResponse)
          : null;

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            "Unable to remove tag.",
        );
      }

      const nextTags =
        result.tags ??
        selectedTags.filter(
          (selectedTag) =>
            selectedTag.id !==
            tag.id,
        );

      updateSelectedTags(nextTags);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove tag.",
      );
    } finally {
      setUpdatingTagId(null);
    }
  }

  

  async function toggleTag(
    tag: CustomerTag,
  ) {
    if (
      selectedTagIds.has(tag.id)
    ) {
      await removeTag(tag);
      return;
    }

    await addTag(tag);
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        {selectedTags.length > 0 ? (
          selectedTags.map(
            (tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{
                  backgroundColor:
                    `${tag.color}18`,
                  borderColor:
                    `${tag.color}55`,
                  color: tag.color,
                }}
              >
                {tag.name}

                <button
                  type="button"
                  onClick={() =>
                    void removeTag(tag)
                  }
                  disabled={
                    updatingTagId ===
                    tag.id
                  }
                  className="flex h-4 w-4 items-center justify-center rounded-full transition hover:bg-black/10 disabled:cursor-wait disabled:opacity-50"
                  aria-label={`Remove ${tag.name}`}
                  title={`Remove ${tag.name}`}
                >
                  {updatingTagId ===
                  tag.id
                    ? "…"
                    : "×"}
                </button>
              </span>
            ),
          )
        ) : (
          <span className="text-sm text-slate-400">
            No tags added
          </span>
        )}

        <button
          type="button"
          onClick={() =>
            setOpen(
              (current) => !current,
            )
          }
          className="inline-flex items-center gap-2 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          <span className="text-base leading-none">
            +
          </span>

          Add tag
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            onClick={() =>
              setOpen(false)
            }
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close tag selector"
          />

          <div className="absolute left-0 top-full z-50 mt-3 w-[360px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-950">
                    Customer tags
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    Add or remove tags for this customer.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setOpen(false)
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="relative mt-4">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="7"
                  />

                  <path
                    d="m20 20-3.5-3.5"
                    strokeLinecap="round"
                  />
                </svg>

                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(
                      event.target.value,
                    )
                  }
                  placeholder="Search tags..."
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                  Loading tags...
                </div>
              ) : filteredTags.length ===
                0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                  No tags found.
                </div>
              ) : (
                filteredTags.map(
                  (tag) => {
                    const selected =
                      selectedTagIds.has(
                        tag.id,
                      );

                    const updating =
                      updatingTagId ===
                      tag.id;

                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          void toggleTag(
                            tag,
                          )
                        }
                        disabled={
                          Boolean(
                            updatingTagId,
                          )
                        }
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          selected
                            ? "bg-emerald-50"
                            : "hover:bg-slate-50"
                        } disabled:cursor-wait disabled:opacity-60`}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                          style={{
                            backgroundColor:
                              tag.color,
                            color:
                              getReadableTextColor(
                                tag.color,
                              ),
                          }}
                        >
                          {tag.name
                            .charAt(0)
                            .toUpperCase()}
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {tag.name}
                          </p>

                          {tag.description ? (
                            <p className="mt-0.5 truncate text-xs text-slate-400">
                              {
                                tag.description
                              }
                            </p>
                          ) : null}
                        </div>

                        {updating ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                        ) : selected ? (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            className="h-5 w-5 text-emerald-600"
                            aria-hidden="true"
                          >
                            <path
                              d="M5 13l4 4L19 7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </button>
                    );
                  },
                )
              )}
            </div>

            {error ? (
              <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
                {error}
              </div>
            ) : null}

            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">
                Create and manage tags from
                Settings → Conversation Tags.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}