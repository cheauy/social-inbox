"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type { SavedReply } from "@/types/inbox";

type Props = {
  businessId: string;
  onSelect: (message: string) => void;
};

type Response = {
  success?: boolean;
  error?: string;
  savedReplies?: SavedReply[];
};

export function SavedReplySelector({
  businessId,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState("all");

  const [replies, setReplies] = useState<
    SavedReply[]
  >([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/saved-replies?businessId=${encodeURIComponent(
            businessId,
          )}&activeOnly=true`,
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as Response;

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ??
              "Unable to load quick replies.",
          );
        }

        if (!cancelled) {
          setReplies(
            result.savedReplies ?? [],
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load quick replies.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, businessId]);

  const categories = useMemo(() => {
    const uniqueCategories =
      Array.from(
        new Set(
          replies
            .map(
              (reply) =>
                reply.category?.trim(),
            )
            .filter(
              (
                category,
              ): category is string =>
                Boolean(category),
            ),
        ),
      ).sort((first, second) =>
        first.localeCompare(second),
      );

    return ["all", ...uniqueCategories];
  }, [replies]);

  const filteredReplies = useMemo(() => {
    const query = search
      .trim()
      .toLowerCase();

    return replies.filter((reply) => {
      const matchesSearch =
        !query ||
        [
          reply.title,
          reply.shortcut ?? "",
          reply.message_text,
          reply.category ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);

      const matchesCategory =
        selectedCategory === "all" ||
        reply.category === selectedCategory;

      return (
        matchesSearch &&
        matchesCategory
      );
    });
  }, [
    replies,
    search,
    selectedCategory,
  ]);

  function closePopup() {
    setOpen(false);
    setSearch("");
    setSelectedCategory("all");
  }

  function selectReply(
    reply: SavedReply,
  ) {
    onSelect(reply.message_text);
    closePopup();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen(
            (current) => !current,
          )
        }
        className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
          open
            ? "border-blue-500 bg-blue-50 text-blue-700"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        }`}
        title="Quick replies"
        aria-label="Quick replies"
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            d="M7 8h10M7 12h7M7 16h4"
            strokeLinecap="round"
          />

          <path
            d="M5 21l1.5-3A8 8 0 1 1 20 12a8 8 0 0 1-11.6 7.1L5 21Z"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-slate-950/10"
            onClick={closePopup}
            aria-label="Close saved replies"
          />

          <div className="fixed bottom-28 left-1/2 z-50 w-[390px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">
                  Quick replies
                </p>

                <p className="text-xs text-slate-500">
                  Insert a prepared response
                </p>
              </div>

              <button
                type="button"
                onClick={closePopup}
                className="rounded-lg px-2 py-1 text-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="border-b border-slate-200 p-3">
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(
                    event.target.value,
                  )
                }
                placeholder="Search saved replies..."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {categories.map(
                  (category) => {
                    const isActive =
                      selectedCategory ===
                      category;

                    const count =
                      category === "all"
                        ? replies.length
                        : replies.filter(
                            (reply) =>
                              reply.category ===
                              category,
                          ).length;

                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() =>
                          setSelectedCategory(
                            category,
                          )
                        }
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {category === "all"
                          ? "All"
                          : category}{" "}
                        ({count})
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {loading ? (
                <p className="p-6 text-center text-sm text-slate-500">
                  Loading...
                </p>
              ) : filteredReplies.length ===
                0 ? (
                <p className="p-6 text-center text-sm text-slate-500">
                  No saved replies found.
                </p>
              ) : (
                filteredReplies.map(
                  (reply) => (
                    <button
                      key={reply.id}
                      type="button"
                      onClick={() =>
                        selectReply(reply)
                      }
                      className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {reply.title}
                          </p>

                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                            {
                              reply.message_text
                            }
                          </p>

                          {reply.category ? (
                            <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                              {
                                reply.category
                              }
                            </span>
                          ) : null}
                        </div>

                        {reply.shortcut ? (
                          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600">
                            {
                              reply.shortcut
                            }
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ),
                )
              )}

              {error ? (
                <p className="m-2 rounded-lg bg-red-50 p-3 text-xs text-red-600">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <Link
                href="/dashboard/settings/saved-replies"
                className="flex w-full items-center justify-center rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                Manage quick replies
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}