"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxConversation } from "@/types/inbox";
import { beginForegroundLoading } from "@/lib/display/foreground-loading";
import { INBOX_SYNC_EVENT, SYNC_TIMEOUT_MS } from "@/lib/inbox/live-sync";
import { isOlderConversationState } from "@/lib/inbox/live-sync";
import { INBOX_PAGE_CHANGED_EVENT, mergeConversationPage, type ConversationPage, type ConversationPageRequest, type ConversationPagingInitial } from "./conversation-page-contract";

type State = { key: string; countRows: InboxConversation[]; rows: InboxConversation[]; page: ConversationPagingInitial["page"]; loading: boolean; error: string | null; errorKey?: string };
const VIEW_CACHE_MAX = 6, VIEW_CACHE_MAX_ROWS = 90, VIEW_CACHE_TTL_MS = 30_000;
type CachedView = { state: State; at: number; channelId: string | null; workspaceId: string | null };
const requestKey = (request: ConversationPageRequest) => JSON.stringify({ ...request, cursor: null, knownIds: undefined });
const visible = () => document.visibilityState !== "hidden";
const rowScope = (row: InboxConversation) => JSON.stringify([row.business_id, row.social_account?.id]);
const rowVersion = (row: InboxConversation) => JSON.stringify([rowScope(row),row.updated_at,row.last_message_at,row.last_message_text,
  row.unread_count,row.status,row.is_pinned,row.assigned_to,row.contact]);

