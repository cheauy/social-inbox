"use client";

import { useEffect, useState } from "react";

type TelegramConnection = {
  connectionId: string;
  businessId: string;
  businessName: string;
  accountName: string | null;
  botId: string | null;
  botUsername: string | null;
  isActive: boolean;
  tokenStatus: string | null;
  webhookStatus: string | null;
  webhookUrl: string | null;
  webhookRegisteredAt: string | null;
  connectedAt: string | null;
  createdAt: string | null;
  hasStoredToken: boolean;
  blocksReconnect: boolean;
};

type MessengerConnection = {
  connectionId: string;
  businessId: string;
  businessName: string;
  accountName: string | null;
  pageId: string | null;
  isActive: boolean;
  tokenStatus: string | null;
  tokenError: string | null;
  createdAt: string | null;
  blocksReconnect: boolean;
};

type ReleaseTarget =
  | {
      kind: "telegram";
      connection: TelegramConnection;
    }
  | {
      kind: "messenger";
      connection: MessengerConnection;
    };

type PlatformFilter =
  | "all"
  | "telegram"
  | "messenger";

/*
 * A Bot token is "<bot id>:<secret>", so the ID support asks for is literally
 * the first half of the credential. An Owner told to "send the Bot ID" can
 * easily paste the whole token instead, which would put a live credential into
 * a request body and every log that touches it. Catch that in the field, before
 * anything is sent.
 */
function looksLikeBotToken(value: string) {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(
    value.trim(),
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString()
    : "—";
}

function StatusChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "bad"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-600";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}
    >
      {label} {value}
    </span>
  );
}

