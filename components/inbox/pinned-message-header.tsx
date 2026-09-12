"use client";
import { useState } from "react";
import type { InboxMessage } from "@/types/inbox";
import { getMessageSummary } from "@/lib/inbox/message-actions";

export function PinnedMessageHeader({ messages, pendingIds, onJump, onUnpin }: {
  messages: InboxMessage[];
  pendingIds: Set<string>;
  onJump: (message: InboxMessage) => void;
  onUnpin: (message: InboxMessage) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const index = Math.max(0, messages.findIndex((item) => item.id === selectedId));
  const message = messages[index];
  if (!message) return null;
  return (
    <section aria-label="Pinned messages" className="flex shrink-0 items-center gap-3 border-b border-sky-100 bg-sky-50/80 px-4 py-2">
      <span aria-hidden="true" className="text-lg">📌</span>
      <button type="button" onClick={() => onJump(message)} title={getMessageSummary(message)} className="min-w-0 flex-1 border-l-2 border-sky-400 pl-3 text-left focus-visible:outline-2 focus-visible:outline-sky-500">
        <span className="block text-xs font-bold text-sky-700">Pinned message{messages.length > 1 ? ` · ${index + 1}/${messages.length}` : ""}</span>
        <span className="block truncate text-sm text-slate-700">{getMessageSummary(message)}</span>
      </button>
      {messages.length > 1 && <button type="button" aria-label="Next pinned message" onClick={() => setSelectedId(messages[(index + 1) % messages.length].id)} className="rounded-lg px-2 py-1 text-sky-700 hover:bg-sky-100">↓</button>}
      <button type="button" aria-label="Unpin message" title="Unpin in TENH" disabled={pendingIds.has(message.id)} onClick={() => onUnpin(message)} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-sky-100 disabled:opacity-50">{pendingIds.has(message.id) ? "Saving…" : "Unpin"}</button>
    </section>
  );
}
