"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type CustomerResult = {
  id: string;
  fullName: string;
  profilePictureUrl:
    | string
    | null;
  phone:
    | string
    | null;
  email:
    | string
    | null;
  companyName:
    | string
    | null;
  platformUserId: string;
  lastContactAt:
    | string
    | null;
  latestConversationId:
    | string
    | null;
  latestConversationStatus:
    | string
    | null;
};

type MessageResult = {
  id: string;
  conversationId: string;
  contactId:
    | string
    | null;
  customerName: string;
  profilePictureUrl:
    | string
    | null;
  direction:
    | "incoming"
    | "outgoing"
    | string;
  messageType: string;
  messageText:
    | string
    | null;
  messageAt: string;
  status: string;
  sourceType:
    | string
    | null;
};

type NoteResult = {
  id: string;
  contactId: string;
  customerName: string;
  profilePictureUrl:
    | string
    | null;
  noteText: string;
  authorName:
    | string
    | null;
  createdAt: string;
  latestConversationId:
    | string
    | null;
};

type TeamMessageResult = {
  id: string;
  roomId: string;
  roomName: string;
  senderMemberId: string;
  senderName: string;
  messageText: string;
  createdAt: string;
};

type SearchResults = {
  customers:
    CustomerResult[];
  messages:
    MessageResult[];
  notes:
    NoteResult[];
  teamMessages:
    TeamMessageResult[];
};

type SearchResponse = {
  success?: boolean;
  error?: string;
  results?:
    Partial<SearchResults>;
};

const EMPTY_RESULTS:
  SearchResults = {
    customers: [],
    messages: [],
    notes: [],
    teamMessages: [],
  };