export function AdminConnections() {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] =
    useState<PlatformFilter>("all");
  const [loading, setLoading] =
    useState(false);
  const [telegram, setTelegram] = useState<
    TelegramConnection[]
  >([]);
  const [messenger, setMessenger] = useState<
    MessengerConnection[]
  >([]);
  const [error, setError] = useState<
    string | null
  >(null);
  const [notice, setNotice] = useState<
    string | null
  >(null);

  /*
   * Released connections stay in the database -- every conversation joins its
   * social_accounts row for the channel it belongs to, so deleting one would
   * strip old threads of their identity, or take them with it. They are hidden
   * here instead, because the reason to open this tab is a claim that needs
   * breaking, not a record of ones already broken.
   */
  const [showReleased, setShowReleased] =
    useState(false);

  const [confirmTarget, setConfirmTarget] =
    useState<ReleaseTarget | null>(null);
  const [confirmId, setConfirmId] =
    useState("");
  const [releasing, setReleasing] =
    useState(false);

  async function load(
    nextQuery = query,
    nextPlatform = platform,
  ) {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (nextQuery.trim()) {
        params.set(
          "query",
          nextQuery.trim(),
        );
      }

      if (nextPlatform !== "all") {
        params.set("platform", nextPlatform);
      }

      const response = await fetch(
        `/api/tenh-admin/connections?${params.toString()}`,
        { cache: "no-store" },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        telegram?: TelegramConnection[];
        messenger?: MessengerConnection[];
      };

      if (!response.ok || !result.success) {
        setTelegram([]);
        setMessenger([]);
        setError(
          result.error ??
            "Unable to load channel connections.",
        );
        return;
      }

      setTelegram(result.telegram ?? []);
      setMessenger(result.messenger ?? []);
    } catch {
      setTelegram([]);
      setMessenger([]);
      setError(
        "Unable to reach TENH while loading connections.",
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * Load the full inventory once when the tab opens; every later load is
   * user-driven. `load` is recreated each render, so it stays out of the
   * dependency list on purpose -- including it would refetch on every render.
   */
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    void load("", "all");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function confirmRelease() {
    if (!confirmTarget) {
      return;
    }

    setReleasing(true);
    setError(null);

    const isTelegram =
      confirmTarget.kind === "telegram";

    try {
      const response = await fetch(
        "/api/tenh-admin/connections",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json",
          },
          body: JSON.stringify({
            connectionId:
              confirmTarget.connection
                .connectionId,
            ...(isTelegram
              ? {
                  confirmBotId:
                    confirmId.trim(),
                }
              : {
                  confirmPageId:
                    confirmId.trim(),
                }),
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        message?: string;
        webhookNote?: string | null;
      };

      if (!response.ok || !result.success) {
        setError(
          result.error ??
            "Unable to release this connection.",
        );
        return;
      }

      setNotice(
        [result.message, result.webhookNote]
          .filter(Boolean)
          .join(" "),
      );

      setConfirmTarget(null);
      setConfirmId("");
      void load();
    } catch {
      setError(
        "Unable to reach TENH while releasing the connection.",
      );
    } finally {
      setReleasing(false);
    }
  }

  const targetId =
    confirmTarget?.kind === "telegram"
      ? confirmTarget.connection.botId
      : (confirmTarget?.connection.pageId ??
        null);
  const targetName =
    confirmTarget?.kind === "telegram"
      ? (confirmTarget.connection
          .accountName ??
        confirmTarget.connection
          .botUsername ??
        "this Bot")
      : (confirmTarget?.connection
          .accountName ?? "this Page");

  const showTelegram =
    platform !== "messenger";
  const showMessenger =
    platform !== "telegram";

  const visibleTelegram = showReleased
    ? telegram
    : telegram.filter(
        (connection) =>
          connection.blocksReconnect,
      );
  const visibleMessenger = showReleased
    ? messenger
    : messenger.filter(
        (connection) =>
          connection.blocksReconnect,
      );

  const releasedCount =
    telegram.length -
    telegram.filter(
      (connection) =>
        connection.blocksReconnect,
    ).length +
    (messenger.length -
      messenger.filter(
        (connection) =>
          connection.blocksReconnect,
      ).length);

  return (
    <div className="space-y-4">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-bold text-slate-900">
          Channel connections
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
          Every Messenger Page and Telegram Bot
          across all workspaces — connected or
          not. Run diagnostics only lists what is
          currently active, so a connection
          causing trouble is often missing there
          but visible here.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
          className="mt-4 flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Bot ID, Page ID, @username, or channel name — blank shows everything"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
          />

          <select
            value={platform}
            onChange={(event) => {
              const next = event.target
                .value as PlatformFilter;
              setPlatform(next);
              void load(query, next);
            }}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-blue-500 focus:bg-white"
          >
            <option value="all">
              All channels
            </option>
            <option value="telegram">
              Telegram
            </option>
            <option value="messenger">
              Messenger
            </option>
          </select>

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Loading..."
              : "Search"}
          </button>
        </form>

        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        {releasedCount > 0 || showReleased ? (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showReleased}
              onChange={(event) =>
                setShowReleased(
                  event.target.checked,
                )
              }
              className="h-4 w-4 rounded border-slate-300"
            />
            Show {releasedCount} already
            released{" "}
            <span className="text-slate-400">
              — kept so their old conversations
              keep their channel
            </span>
          </label>
        ) : null}
      </section>

      {showTelegram ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-400">
            Telegram · {visibleTelegram.length}
          </h3>

          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
            A Bot can be claimed by only one
            workspace. Release frees the claim so
            an Owner who has moved to a new
            subscription can connect the same Bot
            again. It clears the token, the
            webhook and the claim — it does{" "}
            <span className="font-semibold text-slate-700">
              not
            </span>{" "}
            delete the connection or its
            conversation history, which stays
            with the old workspace. Only Bots
            still holding a claim show a Release
            button.
          </p>

          {visibleTelegram.length === 0 ? (
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              {loading
                ? "Loading..."
                : showReleased
                  ? "No Telegram connection matches."
                  : "No Telegram Bot is holding a claim."}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {visibleTelegram.map((connection) => (
                <div
                  key={
                    connection.connectionId
                  }
                  className={`rounded-2xl border p-3 ${
                    connection.blocksReconnect
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        {connection.accountName ??
                          connection.botUsername ??
                          "Telegram Bot"}
                        {connection.botUsername ? (
                          <span className="ml-1 text-xs font-normal text-slate-400">
                            (@
                            {
                              connection.botUsername
                            }
                            )
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {
                          connection.businessName
                        }
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">
                        bot{" "}
                        {connection.botId ??
                          "unknown"}
                      </p>
                    </div>

                    {connection.blocksReconnect ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmTarget({
                            kind: "telegram",
                            connection,
                          });
                          setConfirmId("");
                          setError(null);
                          setNotice(null);
                        }}
                        className="shrink-0 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Release Bot
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <StatusChip
                      label="token"
                      value={
                        connection.tokenStatus ??
                        "none"
                      }
                      tone={
                        connection.tokenStatus ===
                        "verified"
                          ? "good"
                          : "neutral"
                      }
                    />
                    <StatusChip
                      label="webhook"
                      value={
                        connection.webhookStatus ??
                        "none"
                      }
                      tone={
                        connection.webhookStatus ===
                        "active"
                          ? "good"
                          : "neutral"
                      }
                    />
                    <StatusChip
                      label="active"
                      value={
                        connection.isActive
                          ? "yes"
                          : "no"
                      }
                      tone={
                        connection.isActive
                          ? "good"
                          : "neutral"
                      }
                    />
                    <StatusChip
                      label="connected"
                      value={formatDate(
                        connection.connectedAt,
                      )}
                    />
                  </div>

                  {connection.webhookUrl ? (
                    <p className="mt-2 truncate font-mono text-xs text-slate-400">
                      {connection.webhookUrl}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {showMessenger ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-400">
            Messenger · {visibleMessenger.length}
          </h3>

          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
            A Page works the same way, except a
            Page keeps its claim until it is
            deliberately disconnected — being
            deactivated is not enough. Release
            clears the tokens and gives the claim
            up, leaving the connection and its
            history with the old workspace.
          </p>

          {visibleMessenger.length === 0 ? (
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              {loading
                ? "Loading..."
                : showReleased
                  ? "No Messenger Page matches."
                  : "No Messenger Page is holding a claim."}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {visibleMessenger.map((connection) => (
                <div
                  key={
                    connection.connectionId
                  }
                  className={`rounded-2xl border p-3 ${
                    connection.blocksReconnect
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        {connection.accountName ??
                          "Facebook Page"}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {
                          connection.businessName
                        }
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">
                        page{" "}
                        {connection.pageId ??
                          "unknown"}
                      </p>
                    </div>

                    {connection.blocksReconnect ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmTarget({
                            kind: "messenger",
                            connection,
                          });
                          setConfirmId("");
                          setError(null);
                          setNotice(null);
                        }}
                        className="shrink-0 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        Release Page
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <StatusChip
                      label="token"
                      value={
                        connection.tokenStatus ??
                        "none"
                      }
                      tone={
                        connection.tokenStatus ===
                        "valid"
                          ? "good"
                          : "neutral"
                      }
                    />
                    <StatusChip
                      label="active"
                      value={
                        connection.isActive
                          ? "yes"
                          : "no"
                      }
                      tone={
                        connection.isActive
                          ? "good"
                          : "neutral"
                      }
                    />
                    <StatusChip
                      label="added"
                      value={formatDate(
                        connection.createdAt,
                      )}
                    />
                  </div>

                  {connection.tokenError ? (
                    <p className="mt-2 text-xs text-red-600">
                      Stored error:{" "}
                      {connection.tokenError}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {confirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              {confirmTarget.kind === "telegram"
                ? "Release this Bot?"
                : "Release this Page?"}
            </h3>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              <span className="font-semibold text-slate-900">
                {
                  confirmTarget.connection
                    .businessName
                }
              </span>{" "}
              will stop receiving and sending
              messages on{" "}
              <span className="font-semibold text-slate-900">
                {targetName}
              </span>{" "}
              immediately. Their past
              conversations stay readable.
            </p>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
              {confirmTarget.kind === "telegram"
                ? "Type the Bot ID to confirm"
                : "Type the Page ID to confirm"}
              <input
                value={confirmId}
                onChange={(event) =>
                  setConfirmId(
                    event.target.value,
                  )
                }
                autoComplete="off"
                spellCheck={false}
                placeholder={targetId ?? ""}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
              />
            </label>

            {confirmTarget.kind === "telegram" &&
            looksLikeBotToken(confirmId) ? (
              <p className="mt-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                That is a full Bot token, not a
                Bot ID. Nothing was sent. Enter
                only the number before the colon
                — and because the token has now
                been through a support channel,
                ask the Owner to revoke it in
                BotFather with{" "}
                <span className="font-mono font-semibold">
                  /revoke
                </span>{" "}
                and connect with the new one.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500">
                Read it back from the
                Owner&apos;s request rather than
                copying it off this screen — that
                is what makes this a check. Never
                ask for a token; TENH already
                holds it.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={releasing}
                onClick={() => {
                  setConfirmTarget(null);
                  setConfirmId("");
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  releasing ||
                  (confirmTarget.kind ===
                    "telegram" &&
                    looksLikeBotToken(
                      confirmId,
                    )) ||
                  confirmId.trim() !==
                    (targetId ?? "")
                }
                onClick={() =>
                  void confirmRelease()
                }
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {releasing
                  ? "Releasing..."
                  : confirmTarget.kind ===
                      "telegram"
                    ? "Release Bot"
                    : "Release Page"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