/** No interval: page reads follow navigation, explicit history loading or coalesced live/resume events. */
export function useConversationPages(initial: ConversationPagingInitial | undefined, request: ConversationPageRequest,
  liveRows: InboxConversation[], onRows?: (rows: InboxConversation[]) => void) {
  const key = requestKey(request);
  const [state, setState] = useState<State | null>(() => initial ? {
    key: requestKey(initial.request), countRows: initial.page.ids.flatMap(id => {
      const row = liveRows.find(row => row.id === id); return row ? [row] : [];
    }), rows: initial.page.ids.flatMap(id => {
      const row = liveRows.find(row => row.id === id); return row ? [row] : [];
    }), page: initial.page, loading: false, error: null,
  } : null);
  const [viewCache, setViewCache] = useState(() => new Map<string, CachedView>(
    state && initial && state.rows.length <= VIEW_CACHE_MAX_ROWS ? [[state.key, { state, at: Date.now(),
      channelId: initial.request.channelId, workspaceId: initial.request.workspaceId }]] : []));
  const viewCacheRef = useRef(viewCache);
  useEffect(() => { viewCacheRef.current = viewCache; }, [viewCache]);
  const stateRef = useRef(state), requestRef = useRef(request), onRowsRef = useRef(onRows);
  const controllerRef = useRef<AbortController | null>(null);
  // The request key the in-flight read belongs to.
  const inFlightKeyRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const requestedKeyRef = useRef(key);
  const dirtyRef = useRef(false);
  const pendingIdsRef = useRef(new Set<string>());
  const recentChangesRef = useRef(new Map<string, number>());
  const catchUpRef = useRef(false);
  const liveRowsRef = useRef(liveRows);
  const versionsRef = useRef(new Map(liveRows.map(row => [row.id,rowVersion(row)])));
  const scopesRef = useRef(new Map(liveRows.map(row => [row.id,rowScope(row)])));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { stateRef.current = state; requestRef.current = request; onRowsRef.current = onRows; liveRowsRef.current = liveRows; });
  useEffect(() => {
    if (!initial) return;
    // Existing bounded live-state recovery can discover messages missed while
    // disconnected. Qualify those rows too, including off-page search/view matches.
    for (const row of liveRows) {
      const previousScope = scopesRef.current.get(row.id), scope = rowScope(row);
      scopesRef.current.set(row.id, scope);
      const scopeChanged = previousScope !== undefined && previousScope !== scope;
      const version = rowVersion(row);
      if (versionsRef.current.get(row.id) !== version || scopeChanged) {
        versionsRef.current.set(row.id,version);
        recentChangesRef.current.delete(row.id);
        recentChangesRef.current.set(row.id, Date.now());
        while (recentChangesRef.current.size > 200) recentChangesRef.current.delete(recentChangesRef.current.keys().next().value!);
        // A move can change counts in its previous scope even when that row
        // was outside a cached page. Its latest scope alone is insufficient.
        window.dispatchEvent(scopeChanged
          ? new CustomEvent(INBOX_PAGE_CHANGED_EVENT)
          : new CustomEvent(INBOX_PAGE_CHANGED_EVENT, { detail: { conversationId: row.id } }));
      }
    }
  }, [initial, liveRows]);

  const read = useCallback(async (body: ConversationPageRequest, signal: AbortSignal, snapshot = false) => {
    const response = await fetch("/api/inbox/conversation-page", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)]), body: JSON.stringify({ ...body, snapshot }),
    });
    const result = await response.json() as { success?: boolean; page?: ConversationPage; error?: string };
    if (!response.ok || !result.success || !result.page || !Array.isArray(result.page.conversations)) throw Object.assign(new Error(result.error ?? "Unable to load conversations. Please retry."), { denied: response.status === 401 || response.status === 403 });
    return result.page;
  }, []);

  const run = useCallback(async (mode: "replace" | "more" | "refresh") => {
    if (!initial || !visible()) { dirtyRef.current = true; return; }
    if (controllerRef.current) { if (mode === "refresh") dirtyRef.current = true; return; }
    const activeRequest = requestRef.current, activeKey = requestKey(activeRequest);
    const cached = viewCacheRef.current.get(activeKey);
    const warm = cached && Date.now() - cached.at <= VIEW_CACHE_TTL_MS ? {
      ...cached.state, rows: cached.state.rows.filter(row => liveRowsRef.current.some(live => live.id === row.id && live.business_id === row.business_id)),
    } : null;
    const current = stateRef.current?.key === activeKey ? stateRef.current : warm;
    if (!current) mode = "replace";
    else if (mode === "replace") mode = "refresh";
    if (mode === "more" && (!current || current.key !== activeKey || !current.page.hasMore)) return;
    const controller = new AbortController(); controllerRef.current = controller; inFlightKeyRef.current = activeKey;
    const generation = ++generationRef.current;
    const finishForeground = mode === "refresh" ? () => {} : beginForegroundLoading();
    if (current) setState({ ...current, loading: true, error: null });
    else setState(previous => previous ? { ...previous, error: null } : null);
    try {
      let rows = mode === "replace" ? [] : current?.rows ?? [];
      const known = [...new Set([
        // A new view needs only its first server-qualified page. Re-entry
        // validates its bounded visited window rather than every loaded view.
        ...(mode === "refresh" && (catchUpRef.current || stateRef.current?.key !== activeKey)
          ? (warm ? warm.rows : liveRowsRef.current).map(row => row.id) : []),
        ...pendingIdsRef.current,
        ...(mode === "replace" ? [...recentChangesRef.current].filter(([,at]) => Date.now() - at <= VIEW_CACHE_TTL_MS).map(([id]) => id) : []),
      ])];
      pendingIdsRef.current.clear(); catchUpRef.current = false;
      // Resume validates every already visited row, in bounded batches, without fetching the entire inbox.
      const batches = Math.max(1, Math.ceil(known.length / 200));
      const searchMatches = { ...(mode === "replace" ? {} : current?.page.searchMatches) };
      let latest: ConversationPage | null = null;
      const countVersions = new Map<string, InboxConversation>();
      for (let offset = 0; offset < batches; offset++) {
        const ids = known.slice(offset * 200, (offset + 1) * 200);
        const before = new Map(liveRowsRef.current.map(row => [row.id, rowVersion(row)]));
        const page = await read({ ...activeRequest, cursor: mode === "more" ? current!.page.cursor : null,
          ...(ids.length ? { knownIds: ids } : {}) }, controller.signal);
        if (generation !== generationRef.current || controller.signal.aborted) return;
        for (const row of [...page.conversations, ...page.updates]) { countVersions.set(row.id, row); delete searchMatches[row.id]; }
        Object.assign(searchMatches, page.searchMatches);
        const live = new Map(liveRowsRef.current.map(row => [row.id,row]));
        if ([...page.conversations, ...page.updates].some(row => live.has(row.id) && live.get(row.id)!.business_id !== row.business_id)) {
          throw new Error("The conversation page returned a mismatched workspace. Please retry.");
        }
        const changed = new Set(liveRowsRef.current.filter(row => before.get(row.id) !== rowVersion(row)).map(row => row.id));
        if (mode === "refresh") {
          const qualified = new Set(page.matchedKnownIds);
          rows = rows.filter(row => !ids.includes(row.id) || qualified.has(row.id) || changed.has(row.id));
        }
        const updatedRows = [...page.conversations,...page.updates].flatMap(row => {
          const current = live.get(row.id);
          if (current && current.business_id !== row.business_id) return [];
          return [current && isOlderConversationState(current, row) ? current : row];
        });
        rows = mergeConversationPage(rows, updatedRows);
        for (const id of changed) { pendingIdsRef.current.add(id); dirtyRef.current = true; }
        for (const row of updatedRows) versionsRef.current.set(row.id,rowVersion(row));
        onRowsRef.current?.(updatedRows);
        latest = page;
      }
      if (!latest) return;
      const page = { total: latest.total, counts: latest.counts, searchMatches,
        // A refresh keeps the oldest visited cursor; resetting it would reload already visited history.
        cursor: mode === "refresh" ? current?.page.cursor ?? latest.cursor : latest.cursor,
        hasMore: mode === "refresh" ? current?.page.hasMore ?? latest.hasMore : latest.hasMore,
        ids: rows.map(row => row.id) };
      const next = { key: activeKey, rows, countRows: rows.map(row => countVersions.get(row.id) ?? row), page, loading: false, error: null };
      stateRef.current = next; setState(next);
      const cache = new Map(viewCacheRef.current);
      cache.delete(activeKey);
      if (next.rows.length <= VIEW_CACHE_MAX_ROWS) cache.set(activeKey, { state: next, at: Date.now(),
        channelId: activeRequest.channelId, workspaceId: activeRequest.workspaceId });
      while (cache.size > VIEW_CACHE_MAX) cache.delete(cache.keys().next().value!);
      viewCacheRef.current = cache; setViewCache(cache);
    } catch (error) {
      if (!controller.signal.aborted && generation === generationRef.current) {
        catchUpRef.current = true;
        const denied = Boolean(error && typeof error === "object" && "denied" in error && error.denied);
        if (denied) { viewCacheRef.current = new Map(); setViewCache(new Map()); }
        setState(previous => previous ? {
          ...previous, ...(denied ? { rows: [], countRows: [] } : {}),
          loading: false, errorKey: activeKey,
          error: error instanceof Error ? error.message : "Unable to load conversations. Please retry.",
        } : null);
      }
    } finally {
      finishForeground();
      if (controllerRef.current === controller) { controllerRef.current = null; inFlightKeyRef.current = null; }
      // An old request's finally must not schedule or consume the new view's
      // recovery work after navigation has transferred request ownership.
      if (generation === generationRef.current && requestKey(requestRef.current) === activeKey && dirtyRef.current && visible()) {
        dirtyRef.current = false;
        timerRef.current = setTimeout(() => { timerRef.current = null; void run("refresh"); }, 300);
      }
    }
  }, [initial, read]);

  useEffect(() => {
    if (!initial) return;
    requestRef.current = request;
    const navigated = requestedKeyRef.current !== key;
    requestedKeyRef.current = key;
    if (!navigated && stateRef.current?.key === key) return;
    // A navigation landing brings new server props for the destination this
    // pager is already reading (the read started at the click). Restarting it
    // would abort that read and repeat it.
    if (!navigated && controllerRef.current && inFlightKeyRef.current === key) return;
    // Settled state can still belong to the destination while another view
    // is loading (A -> B -> A). Cancel B before considering A already loaded.
    controllerRef.current?.abort(); controllerRef.current = null; generationRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null; dirtyRef.current = false;
    if (navigated && stateRef.current?.key === key) {
      for (const row of stateRef.current.rows) pendingIdsRef.current.add(row.id);
      for (const [id, at] of recentChangesRef.current) {
        if (Date.now() - at <= VIEW_CACHE_TTL_MS) pendingIdsRef.current.add(id);
      }
    }
    void run(stateRef.current?.key === key ? "refresh" : "replace");
  }, [key, initial, run, request]);

  useEffect(() => () => {
    controllerRef.current?.abort(); controllerRef.current = null; generationRef.current++;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!initial) return;
    const schedule = (event?: Event) => {
      if (event instanceof CustomEvent && event.detail?.activeOnly) return;
      if (event instanceof CustomEvent && typeof event.detail?.conversationId === "string") pendingIdsRef.current.add(event.detail.conversationId);
      else catchUpRef.current = true;
      dirtyRef.current = true;
      // A known row cannot change a disjoint channel/workspace snapshot. Keep
      // those bounded warm views; navigation still authenticates/requalifies.
      // Unknown, permission/scope and reconnect events remain full invalidations.
      const changedId = event instanceof CustomEvent && typeof event.detail?.conversationId === "string"
        ? event.detail.conversationId : null;
      const changed = changedId ? liveRowsRef.current.find(row => row.id === changedId) : null;
      const cache = new Map([...viewCacheRef.current].filter(([,entry]) => {
        if (!changed || entry.state.rows.some(row => row.id === changed.id)) return false;
        const channelId = changed.social_account?.id;
        return Boolean(entry.channelId && channelId && entry.channelId !== channelId ||
          entry.workspaceId && entry.workspaceId !== changed.business_id);
      }));
      viewCacheRef.current = cache; setViewCache(cache);
      if (document.visibilityState === "hidden" || controllerRef.current || timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null; dirtyRef.current = false; void run("refresh");
      }, 300);
    };
    window.addEventListener(INBOX_PAGE_CHANGED_EVENT, schedule);
    window.addEventListener(INBOX_SYNC_EVENT, schedule);
    window.addEventListener("focus", schedule); window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      window.removeEventListener(INBOX_PAGE_CHANGED_EVENT, schedule);
      window.removeEventListener(INBOX_SYNC_EVENT, schedule);
      window.removeEventListener("focus", schedule); window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null;
    };
  }, [initial, run]);

  const cachedView = viewCache.get(key);
  const displayedState = state?.key === key ? state :
    cachedView && Date.now() - cachedView.at <= VIEW_CACHE_TTL_MS ? cachedView.state : null;
  const rows = useMemo(() => {
    if (!displayedState) return [];
    const live = new Map(liveRows.map(row => [row.id,row]));
    const authorized = displayedState === state ? displayedState.rows :
      displayedState.rows.filter(row => live.get(row.id)?.business_id === row.business_id);
    return mergeConversationPage(authorized, authorized.flatMap(row => live.has(row.id) ? [live.get(row.id)!] : []));
  }, [displayedState, state, liveRows]);
  const more = useCallback(() => { void run("more"); }, [run]);
  const retry = useCallback(() => { catchUpRef.current = true; void run(stateRef.current?.key === requestKey(requestRef.current) ? "refresh" : "replace"); }, [run]);
  const snapshot = useCallback(async () => (await read({ ...requestRef.current, cursor: null }, new AbortController().signal, true)).readTargets, [read]);
  const displayedPage = useMemo<ConversationPagingInitial["page"] | undefined>(() => {
    const state = displayedState;
    if (!state) return undefined;
    const live = new Map(liveRows.map(row => [row.id, row]));
    let messagesDelta = 0, chatsDelta = 0;
    for (const baseline of state.countRows) {
      const row = live.get(baseline.id);
      if (!row || row.business_id !== baseline.business_id || row.status !== baseline.status) continue;
      const before = Math.max(0, baseline.unread_count ?? 0), after = Math.max(0, row.unread_count ?? 0);
      messagesDelta += after - before;
      chatsDelta += Number(after > 0) - Number(before > 0);
    }
    const counts = state.page.counts;
    return { ...state.page, counts: { ...counts,
      views: { ...counts.views, unread: Math.max(0, counts.views.unread + chatsDelta) },
      totalUnreadCount: Math.max(0, counts.totalUnreadCount + messagesDelta),
      unreadConversationCount: Math.max(0, counts.unreadConversationCount + chatsDelta),
    } };
  }, [displayedState, liveRows]);
  const error = state?.errorKey === key || state?.key === key ? state?.error : null;
  return { enabled: Boolean(initial), rows, page: displayedPage,
    loading: Boolean(state?.key === key ? state.loading : !displayedState && !error),
    // An authoritative empty page is still loaded. Quiet revalidation must not
    // replace its empty state with navigation skeletons after the last unread is read.
    initialLoading: Boolean(initial && !displayedState && !error),
    error, more, retry, snapshot };
}
