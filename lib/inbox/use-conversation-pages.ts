"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InboxConversation } from "@/types/inbox";
import { beginForegroundLoading } from "@/lib/display/foreground-loading";
import { INBOX_SYNC_EVENT, SYNC_TIMEOUT_MS } from "@/lib/inbox/live-sync";
import { isOlderConversationState } from "@/lib/inbox/live-sync";
import { INBOX_PAGE_CHANGED_EVENT, mergeConversationPage, type ConversationPage, type ConversationPageRequest, type ConversationPagingInitial } from "./conversation-page-contract";

type State = { key: string; rows: InboxConversation[]; page: ConversationPagingInitial["page"]; loading: boolean; error: string | null };
const requestKey = (request: ConversationPageRequest) => JSON.stringify({ ...request, cursor: null, knownIds: undefined });
const visible = () => document.visibilityState !== "hidden";
const rowVersion = (row: InboxConversation) => JSON.stringify([row.updated_at,row.last_message_at,row.last_message_text,
  row.unread_count,row.status,row.is_pinned,row.assigned_to,row.contact]);

/** No interval: page reads follow navigation, explicit history loading or coalesced live/resume events. */
export function useConversationPages(initial: ConversationPagingInitial | undefined, request: ConversationPageRequest,
  liveRows: InboxConversation[], onRows?: (rows: InboxConversation[]) => void) {
  const key = requestKey(request);
  const [state, setState] = useState<State | null>(() => initial ? {
    key: requestKey(initial.request), rows: initial.page.ids.flatMap(id => {
      const row = liveRows.find(row => row.id === id); return row ? [row] : [];
    }), page: initial.page, loading: false, error: null,
  } : null);
  const stateRef = useRef(state), requestRef = useRef(request), onRowsRef = useRef(onRows);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const dirtyRef = useRef(false);
  const pendingIdsRef = useRef(new Set<string>());
  const catchUpRef = useRef(false);
  const liveRowsRef = useRef(liveRows);
  const versionsRef = useRef(new Map(liveRows.map(row => [row.id,rowVersion(row)])));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { stateRef.current = state; requestRef.current = request; onRowsRef.current = onRows; liveRowsRef.current = liveRows; });
  useEffect(() => {
    if (!initial) return;
    // Existing bounded live-state recovery can discover messages missed while
    // disconnected. Qualify those rows too, including off-page search/view matches.
    for (const row of liveRows) {
      const version = rowVersion(row);
      if (versionsRef.current.get(row.id) !== version) {
        versionsRef.current.set(row.id,version);
        window.dispatchEvent(new CustomEvent(INBOX_PAGE_CHANGED_EVENT, { detail: { conversationId: row.id } }));
      }
    }
  }, [initial, liveRows]);

  const read = useCallback(async (body: ConversationPageRequest, signal: AbortSignal, snapshot = false) => {
    const response = await fetch("/api/inbox/conversation-page", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)]), body: JSON.stringify({ ...body, snapshot }),
    });
    const result = await response.json() as { success?: boolean; page?: ConversationPage; error?: string };
    if (!response.ok || !result.success || !result.page || !Array.isArray(result.page.conversations)) throw new Error(result.error ?? "Unable to load conversations. Please retry.");
    return result.page;
  }, []);

  const run = useCallback(async (mode: "replace" | "more" | "refresh") => {
    if (!initial || !visible()) { dirtyRef.current = true; return; }
    if (controllerRef.current) { if (mode === "refresh") dirtyRef.current = true; return; }
    const current = stateRef.current, activeRequest = requestRef.current, activeKey = requestKey(activeRequest);
    if (current?.key !== activeKey) mode = "replace";
    if (mode === "more" && (!current || current.key !== activeKey || !current.page.hasMore)) return;
    const controller = new AbortController(); controllerRef.current = controller;
    const generation = ++generationRef.current;
    const finishForeground = mode === "refresh" ? () => {} : beginForegroundLoading();
    setState(previous => previous ? { ...previous, loading: true, error: null } : null);
    try {
      let rows = mode === "replace" ? [] : current?.rows ?? [];
      const known = [...new Set([
        ...(mode === "replace" || mode === "refresh" && catchUpRef.current ? liveRowsRef.current.map(row => row.id) : []),
        ...pendingIdsRef.current,
      ])];
      pendingIdsRef.current.clear(); catchUpRef.current = false;
      // Resume validates every already visited row, in bounded batches, without fetching the entire inbox.
      const batches = Math.max(1, Math.ceil(known.length / 200));
      let latest: ConversationPage | null = null;
      for (let offset = 0; offset < batches; offset++) {
        const ids = known.slice(offset * 200, (offset + 1) * 200);
        const before = new Map(liveRowsRef.current.map(row => [row.id, rowVersion(row)]));
        const page = await read({ ...activeRequest, cursor: mode === "more" ? current!.page.cursor : null,
          ...(ids.length ? { knownIds: ids } : {}) }, controller.signal);
        if (generation !== generationRef.current || controller.signal.aborted) return;
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
      const page = { total: latest.total, counts: latest.counts,
        // A refresh keeps the oldest visited cursor; resetting it would reload already visited history.
        cursor: mode === "refresh" ? current?.page.cursor ?? latest.cursor : latest.cursor,
        hasMore: mode === "refresh" ? current?.page.hasMore ?? latest.hasMore : latest.hasMore,
        ids: rows.map(row => row.id) };
      const next = { key: activeKey, rows, page, loading: false, error: null };
      stateRef.current = next; setState(next);
    } catch (error) {
      catchUpRef.current = true;
      if (!controller.signal.aborted && generation === generationRef.current) setState(previous => previous ? {
        ...previous, loading: false, error: error instanceof Error ? error.message : "Unable to load conversations. Please retry.",
      } : null);
    } finally {
      finishForeground();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (dirtyRef.current && visible()) {
        dirtyRef.current = false;
        timerRef.current = setTimeout(() => { timerRef.current = null; void run("refresh"); }, 300);
      }
    }
  }, [initial, read]);

  useEffect(() => {
    if (!initial) return;
    requestRef.current = request;
    if (stateRef.current?.key === key) return;
    controllerRef.current?.abort(); controllerRef.current = null; generationRef.current++;
    void run("replace");
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

  const rows = useMemo(() => {
    if (state?.key !== key) return [];
    const live = new Map(liveRows.map(row => [row.id,row]));
    return mergeConversationPage(state.rows, state.rows.flatMap(row => live.has(row.id) ? [live.get(row.id)!] : []));
  }, [state, key, liveRows]);
  const more = useCallback(() => { void run("more"); }, [run]);
  const retry = useCallback(() => { catchUpRef.current = true; void run(stateRef.current?.key === requestKey(requestRef.current) ? "refresh" : "replace"); }, [run]);
  const snapshot = useCallback(async () => (await read({ ...requestRef.current, cursor: null }, new AbortController().signal, true)).readTargets, [read]);
  return { enabled: Boolean(initial), rows, page: state?.page, loading: Boolean(state?.loading || state?.key !== key && !state?.error),
    error: state?.error, more, retry, snapshot };
}
