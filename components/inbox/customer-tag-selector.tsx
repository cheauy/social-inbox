"use client";

import {
  useEffect,
  useMemo,
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
      className="h-5 w-5"
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
    updatingTagId,
    setUpdatingTagId,
  ] =
    useState<
      string | null
    >(null);

  const [
    error,
    setError,
  ] =
    useState<
      string | null
    >(null);

  useEffect(() => {
    setSelectedTags(
      Array.isArray(
        initialTags,
      )
        ? initialTags
        : [],
    );
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

  function publishTags(
    nextTags:
      CustomerTag[],
  ) {
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
    if (
      updatingTagId ||
      selectedTagIds.has(
        tag.id,
      )
    ) {
      return;
    }

    setUpdatingTagId(
      tag.id,
    );
    setError(null);

    try {
      const response =
        await fetch(
          `/api/contacts/${encodeURIComponent(
            contactId,
          )}/tags`,
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

      const returnedTag =
        result.tag ??
        tag;

      const nextTags =
        selectedTagIds.has(
          returnedTag.id,
        )
          ? selectedTags
          : [
              ...selectedTags,
              returnedTag,
            ];

      publishTags(
        nextTags,
      );
    } catch (
      addError
    ) {
      setError(
        addError instanceof
          Error
          ? addError.message
          : "Unable to add tag.",
      );
    } finally {
      setUpdatingTagId(
        null,
      );
    }
  }

  async function removeTag(
    tag: CustomerTag,
  ) {
    if (
      updatingTagId
    ) {
      return;
    }

    setUpdatingTagId(
      tag.id,
    );
    setError(null);

    try {
      /*
       * IMPORTANT V3.1.1 FIX:
       *
       * Your existing TENH route is:
       *   DELETE /api/contacts/[contactId]/tags
       *
       * and it expects tagId + conversationId in a JSON body.
       * Do NOT call /tags/[tagId].
       */
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

      publishTags(
        selectedTags.filter(
          (
            selectedTag,
          ) =>
            selectedTag.id !==
            tag.id,
        ),
      );
    } catch (
      removeError
    ) {
      setError(
        removeError instanceof
          Error
          ? removeError.message
          : "Unable to remove tag.",
      );
    } finally {
      setUpdatingTagId(
        null,
      );
    }
  }

  async function toggleTag(
    tag: CustomerTag,
  ) {
    if (
      selectedTagIds.has(
        tag.id,
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
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(
            (
              current,
            ) =>
              !current,
          );
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
        aria-expanded={
          open
        }
      >
        <TagIcon />

        {selectedTags.length >
        0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
            {selectedTags.length >
            9
              ? "9+"
              : selectedTags.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() =>
              setOpen(
                false,
              )
            }
            aria-label="Close quick tags"
          />

          <div className="absolute bottom-12 left-0 z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    Quick tags
                  </p>

                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Click a tag to add or remove it.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setOpen(
                      false,
                    )
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="relative mt-3">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
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
                  value={
                    search
                  }
                  onChange={(
                    event,
                  ) =>
                    setSearch(
                      event.target.value,
                    )
                  }
                  placeholder="Search tags..."
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                  (
                    tag,
                  ) => {
                    const selected =
                      selectedTagIds.has(
                        tag.id,
                      );

                    const updating =
                      updatingTagId ===
                      tag.id;

                    return (
                      <button
                        key={
                          tag.id
                        }
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
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              tag.color,
                          }}
                        />

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {
                              tag.name
                            }
                          </p>

                          {tag.description ? (
                            <p className="mt-0.5 truncate text-[11px] text-slate-400">
                              {
                                tag.description
                              }
                            </p>
                          ) : null}
                        </div>

                        {updating ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                        ) : selected ? (
                          <span className="text-emerald-600">
                            <CheckIcon />
                          </span>
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

            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-500">
              Manage tag names and colors in Settings → Conversation Tags.
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