function SearchIcon({
  className =
    "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        className
      }
      aria-hidden="true"
    >
      <circle
        cx="11"
        cy="11"
        r="7"
      />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function getInitial(
  name: string,
) {
  return (
    name
      .trim()
      .charAt(0)
      .toUpperCase() ||
    "C"
  );
}

function ResultAvatar({
  name,
  src,
}: {
  name: string;
  src:
    | string
    | null;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
      {getInitial(name)}
    </span>
  );
}

function truncateText(
  value:
    | string
    | null,
  limit = 110,
) {
  const normalized =
    value
      ?.replace(
        /\s+/g,
        " ",
      )
      .trim() ??
    "";

  if (
    normalized.length <=
    limit
  ) {
    return normalized;
  }

  return `${normalized.slice(
    0,
    limit,
  )}…`;
}

function formatWhen(
  value:
    | string
    | null,
) {
  if (!value) {
    return "";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

function ResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children:
    React.ReactNode;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <section>
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
          {title}
        </h3>

        <span className="text-[11px] font-semibold text-slate-400">
          {count}
        </span>
      </div>

      <div className="px-2">
        {children}
      </div>
    </section>
  );
}

export function GlobalSearchCommand() {
  const [open, setOpen] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const [
    results,
    setResults,
  ] =
    useState<SearchResults>(
      EMPTY_RESULTS,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(false);

  const [error, setError] =
    useState<
      string | null
    >(null);

  const inputRef =
    useRef<HTMLInputElement | null>(
      null,
    );

  const requestIdRef =
    useRef(0);

  const totalResults =
    useMemo(
      () =>
        results.customers
          .length +
        results.messages
          .length +
        results.notes.length +
        results.teamMessages
          .length,
      [results],
    );

  const closeSearch =
    useCallback(() => {
      setOpen(false);
      setQuery("");
      setResults(
        EMPTY_RESULTS,
      );
      setError(null);
      setLoading(false);
    }, []);

  useEffect(() => {
    function onKeyDown(
      event:
        KeyboardEvent,
    ) {
      const isShortcut =
        (event.metaKey ||
          event.ctrlKey) &&
        event.key.toLowerCase() ===
          "k";

      if (isShortcut) {
        event.preventDefault();

        setOpen(
          (current) =>
            !current,
        );

        return;
      }

      if (
        event.key ===
          "Escape" &&
        open
      ) {
        event.preventDefault();
        closeSearch();
      }
    }

    window.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [
    open,
    closeSearch,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          inputRef.current?.focus();
        },
        30,
      );

    return () => {
      window.clearTimeout(
        timer,
      );
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const trimmed =
      query.trim();

    if (
      trimmed.length < 2
    ) {
      requestIdRef.current +=
        1;

      setResults(
        EMPTY_RESULTS,
      );
      setLoading(false);
      setError(null);
      return;
    }

    const requestId =
      requestIdRef.current +
      1;

    requestIdRef.current =
      requestId;

    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        async () => {
          setLoading(true);
          setError(null);

          try {
            const params =
              new URLSearchParams({
                q: trimmed,
                limit: "6",
              });

            const response =
              await fetch(
                `/api/search?${params.toString()}`,
                {
                  cache:
                    "no-store",
                  signal:
                    controller.signal,
                },
              );

            const data =
              (await response.json()) as
                SearchResponse;

            if (
              !response.ok ||
              !data.success
            ) {
              throw new Error(
                data.error ??
                  "Unable to search.",
              );
            }

            if (
              requestId !==
              requestIdRef.current
            ) {
              return;
            }

            setResults({
              customers:
                data.results
                  ?.customers ??
                [],
              messages:
                data.results
                  ?.messages ??
                [],
              notes:
                data.results
                  ?.notes ??
                [],
              teamMessages:
                data.results
                  ?.teamMessages ??
                [],
            });
          } catch (
            searchError
          ) {
            if (
              searchError instanceof
                DOMException &&
              searchError.name ===
                "AbortError"
            ) {
              return;
            }

            if (
              requestId !==
              requestIdRef.current
            ) {
              return;
            }

            setError(
              searchError instanceof
                Error
                ? searchError.message
                : "Unable to search.",
            );

            setResults(
              EMPTY_RESULTS,
            );
          } finally {
            if (
              requestId ===
              requestIdRef.current
            ) {
              setLoading(false);
            }
          }
        },
        250,
      );

    return () => {
      window.clearTimeout(
        timer,
      );

      controller.abort();
    };
  }, [
    open,
    query,
  ]);

  function resultHrefForCustomer(
    customer:
      CustomerResult,
  ) {
    if (
      customer.latestConversationId
    ) {
      return `/dashboard/inbox?conversation=${encodeURIComponent(
        customer.latestConversationId,
      )}`;
    }

    return "/dashboard/customers";
  }

  function resultHrefForNote(
    note: NoteResult,
  ) {
    if (
      note.latestConversationId
    ) {
      return `/dashboard/inbox?conversation=${encodeURIComponent(
        note.latestConversationId,
      )}`;
    }

    return "/dashboard/customers";
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setOpen(true)
        }
        className="mr-1 flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
        aria-label="Search workspace"
        title="Search workspace (Ctrl+K)"
      >
        <SearchIcon className="h-4.5 w-4.5" />

        <span className="hidden text-sm font-medium xl:inline">
          Search
        </span>

        <span className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 2xl:inline">
          Ctrl K
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[160] flex items-start justify-center px-4 pt-[9vh]">
          <button
            type="button"
            onClick={
              closeSearch
            }
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
            aria-label="Close global search"
          />

          <section className="relative z-10 flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-200 px-4">
              <SearchIcon className="h-5 w-5 shrink-0 text-slate-400" />

              <input
                ref={inputRef}
                value={query}
                onChange={(
                  event,
                ) =>
                  setQuery(
                    event.target.value,
                  )
                }
                placeholder="Search customers, messages, notes, or team chat..."
                className="h-16 min-w-0 flex-1 bg-transparent text-base text-slate-950 outline-none placeholder:text-slate-400"
                maxLength={200}
                autoComplete="off"
              />

              {loading ? (
                <span className="text-xs font-semibold text-blue-600">
                  Searching…
                </span>
              ) : null}

              <button
                type="button"
                onClick={
                  closeSearch
                }
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-3">
              {query.trim()
                .length <
              2 ? (
                <div className="px-6 py-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <SearchIcon />
                  </div>

                  <p className="mt-4 font-semibold text-slate-800">
                    Search your workspace
                  </p>

                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    Type at least 2 characters to find customers, customer messages, internal notes, and Group Chat messages.
                  </p>
                </div>
              ) : error ? (
                <div className="px-6 py-10 text-center">
                  <p className="font-semibold text-red-700">
                    Search unavailable
                  </p>

                  <p className="mt-1 text-sm text-red-600">
                    {error}
                  </p>
                </div>
              ) : !loading &&
                totalResults ===
                  0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="font-semibold text-slate-800">
                    No results found
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Try another customer name, phone number, message, note, or team-chat phrase.
                  </p>
                </div>
              ) : (
                <>
                  <ResultSection
                    title="Customers"
                    count={
                      results
                        .customers
                        .length
                    }
                  >
                    {results.customers.map(
                      (
                        customer,
                      ) => (
                        <Link
                          key={
                            customer.id
                          }
                          href={resultHrefForCustomer(
                            customer,
                          )}
                          onClick={
                            closeSearch
                          }
                          className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50"
                        >
                          <ResultAvatar
                            name={
                              customer.fullName
                            }
                            src={
                              customer.profilePictureUrl
                            }
                          />

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-950">
                              {
                                customer.fullName
                              }
                            </span>

                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                              {[
                                customer.phone,
                                customer.email,
                                customer.companyName,
                              ]
                                .filter(
                                  Boolean,
                                )
                                .join(
                                  " · ",
                                ) ||
                                `Facebook ID: ${customer.platformUserId}`}
                            </span>
                          </span>

                          {customer.latestConversationStatus ? (
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold capitalize text-slate-500">
                              {
                                customer.latestConversationStatus
                              }
                            </span>
                          ) : null}
                        </Link>
                      ),
                    )}
                  </ResultSection>

                  <ResultSection
                    title="Messages"
                    count={
                      results
                        .messages
                        .length
                    }
                  >
                    {results.messages.map(
                      (
                        message,
                      ) => (
                        <Link
                          key={
                            message.id
                          }
                          href={`/dashboard/inbox?conversation=${encodeURIComponent(
                            message.conversationId,
                          )}`}
                          onClick={
                            closeSearch
                          }
                          className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50"
                        >
                          <ResultAvatar
                            name={
                              message.customerName
                            }
                            src={
                              message.profilePictureUrl
                            }
                          />

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-950">
                                {
                                  message.customerName
                                }
                              </span>

                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                  message.direction ===
                                  "incoming"
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-emerald-50 text-emerald-700"
                                }`}
                              >
                                {message.direction ===
                                "incoming"
                                  ? "Customer"
                                  : "Team"}
                              </span>
                            </span>

                            <span className="mt-1 block text-xs leading-5 text-slate-600">
                              {truncateText(
                                message.messageText,
                              )}
                            </span>
                          </span>

                          <span className="shrink-0 pt-0.5 text-[10px] text-slate-400">
                            {formatWhen(
                              message.messageAt,
                            )}
                          </span>
                        </Link>
                      ),
                    )}
                  </ResultSection>

                  <ResultSection
                    title="Internal notes"
                    count={
                      results.notes
                        .length
                    }
                  >
                    {results.notes.map(
                      (note) => (
                        <Link
                          key={
                            note.id
                          }
                          href={resultHrefForNote(
                            note,
                          )}
                          onClick={
                            closeSearch
                          }
                          className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50"
                        >
                          <ResultAvatar
                            name={
                              note.customerName
                            }
                            src={
                              note.profilePictureUrl
                            }
                          />

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-950">
                              {
                                note.customerName
                              }
                            </span>

                            <span className="mt-1 block text-xs leading-5 text-slate-600">
                              {truncateText(
                                note.noteText,
                              )}
                            </span>

                            <span className="mt-1 block text-[10px] text-slate-400">
                              {note.authorName
                                ? `By ${note.authorName}`
                                : "Internal note"}
                            </span>
                          </span>

                          <span className="shrink-0 pt-0.5 text-[10px] text-slate-400">
                            {formatWhen(
                              note.createdAt,
                            )}
                          </span>
                        </Link>
                      ),
                    )}
                  </ResultSection>

                  <ResultSection
                    title="Group chat"
                    count={
                      results
                        .teamMessages
                        .length
                    }
                  >
                    {results.teamMessages.map(
                      (
                        message,
                      ) => (
                        <Link
                          key={
                            message.id
                          }
                          href={`/dashboard/group-chat?room=${encodeURIComponent(
                            message.roomId,
                          )}`}
                          onClick={
                            closeSearch
                          }
                          className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-bold text-violet-700">
                            #
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-slate-950">
                                #
                                {
                                  message.roomName
                                }
                              </span>

                              <span className="truncate text-[10px] text-slate-400">
                                {
                                  message.senderName
                                }
                              </span>
                            </span>

                            <span className="mt-1 block text-xs leading-5 text-slate-600">
                              {truncateText(
                                message.messageText,
                              )}
                            </span>
                          </span>

                          <span className="shrink-0 pt-0.5 text-[10px] text-slate-400">
                            {formatWhen(
                              message.createdAt,
                            )}
                          </span>
                        </Link>
                      ),
                    )}
                  </ResultSection>
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] text-slate-400">
              <span>
                Search is scoped to your Tenh Chat workspace.
              </span>

              <span className="font-semibold">
                ESC to close
              </span>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
