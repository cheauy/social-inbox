"use client";

import type {
  SavedReplyAttachment,
  SavedReplyCategory,
} from "@/types/inbox";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SavedReply } from "@/types/inbox";

type Props = {
  businessId: string;
  onSelect: (
    message: string,
    attachments: SavedReplyAttachment[],
  ) => void;
};

type Response = {
  success?: boolean;
  error?: string;
  savedReplies?: SavedReply[];
};

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H1.8V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V1.8h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8c.12.4.33.75.6 1 .3.27.7.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.6Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/*
 * What was loaded last time, kept for the life of the tab.
 *
 * The picker used to refetch its replies and categories on every open, with
 * no-store on both, so each click cost two round trips before anything could be
 * shown -- and agents open it constantly. The list barely changes during a
 * shift, so the cached copy is shown at once and a refresh runs behind it: the
 * panel is usable immediately and still correct a moment later.
 *
 * Module scope rather than state because the component unmounts with the
 * conversation; the cache has to outlive it to be worth having.
 */
type SavedReplyCache = {
  replies: SavedReply[];
  categories: SavedReplyCategory[];
  loadedAt: number;
};

const savedReplyCache = new Map<
  string,
  SavedReplyCache
>();

/* Long enough to make repeated opens instant, short enough that an edit shows up. */
const SAVED_REPLY_CACHE_TTL_MS = 60_000;

