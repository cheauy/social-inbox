"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxMessage } from "@/types/inbox";
import { getMessagePin, isMessagePinned, MESSAGE_ROW_CHANGED_EVENT } from "@/lib/inbox/message-actions";

/** Reuses Inbox's existing Realtime stream. No second Supabase connection/poll. */
export function usePinnedMessages(conversationId: string | null, messages: InboxMessage[]) {
  const [pins, setPins] = useState<InboxMessage[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const scope = useRef(conversationId);
  scope.current = conversationId;
  const alive = useRef(true);
  const revision = useRef(0);
  const epoch = useRef(0);
  const requestNumber = useRef(0);
  const changes = useRef(new Map<string, { row: InboxMessage; removed: boolean; revision: number }>());
  const inFlight = useRef(new Set<string>());
  const previous = useRef(new Map<string, string>());

  const apply = useCallback((message: InboxMessage, removed = false) => {
    if (!alive.current || message.conversation_id !== scope.current) return;
    revision.current += 1;
    changes.current.set(message.id, { row: message, removed, revision: revision.current });
    setPins((current) => {
      const next = current.filter((item) => item.id !== message.id);
      if (!removed && isMessagePinned(message)) next.push(message);
      return next.sort((a, b) => String(getMessagePin(b).updated_at ?? "").localeCompare(String(getMessagePin(a).updated_at ?? "")));
    });
  }, []);

  const refresh = useCallback(async () => {
    const id = scope.current;
    if (!id) return;
    const started = revision.current;
    const generation = epoch.current;
    const requestId = ++requestNumber.current;
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/message-pins`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to load pinned messages.");
      if (!alive.current || scope.current !== id || epoch.current !== generation || requestId !== requestNumber.current) return;
      // A realtime event arriving during this GET must override only its own row,
      // not discard all historical pins (which are outside the newest 25 messages).
      const merged = new Map<string, InboxMessage>();
      for (const item of (Array.isArray(result.pins) ? result.pins : []) as InboxMessage[]) {
        if (item.conversation_id === id && isMessagePinned(item)) merged.set(item.id, item);
      }
      for (const [messageId, change] of changes.current) {
        if (change.revision > started) {
          merged.delete(messageId);
          if (!change.removed && isMessagePinned(change.row)) merged.set(messageId, change.row);
        } else {
          changes.current.delete(messageId);
        }
      }
      setPins([...merged.values()].sort((a, b) => String(getMessagePin(b).updated_at ?? "").localeCompare(String(getMessagePin(a).updated_at ?? ""))));
      setError(result.truncated ? "Only the first 100 pinned messages are shown." : null);
    } catch (cause) {
      if (alive.current && scope.current === id && epoch.current === generation && requestId === requestNumber.current) {
        setError(cause instanceof Error ? cause.message : "Unable to load pinned messages.");
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    epoch.current += 1;
    changes.current.clear();
    inFlight.current = new Set();
    setPendingIds(new Set());
    revision.current += 1;
    previous.current.clear();
    setPins([]);
    setError(null);
    void refresh();
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ row: InboxMessage; eventType: string }>).detail;
      if (detail?.row?.conversation_id === scope.current) apply(detail.row, detail.eventType === "DELETE");
    };
    const restored = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener(MESSAGE_ROW_CHANGED_EVENT, changed);
    window.addEventListener("focus", restored);
    window.addEventListener("online", restored);
    document.addEventListener("visibilitychange", restored);
    return () => {
      alive.current = false;
      epoch.current += 1;
      revision.current += 1;
      window.removeEventListener(MESSAGE_ROW_CHANGED_EVENT, changed);
      window.removeEventListener("focus", restored);
      window.removeEventListener("online", restored);
      document.removeEventListener("visibilitychange", restored);
    };
  }, [conversationId, apply, refresh]);

  useEffect(() => {
    for (const message of messages) {
      if (message.conversation_id !== conversationId) continue;
      const signature = JSON.stringify([getMessagePin(message), message.raw_payload?.tenh_deleted, message.comment_is_deleted, message.message_text, message.attachment_url]);
      const old = previous.current.get(message.id);
      previous.current.set(message.id, signature);
      // Initial newest-page rows must not cancel the separate historical-pin read.
      if (old !== undefined && old !== signature) apply(message);
    }
  }, [conversationId, messages, apply]);

  const toggle = useCallback(async (message: InboxMessage, pinned: boolean) => {
    const id = scope.current;
    if (!id || message.conversation_id !== id || inFlight.current.has(message.id)) return null;
    const generation = epoch.current;
    const pending = inFlight.current;
    pending.add(message.id);
    setPendingIds(new Set(inFlight.current));
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/message-pins`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, pinned }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.message) throw new Error(result.error || "Unable to save the pinned message.");
      if (!alive.current || scope.current !== id || epoch.current !== generation) return null;
      const updated = result.message as InboxMessage;
      apply(updated);
      return updated;
    } catch (cause) {
      if (alive.current && scope.current === id && epoch.current === generation) setError(cause instanceof Error ? cause.message : "Unable to save the pinned message.");
      return null;
    } finally {
      pending.delete(message.id);
      if (alive.current && scope.current === id && epoch.current === generation) setPendingIds(new Set(pending));
    }
  }, [apply]);

  return { pins, toggle, pendingIds, error, refresh, dismissError: () => setError(null) };
}
