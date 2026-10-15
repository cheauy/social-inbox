"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

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
      className={`max-w-full break-words rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}
    >
      {label} {value}
    </span>
  );
}

type ConnectionPage = {
  scope: string;
  query: string;
  items: ReleaseTarget[];
  hasMore: boolean;
  nextOffset: number | null;
};

const normalizeSearch = (value: string) => value.trim().normalize("NFC").toLowerCase();
const connectionKey = (item: ReleaseTarget) => `${item.kind}:${item.connection.connectionId}`;
function matchesSearch(item: ReleaseTarget, query: string) {
  const connection = item.connection;
  return [connection.accountName, connection.businessName,
    item.kind === "telegram" ? item.connection.botId : item.connection.pageId]
    .some(value => value && normalizeSearch(value).includes(query)) ||
    (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(query) &&
      [connection.connectionId, connection.businessId].some(value => value.toLowerCase() === query)) ||
    (item.kind === "telegram" && Boolean(item.connection.botUsername &&
      normalizeSearch(item.connection.botUsername).replace(/^@/, "").includes(query.replace(/^@/, ""))));
}

export function AdminConnections() {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const t = (en: string, km: string) => isKhmer ? km : en;
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [showReleased, setShowReleased] = useState(false);
  const [page, setPage] = useState<ConnectionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<ReleaseTarget | null>(null);
  const [confirmId, setConfirmId] = useState("");
  const [releasing, setReleasing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const basePageRef = useRef<ConnectionPage | null>(null);
  const pageRef = useRef<ConnectionPage | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const search = normalizeSearch(query);
  const searchIsToken = looksLikeBotToken(query);
  const scope = `${platform}:${showReleased}`;

  const loadPage = useCallback(async (
    offset: number, signal: AbortSignal, sequence: number, nextScope: string,
    nextQuery: string, nextPlatform: PlatformFilter, includeReleased: boolean,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ paged: "true", limit: "50", offset: String(offset) });
      if (nextQuery) params.set("query", nextQuery);
      if (nextPlatform !== "all") params.set("platform", nextPlatform);
      if (includeReleased) params.set("includeReleased", "true");
      const response = await fetch(`/api/tenh-admin/connections?${params}`, { cache: "no-store", signal });
      const result = await response.json() as {
        success?: boolean; error?: string; items?: ReleaseTarget[]; hasMore?: boolean; nextOffset?: number | null;
      };
      if (signal.aborted || sequence !== sequenceRef.current) return;
      if (!response.ok || !result.success || !Array.isArray(result.items)) {
        if (response.status === 401 || response.status === 403) {
          basePageRef.current = null;
          pageRef.current = null;
          setPage(null);
          setConfirmTarget(null);
        }
        throw new Error(result.error || "Unable to load connections.");
      }
      const previous = pageRef.current;
      const items = offset > 0 && previous?.scope === nextScope && previous.query === nextQuery
        ? [...new Map([...previous.items, ...result.items].map(item => [connectionKey(item), item])).values()]
        : result.items;
      const nextPage = { scope: nextScope, query: nextQuery, items, hasMore: result.hasMore === true,
        nextOffset: result.nextOffset ?? null };
      pageRef.current = nextPage;
      if (!nextQuery) basePageRef.current = nextPage;
      setPage(nextPage);
    } catch (reason) {
      if (!signal.aborted && sequence === sequenceRef.current) {
        setError(reason instanceof Error ? reason.message : "Unable to load connections.");
      }
    } finally {
      if (!signal.aborted && sequence === sequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const cached = basePageRef.current;
    const useCached = cached && ((cached.scope === scope && (!search || !cached.hasMore)) ||
      (cached.scope === `all:${showReleased}` && !cached.hasMore));
    const timer = window.setTimeout(() => {
      if (searchIsToken) {
        setLoading(false);
      } else if (useCached) {
        const nextPage = { ...cached, scope };
        pageRef.current = nextPage;
        setPage(nextPage);
        setError(null);
        setLoading(false);
      } else {
        void loadPage(0, controller.signal, sequence, scope, search, platform, showReleased);
      }
    }, search && !useCached ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [scope, search, searchIsToken, platform, showReleased, revision, loadPage]);

  useEffect(() => {
    if (confirmTarget) return;
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey ||
          (target instanceof HTMLElement && (target.isContentEditable || target.closest("input,textarea,select,[role=dialog]")))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [confirmTarget]);

  const refresh = () => { basePageRef.current = null; setRevision(value => value + 1); };

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
      refresh();
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

  const useLocalSearch = !searchIsToken && page?.scope === scope && page.query === "" && !page.hasMore;
  const pageMatches = page?.scope === scope && (page.query === search || useLocalSearch);
  const visibleItems = pageMatches ? page.items.filter(item =>
    (platform === "all" || item.kind === platform) && (!search || !useLocalSearch || matchesSearch(item, search))) : [];
  const pending = loading || (!pageMatches && !error && !searchIsToken);

  return (
    <div className="space-y-4" data-channel-connections>
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">
            {t("Channel connections", "ការតភ្ជាប់ឆានែល")}
          </h2>
          <button type="button" data-refresh-connections onClick={refresh} disabled={pending}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50">
            <span aria-hidden="true">↻</span>{t("Refresh", "ផ្ទុកឡើងវិញ")}
          </button>
        </div>

        <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row">
          <form role="search" onSubmit={event => event.preventDefault()} className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-slate-400" aria-hidden="true">⌕</span>
            <input ref={searchRef} type="search" value={query}
              onChange={event => { setQuery(event.target.value); setError(null); }}
              onKeyDown={event => { if (event.key === "Escape") { setQuery(""); setError(null); } }}
              placeholder={t("Search page or bot…", "ស្វែងរក Page ឬ Bot…")}
              aria-label={t("Search page or bot", "ស្វែងរក Page ឬ Bot")}
              autoComplete="off" spellCheck={false}
              className="h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white pl-10 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query ? (
              <button type="button" onClick={() => { setQuery(""); setError(null); searchRef.current?.focus(); }}
                aria-label={t("Clear search", "សម្អាតការស្វែងរក")}
                className="absolute inset-y-0 right-2 flex items-center rounded-lg px-2 text-sm font-semibold text-slate-400 transition hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-500">×</button>
            ) : (
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center" aria-hidden="true">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">/</kbd>
              </span>
            )}
          </form>
          <select value={platform} aria-label={t("Channel", "ឆានែល")}
            onChange={event => { setPlatform(event.target.value as PlatformFilter); setError(null); }}
            className="h-10 max-w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100">
            <option value="all">{t("All channels", "ឆានែលទាំងអស់")}</option>
            <option value="telegram">Telegram</option>
            <option value="messenger">Messenger</option>
          </select>
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showReleased}
            onChange={event => { setShowReleased(event.target.checked); setError(null); }}
            className="h-4 w-4 rounded border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500" />
          {t("Show released", "បង្ហាញការតភ្ជាប់ដែលបានលែង")}
        </label>

        {searchIsToken ? <p role="alert" className="mt-3 text-sm text-red-700">{t("Enter a name or ID, not a token.", "បញ្ចូលឈ្មោះ ឬលេខសម្គាល់ មិនមែន Token ទេ។")}</p> : null}
        {error ? (
          <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{error}</p>
            <button type="button" onClick={refresh} className="rounded px-2 py-1 font-semibold underline focus-visible:outline-2 focus-visible:outline-red-600">{t("Retry", "ព្យាយាមម្ដងទៀត")}</button>
          </div>
        ) : null}
        {notice ? <p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}

        <div role="list" aria-label={t("Connected Pages and Bots", "Page និង Bot ដែលបានភ្ជាប់")} aria-busy={pending} className="mt-4 space-y-2">
          {visibleItems.map(item => {
            const connection = item.connection;
            const bot = item.kind === "telegram";
            return (
              <article key={connectionKey(item)} role="listitem" data-connection-id={connection.connectionId}
                className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex min-w-0 flex-wrap items-start gap-2 sm:flex-nowrap">
                  <Image unoptimized src={bot ? "/images/channels/telegram.png" : "/images/channels/messenger.png"}
                    alt={bot ? "Telegram" : "Messenger"} width={20} height={20} className="mt-0.5 h-5 w-5 shrink-0 rounded" />
                  <div className="min-w-0 flex-1 basis-[160px]">
                    <h3 className="break-words text-sm font-semibold text-slate-900">
                      {connection.accountName || (bot ? item.connection.botUsername : null) || (bot ? "Telegram Bot" : "Facebook Page")}
                      {bot && item.connection.botUsername ? <span className="ml-1 break-all text-xs font-normal text-slate-500">(@{item.connection.botUsername.replace(/^@/, "")})</span> : null}
                    </h3>
                    <p className="mt-0.5 break-words text-xs text-slate-500">{connection.businessName}</p>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-400">
                      {bot ? item.connection.botId : item.connection.pageId}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <StatusChip label="Token" value={connection.tokenStatus ?? "none"}
                        tone={connection.tokenStatus === (bot ? "verified" : "valid") ? "good" : "neutral"} />
                      {bot ? <StatusChip label="Webhook" value={item.connection.webhookStatus ?? "none"}
                        tone={item.connection.webhookStatus === "active" ? "good" : "neutral"} /> : null}
                      <StatusChip label={t("Active", "សកម្ម")} value={connection.isActive ? t("yes", "បាទ") : t("no", "ទេ")}
                        tone={connection.isActive ? "good" : "neutral"} />
                    </div>
                    {!bot && item.connection.tokenError ? <p className="mt-2 break-words text-xs text-red-600">{item.connection.tokenError}</p> : null}
                  </div>
                  {connection.blocksReconnect ? (
                    <button type="button" data-release-connection
                      onClick={() => { setConfirmTarget(item); setConfirmId(""); setError(null); setNotice(null); }}
                      className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500">
                      {bot ? t("Release Bot", "លែង Bot") : t("Release Page", "លែង Page")}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        {pending ? <p role="status" className="mt-3 text-sm text-slate-500">{t("Loading…", "កំពុងផ្ទុក…")}</p> :
          !error && !searchIsToken && visibleItems.length === 0 ? <p role="status" className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">{search ? t("No results", "គ្មានលទ្ធផល") : t("No connections", "គ្មានការតភ្ជាប់")}</p> : null}
        {pageMatches && page.hasMore && page.nextOffset !== null ? (
          <button type="button" data-load-more disabled={pending}
            onClick={() => {
              const controller = controllerRef.current;
              if (controller && !controller.signal.aborted) void loadPage(page.nextOffset!, controller.signal, sequenceRef.current, scope, search, platform, showReleased);
            }}
            className="mt-4 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50">
            {t("Load more", "ផ្ទុកបន្ថែម")}
          </button>
        ) : null}
      </section>

      {confirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="release-connection-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
            <h3 id="release-connection-title" className="text-base font-bold text-slate-900">
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
