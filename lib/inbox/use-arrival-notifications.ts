"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { InboxConversation, InboxMessage } from "@/types/inbox";

type Arrival = {
  messageId: string; conversationId: string; customerName: string; body: string;
  messageTime: number; fallback?: boolean;
};
type Input = {
  scopeKey: string;
  listKey: string;
  activeConversationId: string | null;
  conversations: InboxConversation[];
  unreadOnly: boolean;
  waitForNewConversation: boolean;
  messages: InboxMessage[];
  notify: (arrival: Arrival) => void;
};
type Version = { conversationId: string; time: number; fallbackKey?: string; claimed?: boolean };
const MAX_RECENT = 1000;

/** Queue alerts with state updates; an open foreground thread must contain the arrival first. */
export function useArrivalNotifications(input: Input) {
  const { scopeKey, listKey, activeConversationId, conversations, unreadOnly, waitForNewConversation, messages, notify } = input;
  const owner = useRef({ scopeKey, active: false, pending: new Map<string, Arrival>(),
    ids: new Set<string>(), versions: new Map<string, Version>(),
    listKey, listed: new Map<string, number>(), searchFiltered: false });
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    const state = owner.current;
    if (state.scopeKey !== scopeKey) {
      state.pending.clear(); state.ids.clear(); state.versions.clear();
    }
    if (state.scopeKey !== scopeKey || state.listKey !== listKey) {
      state.listed.clear(); state.searchFiltered = false;
    }
    state.scopeKey = scopeKey;
    state.listKey = listKey;
  }, [scopeKey, listKey]);
  useLayoutEffect(() => {
    const state = owner.current;
    state.active = true;
    return () => { state.active = false; state.pending.clear(); };
  }, [scopeKey]);

  const onListCommit = useCallback((rows: Pick<InboxConversation, "id" | "last_message_at">[], key: string, searchFiltered: boolean) => {
    const state = owner.current;
    if (!state.active || state.scopeKey !== scopeKey || state.listKey !== key) return;
    const listed = new Map(rows.map(row => [row.id, Date.parse(row.last_message_at ?? "") || 0]));
    const changed = state.searchFiltered !== searchFiltered || state.listed.size !== listed.size ||
      [...listed].some(([id, time]) => state.listed.get(id) !== time);
    if (!changed) return;
    state.listed = listed;
    state.searchFiltered = searchFiltered;
    if (state.pending.size) setRevision(value => value + 1);
  }, [scopeKey]);

  const enqueue = useCallback((arrival: Arrival) => {
    const state = owner.current;
    if (!state.active || state.scopeKey !== scopeKey) return;
    if (!arrival.fallback && state.ids.has(arrival.messageId)) return;
    const sameVersion = (version: Version) => version.conversationId === arrival.conversationId &&
      arrival.messageTime > 0 && Math.abs(version.time - arrival.messageTime) <= 100;
    const key = arrival.fallback ? `fallback:${arrival.conversationId}:${arrival.messageTime}` : arrival.messageId;
    if (arrival.fallback) {
      if ([...state.versions.values()].some(sameVersion)) return;
      state.versions.set(key, { conversationId: arrival.conversationId, time: arrival.messageTime, fallbackKey: key });
    } else {
      state.ids.add(arrival.messageId);
      while (state.ids.size > MAX_RECENT) state.ids.delete(state.ids.values().next().value!);
      // A conversation fallback represents at most one real message. Two real
      // IDs with the same provider timestamp must still receive two alerts.
      const fallback = [...state.versions.values()].find(version => version.fallbackKey && !version.claimed && sameVersion(version));
      if (fallback) {
        fallback.claimed = true;
        const waiting = state.pending.delete(fallback.fallbackKey!);
        if (!waiting) return; // the fallback already alerted for this message
      }
      state.versions.set(key, { conversationId: arrival.conversationId, time: arrival.messageTime });
    }
    state.pending.set(key, arrival);
    while (state.versions.size > MAX_RECENT) state.versions.delete(state.versions.keys().next().value!);
    while (state.pending.size > MAX_RECENT) state.pending.delete(state.pending.keys().next().value!);
    setRevision(value => value + 1);
  }, [scopeKey]);

  useEffect(() => {
    const state = owner.current;
    if (!state.active || state.scopeKey !== scopeKey) return;
    const foreground = document.visibilityState === "visible" && document.hasFocus();
    for (const [key, arrival] of state.pending) {
      const activeThread = foreground && activeConversationId === arrival.conversationId;
      const readOutsideView = unreadOnly && conversations.some(conversation => conversation.id === arrival.conversationId &&
        conversation.unread_count === 0 && Date.parse(conversation.last_message_at ?? "") + 100 >= arrival.messageTime);
      // In All/Unread without a channel/box restriction a new row is expected.
      // Restricted views must still alert for legitimate out-of-filter arrivals.
      if (foreground && !activeThread && !readOutsideView && waitForNewConversation && !state.searchFiltered &&
          (!state.listed.has(arrival.conversationId) || (state.listed.get(arrival.conversationId) ?? 0) + 100 < arrival.messageTime)) continue;
      const awaitingThread = activeThread &&
        !messages.some(message => message.conversation_id === arrival.conversationId &&
          (message.id === arrival.messageId || arrival.fallback && message.direction === "incoming" &&
            Date.parse(message.platform_created_at ?? message.created_at) + 100 >= arrival.messageTime));
      if (awaitingThread) continue;
      state.pending.delete(key);
      notify(arrival);
    }
  }, [scopeKey, listKey, activeConversationId, conversations, unreadOnly, waitForNewConversation, messages, notify, revision]);

  useEffect(() => {
    const resume = () => setRevision(value => value + 1);
    window.addEventListener("blur", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { window.removeEventListener("blur", resume); document.removeEventListener("visibilitychange", resume); };
  }, []);
  return { enqueue, onListCommit };
}