export function SavedReplySelector({
  businessId,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const [
    managedCategories,
    setManagedCategories,
  ] = useState<SavedReplyCategory[]>(
    () =>
      savedReplyCache.get(businessId)
        ?.categories ?? [],
  );
  const [visibleCount, setVisibleCount] = useState(20);
  const [replies, setReplies] = useState<SavedReply[]>(
    () =>
      savedReplyCache.get(businessId)
        ?.replies ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popupRootRef = useRef<HTMLDivElement>(null);

  function closePopup() {
    setOpen(false);
    setSearch("");
    setCategory("all");
    setVisibleCount(20);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (
        target &&
        popupRootRef.current &&
        !popupRootRef.current.contains(target)
      ) {
        closePopup();
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
    if (!open) {
      return;
    }

    let cancelled = false;

    const cached =
      savedReplyCache.get(businessId);
    const isFresh =
      cached &&
      Date.now() - cached.loadedAt <
        SAVED_REPLY_CACHE_TTL_MS;

    async function load() {
      /*
       * Only show the spinner when there is nothing to show. With a cached
       * copy on screen, a refresh behind it is invisible -- which is the point.
       */
      if (!cached) {
        setLoading(true);
      }

      setError(null);

      try {
        const [repliesResponse, categoriesResponse] =
          await Promise.all([
            fetch(
              `/api/saved-replies?businessId=${encodeURIComponent(
                businessId,
              )}&activeOnly=true`,
              { cache: "no-store" },
            ),
            fetch(
              "/api/saved-reply-categories",
              { cache: "no-store" },
            ),
          ]);

        const result =
          (await repliesResponse.json()) as Response;

        if (!repliesResponse.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to load quick replies.",
          );
        }

        const nextReplies =
          result.savedReplies ?? [];

        const categoriesResult =
          (await categoriesResponse
            .json()
            .catch(() => null)) as {
            success?: boolean;
            categories?: SavedReplyCategory[];
          } | null;

        /*
         * Categories only decide the order of a filter, so a failure there
         * falls back to alphabetical rather than failing the whole panel.
         */
        const nextCategories =
          categoriesResult?.success &&
          Array.isArray(
            categoriesResult.categories,
          )
            ? categoriesResult.categories
            : cached?.categories ?? [];

        savedReplyCache.set(businessId, {
          replies: nextReplies,
          categories: nextCategories,
          loadedAt: Date.now(),
        });

        if (!cancelled) {
          setReplies(nextReplies);
          setManagedCategories(
            nextCategories,
          );
        }
      } catch (loadError) {
        /*
         * A stale list beats an error screen: the agent came here to send a
         * reply, and last minute's copy almost certainly still does that.
         */
        if (!cancelled && !cached) {
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

    if (cached) {
      setReplies(cached.replies);
      setManagedCategories(
        cached.categories,
      );
    }

    if (isFresh) {
      return () => {
        cancelled = true;
      };
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, businessId]);

  /*
   * The order the Owner arranged in Settings, not the alphabet.
   *
   * Arranging categories is only worth doing if agents see the arrangement, and
   * this picker is where they see it. Only categories that actually have a
   * reply are listed -- an empty one is useful in Settings, where it is being
   * set up, and noise here, where it is being used.
   *
   * A name still on a reply but no longer a category of its own is kept at the
   * end rather than dropped: those replies exist, and a filter that cannot
   * reach them would look broken.
   */
  const categories = useMemo(() => {
    const inUse = new Map<string, string>();

    for (const reply of replies) {
      const name = (reply.category ?? "").trim();

      if (name) {
        inUse.set(name.toLowerCase(), name);
      }
    }

    const ordered: string[] = [];

    for (const category of managedCategories) {
      const key = category.name
        .trim()
        .toLowerCase();

      if (inUse.has(key)) {
        ordered.push(category.name);
        inUse.delete(key);
      }
    }

    return [
      ...ordered,
      ...Array.from(inUse.values()).sort(
        (first, second) =>
          first.localeCompare(second),
      ),
    ];
  }, [managedCategories, replies]);

  const filteredReplies = useMemo(() => {
    const query = search.trim().toLowerCase();

    return replies.filter((reply) => {
      const replyCategory = (reply.category ?? "").trim();

      if (category !== "all" && replyCategory !== category) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        reply.title,
        reply.shortcut ?? "",
        reply.message_text,
        replyCategory,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [replies, search, category]);

  const visibleReplies = useMemo(
    () => filteredReplies.slice(0, visibleCount),
    [filteredReplies, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(20);
  }, [search, category, open]);

  function selectReply(reply: SavedReply) {
    onSelect(
      reply.message_text,
      reply.attachments ?? [],
    );
    closePopup();
  }

  return (
    <div ref={popupRootRef} className="relative">
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
          <path d="M7 8h10M7 12h7M7 16h4" strokeLinecap="round" />
          <path
            d="M5 21l1.5-3A8 8 0 1 1 20 12a8 8 0 0 1-11.6 7.1L5 21Z"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute bottom-12 left-0 z-50 w-[540px] max-w-[calc(100vw-28px)] overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.20)]">
          <div className="border-b border-slate-200 px-5 pb-4 pt-5">
            <p className="text-xl font-bold tracking-tight text-slate-950">
              Quick replies
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Insert a prepared response
            </p>
          </div>

          <div className="border-b border-slate-200 p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3 max-[520px]:grid-cols-1">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>
                <input
                  autoFocus
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Search replies..."
                  className="h-12 w-full rounded-2xl border border-slate-300 pl-12 pr-4 text-[15px] outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <select
                value={category}
                onChange={(event) =>
                  setCategory(event.target.value)
                }
                className="h-12 min-w-0 rounded-2xl border border-slate-300 bg-white px-4 text-[15px] font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                aria-label="Quick reply category"
              >
                <option value="all">All categories</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="max-h-[410px] overflow-y-auto overscroll-contain p-3">
            {loading ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Loading...
              </p>
            ) : filteredReplies.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                No quick replies found.
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {visibleReplies.map((reply, index) => (
                  <button
                    key={reply.id}
                    type="button"
                    onClick={() => selectReply(reply)}
                    className="group grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition last:border-b-0 hover:bg-blue-50/70 focus:bg-blue-50 focus:outline-none"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm font-semibold tabular-nums text-slate-500 group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-700">
                      {index + 1}
                    </span>

                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-slate-900">
                        {reply.message_text}
                      </span>
                      <span className="mt-1 block truncate text-sm text-slate-500">
                        {reply.title?.trim() || "Untitled reply"}
                      </span>
                    </span>

                  </button>
                ))}
              </div>
            )}

            {!loading &&
            visibleReplies.length < filteredReplies.length ? (
              <div className="pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setVisibleCount((count) => count + 20)
                  }
                  className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
                >
                  Show 20 more · {filteredReplies.length - visibleReplies.length} remaining
                </button>
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-600">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 text-xs text-slate-500">
            <GearIcon />
            <span>
              Manage quick replies in Settings → Quick replies.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
