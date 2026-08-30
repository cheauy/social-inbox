"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  CustomerTag,
} from "@/types/inbox";

type CustomerTagSelectorProps = {
  contactId: string;
  businessId: string;
  conversationId?: string;
  initialTags:
    CustomerTag[];
  onTagsChange?: (
    tags:
      CustomerTag[],
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
  tag?: CustomerTag;
  tags?: CustomerTag[];
};

async function readJsonResponse<T>(
  response: Response,
): Promise<T | null> {
  const text =
    await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(
      text,
    ) as T;
  } catch {
    return null;
  }
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
        r="1.5"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M5 13l4 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getReadableTagTextColor(
  color: string,
) {
  const normalized =
    color.trim();

  const compactHex =
    normalized.match(
      /^#([0-9a-f]{3})$/i,
    );

  const fullHex =
    normalized.match(
      /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i,
    );

  let hex: string | null =
    null;

  if (compactHex) {
    hex = compactHex[1]
      .split("")
      .map(
        (character) =>
          `${character}${character}`,
      )
      .join("");
  } else if (fullHex) {
    hex = fullHex[1];
  }

  if (!hex) {
    return "#ffffff";
  }

  const red = parseInt(
    hex.slice(0, 2),
    16,
  );
  const green = parseInt(
    hex.slice(2, 4),
    16,
  );
  const blue = parseInt(
    hex.slice(4, 6),
    16,
  );

  const brightness =
    (red * 299 +
      green * 587 +
      blue * 114) /
    1000;

  return brightness > 170
    ? "#0f172a"
    : "#ffffff";
}

export function CustomerTagSelector({
  contactId,
  businessId,
  conversationId,
  initialTags,
  onTagsChange,
}: CustomerTagSelectorProps) {
  const [
    open,
    setOpen,
  ] =
    useState(false);

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    availableTags,
    setAvailableTags,
  ] =
    useState<
      CustomerTag[]
    >([]);

  const [
    selectedTags,
    setSelectedTags,
  ] =
    useState<
      CustomerTag[]
    >(
      Array.isArray(
        initialTags,
      )
        ? initialTags
        : [],
    );

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [
    updatingTagIds,
    setUpdatingTagIds,
  ] = useState<Set<string>>(new Set());

  const [
    visibleCount,
    setVisibleCount,
  ] = useState(20);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  const popupRootRef =
    useRef<HTMLDivElement>(null);

  /*
   * Keep the latest selection outside React's render cycle too.
   * This prevents fast double-clicks / multi-tag clicks from using a stale
   * selectedTags closure while the previous request is still in flight.
   */
  const selectedTagsRef =
    useRef<CustomerTag[]>(
      Array.isArray(initialTags)
        ? initialTags
        : [],
    );

  const inflightTagIdsRef =
    useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleOutsidePointerDown(
      event: PointerEvent,
    ) {
      const target =
        event.target as Node | null;

      if (
        target &&
        popupRootRef.current &&
        !popupRootRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch("");
        setError(null);
      }
    }

    document.addEventListener(
      "pointerdown",
      handleOutsidePointerDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDown,
      );
    };
  }, [open]);

  useEffect(() => {
    const nextTags =
      Array.isArray(initialTags)
        ? initialTags
        : [];

    selectedTagsRef.current =
      nextTags;
    setSelectedTags(nextTags);
  }, [
    initialTags,
    contactId,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled =
      false;

    async function loadTags() {
      setLoading(
        true,
      );
      setError(null);

      try {
        const params =
          new URLSearchParams({
            businessId,
            activeOnly:
              "true",
          });

        const response =
          await fetch(
            `/api/tags?${params.toString()}`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await readJsonResponse<
            TagsResponse
          >(
            response,
          );

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
            result.tags ??
              [],
          );
        }
      } catch (
        loadError
      ) {
        if (!cancelled) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load tags.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(
            false,
          );
        }
      }
    }

    void loadTags();

    return () => {
      cancelled =
        true;
    };
  }, [
    open,
    businessId,
  ]);

  const selectedTagIds =
    useMemo(
      () =>
        new Set(
          selectedTags.map(
            (tag) =>
              tag.id,
          ),
        ),
      [selectedTags],
    );

  const filteredTags =
    useMemo(() => {
      const keyword =
        search
          .trim()
          .toLowerCase();

      if (!keyword) {
        return availableTags;
      }

      return availableTags.filter(
        (tag) =>
          tag.name
            .toLowerCase()
            .includes(
              keyword,
            ) ||
          (
            tag.description ??
            ""
          )
            .toLowerCase()
            .includes(
              keyword,
            ),
      );
    }, [
      availableTags,
      search,
    ]);

  const visibleTags = useMemo(
    () => filteredTags.slice(0, visibleCount),
    [filteredTags, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(20);
  }, [search, open]);

  function publishTags(
    nextTags:
      CustomerTag[],
  ) {
    selectedTagsRef.current =
      nextTags;
    setSelectedTags(
      nextTags,
    );

    onTagsChange?.(
      nextTags,
    );

    /*
     * Optional lightweight sync point for other Inbox UI.
     * Existing components can ignore this safely.
     */
    window.dispatchEvent(
      new CustomEvent(
        "tenh-contact-tags-changed",
        {
          detail: {
            contactId,
            tags:
              nextTags,
          },
        },
      ),
    );
  }

  async function addTag(
    tag: CustomerTag,
  ) {
    const currentTags =
      selectedTagsRef.current;

    if (
      inflightTagIdsRef.current.has(tag.id) ||
      currentTags.some(
        (selectedTag) => selectedTag.id === tag.id,
      )
    ) {
      return;
    }

    /*
     * Lock synchronously before the fetch. React state alone is not enough
     * because a second click can happen before the next render.
     */
    inflightTagIdsRef.current.add(tag.id);
    setUpdatingTagIds((current) => {
      const next = new Set(current);
      next.add(tag.id);
      return next;
    });

    /* Optimistic: visible to this browser immediately. */
    publishTags([
      ...currentTags,
      tag,
    ]);
    setError(null);

    try {
      const response =
        await fetch(
          `/api/contacts/${encodeURIComponent(
            contactId,
          )}/tags`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify(
                {
                  tagId:
                    tag.id,
                  conversationId:
                    conversationId ??
                    undefined,
                },
              ),
          },
        );

      const result =
        await readJsonResponse<
          TagMutationResponse
        >(
          response,
        );

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            "Unable to add tag.",
        );
      }

      /*
       * Prefer the authoritative tag returned by the server, but do not
       * replace unrelated tags that may have changed while this request ran.
       */
      if (result.tag) {
        publishTags(
          selectedTagsRef.current.map(
            (selectedTag) =>
              selectedTag.id === tag.id
                ? result.tag as CustomerTag
                : selectedTag,
          ),
        );
      }
    } catch (
      addError
    ) {
      /* Roll back only this tag so concurrent successful changes survive. */
      publishTags(
        selectedTagsRef.current.filter(
          (selectedTag) =>
            selectedTag.id !== tag.id,
        ),
      );

      setError(
        addError instanceof
          Error
          ? addError.message
          : "Unable to add tag.",
      );
    } finally {
      inflightTagIdsRef.current.delete(tag.id);
      setUpdatingTagIds((current) => {
        const next = new Set(current);
        next.delete(tag.id);
        return next;
      });
    }
  }

  async function removeTag(
    tag: CustomerTag,
  ) {
    const currentTags =
      selectedTagsRef.current;

    if (
      inflightTagIdsRef.current.has(tag.id) ||
      !currentTags.some(
        (selectedTag) => selectedTag.id === tag.id,
      )
    ) {
      return;
    }

    inflightTagIdsRef.current.add(tag.id);
    setUpdatingTagIds((current) => {
      const next = new Set(current);
      next.add(tag.id);
      return next;
    });

    /* Optimistic: remove immediately. */
    publishTags(
      currentTags.filter(
        (selectedTag) =>
          selectedTag.id !== tag.id,
      ),
    );
    setError(null);

    try {
      const params =
        new URLSearchParams();

      if (conversationId) {
        params.set(
          "conversationId",
          conversationId,
        );
      }

      const suffix =
        params.toString()
          ? `?${params.toString()}`
          : "";

      const response =
        await fetch(
          `/api/contacts/${encodeURIComponent(
            contactId,
          )}/tags/${encodeURIComponent(
            tag.id,
          )}${suffix}`,
          {
            method:
              "DELETE",
          },
        );

      const result =
        await readJsonResponse<
          TagMutationResponse
        >(
          response,
        );

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.error ??
            "Unable to remove tag.",
        );
      }
    } catch (
      removeError
    ) {
      /* Restore only this tag; never overwrite another concurrent change. */
      if (
        !selectedTagsRef.current.some(
          (selectedTag) => selectedTag.id === tag.id,
        )
      ) {
        publishTags([
          ...selectedTagsRef.current,
          tag,
        ]);
      }

      setError(
        removeError instanceof
          Error
          ? removeError.message
          : "Unable to remove tag.",
      );
    } finally {
      inflightTagIdsRef.current.delete(tag.id);
      setUpdatingTagIds((current) => {
        const next = new Set(current);
        next.delete(tag.id);
        return next;
      });
    }
  }

  async function toggleTag(
    tag: CustomerTag,
  ) {
    if (
      selectedTagsRef.current.some(
        (selectedTag) =>
          selectedTag.id === tag.id,
      )
    ) {
      await removeTag(
        tag,
      );
      return;
    }

    await addTag(
      tag,
    );
  }

  return (
    <div
      ref={popupRootRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setSearch("");
          setError(null);
        }}
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition ${
          open
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        }`}
        aria-label="Quick tags"
        title="Quick tags"
        aria-expanded={open}
      >
        <TagIcon />

        {selectedTags.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
            {selectedTags.length > 9
              ? "9+"
              : selectedTags.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute bottom-12 left-0 z-50 w-[430px] max-w-[calc(100vw-28px)] overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.20)]">
          <div className="border-b border-slate-200 px-5 pb-4 pt-5">
            <p className="text-xl font-bold tracking-tight text-slate-950">
              Quick tags
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Click a tag to add or remove it.
            </p>

            <div className="relative mt-4">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path
                  d="m20 20-3.5-3.5"
                  strokeLinecap="round"
                />
              </svg>

              <input
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search tags..."
                className="h-12 w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-4 text-[15px] outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="max-h-[360px] overflow-y-auto overscroll-contain px-5 py-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                Loading tags...
              </div>
            ) : filteredTags.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No tags found.
              </div>
            ) : (
              <div className="flex flex-wrap gap-x-3 gap-y-4">
                {visibleTags.map((tag) => {
                  const selected =
                    selectedTagIds.has(tag.id);

                  const textColor =
                    getReadableTagTextColor(tag.color);

                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() =>
                        void toggleTag(tag)
                      }
                      disabled={updatingTagIds.has(tag.id)}
                      title={tag.description ?? tag.name}
                      className={`inline-flex min-h-11 max-w-full items-center gap-2 rounded-2xl border px-4 py-2.5 text-[15px] font-semibold transition active:scale-[0.98] ${
                        selected
                          ? "shadow-sm ring-2 ring-white ring-offset-1"
                          : "hover:brightness-95"
                      } disabled:cursor-wait disabled:opacity-70`}
                      style={{
                        backgroundColor: tag.color,
                        borderColor: tag.color,
                        color: textColor,
                      }}
                    >
                      <span className="max-w-[235px] truncate">
                        {tag.name}
                      </span>

                      {selected ? (
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white"
                          style={{ color: tag.color }}
                        >
                          <CheckIcon />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            {!loading &&
            visibleTags.length < filteredTags.length ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((count) => count + 20)
                  }
                  className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
                >
                  Show 20 more · {filteredTags.length - visibleTags.length} remaining
                </button>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 text-xs text-slate-500">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5 shrink-0"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H1.8V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V1.8h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8c.12.4.33.75.6 1 .3.27.7.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.6Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              Manage tag names and colors in Settings → Quick tag.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
