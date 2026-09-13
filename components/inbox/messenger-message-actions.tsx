"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, SmilePlus } from "lucide-react";
import { useWorkspacePermissions } from "@/lib/auth/use-workspace-permissions";
import { canReactToMessengerMessage, getMessengerReaction, MESSENGER_QUICK_REACTIONS, withMessengerReaction } from "@/lib/facebook/message-reactions";
import { MessageActionToolbar, type MessageActionToolbarProps } from "./message-action-toolbar";
import type { InboxMessage } from "@/types/inbox";

type Props = MessageActionToolbarProps & { message: InboxMessage; platform?: string | null; hideReaction?: boolean; onMessagePatched: (message: InboxMessage) => void };

/** Uses the existing message row and Realtime updates; no polling or extra channel. */
export function MessengerMessageActions({ message, platform, hideReaction, onMessagePatched, ...toolbar }: Props) {
  const { can } = useWorkspacePermissions();
  const eligible = !hideReaction && canReactToMessengerMessage(message, platform);
  const allowed = eligible && can("conversations", "manage");
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false), alive = useRef(true);
  const latest = useRef(message); latest.current = message;
  const scope = `${message.conversation_id}:${message.id}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const pageEmoji = optimistic !== undefined ? optimistic : getMessengerReaction(message.raw_payload, "page")?.emoji;
  const customerEmoji = getMessengerReaction(message.raw_payload, "customer")?.emoji;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!allowed) { setOpen(false); return; }
    const anchor = trigger.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(288, window.innerWidth - 16), height = pageEmoji ? 98 : 60;
    const left = Math.max(8, Math.min(toolbar.outgoing ? anchor.right - width : anchor.left, window.innerWidth - width - 8));
    const top = anchor.top >= height + 8 ? anchor.top - height - 6 : Math.min(anchor.bottom + 6, window.innerHeight - height - 8);
    setPosition({ top: Math.max(8, top), left });
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, allowed, toolbar.outgoing, pageEmoji]);

  useEffect(() => {
    if (open && position) panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open, position]);

  async function react(emoji: string | null) {
    if (!allowed || inFlight.current) return;
    const target = latest.current, targetScope = scope;
    inFlight.current = true; setPending(true); setOpen(false); setNotice(""); setOptimistic(emoji);
    trigger.current?.focus({ preventScroll: true });
    try {
      const response = await fetch("/api/facebook/messages/reaction", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: target.conversation_id, messageId: target.id, reaction: emoji }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!alive.current || currentScope.current !== targetScope) return;
      if (!response.ok || !data.success) throw new Error(data.error || "Messenger could not save this reaction.");
      // Patch only reaction metadata on the latest row, preserving simultaneous
      // pin, delivery and read updates. A newer webhook wins over this response.
      const confirmed = getMessengerReaction(data.message?.raw_payload, "page") ?? { emoji, timestamp: data.timestamp };
      const updated = { ...latest.current, raw_payload: withMessengerReaction(latest.current.raw_payload, "page", confirmed) };
      onMessagePatched(updated);
      if (data.warning) setNotice(data.warning);
    } catch (error) {
      if (alive.current && currentScope.current === targetScope) setNotice(error instanceof Error ? error.message : "The reaction result is uncertain. Check Messenger before trying again.");
    } finally {
      inFlight.current = false;
      if (alive.current && currentScope.current === targetScope) { setPending(false); setOptimistic(undefined); }
    }
  }

  return <>
    {eligible && (pageEmoji || customerEmoji) ? <div className={`mt-1 flex gap-1 px-1 ${toolbar.outgoing ? "justify-end" : "justify-start"}`} aria-label="Message reactions">
      {pageEmoji ? <button type="button" disabled={!allowed || pending} onClick={() => void react(null)} title="Page reaction · click to remove" aria-label={`Remove Page reaction ${pageEmoji}`} className="inline-flex min-h-7 min-w-8 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-base shadow-sm disabled:cursor-default">{pageEmoji}</button> : null}
      {customerEmoji ? <span title="Customer reaction" aria-label={`Customer reaction ${customerEmoji}`} className="inline-flex min-h-7 min-w-8 items-center justify-center rounded-full border border-slate-200 bg-white px-2 text-base shadow-sm">{customerEmoji}</span> : null}
    </div> : null}
    <MessageActionToolbar {...toolbar} keepVisible={open || pending} reactionControl={allowed ? <button ref={trigger} type="button" disabled={pending} aria-label="React to message" title="React to message" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setPosition(null); setOpen(value => !value); }} className="flex h-7 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-wait">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SmilePlus className="h-4 w-4" />}
    </button> : undefined} />
    {eligible && notice ? <p role="alert" className="mt-1 max-w-[320px] rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">{notice}</p> : null}
    {open && allowed && position ? createPortal(<div ref={panel} role="dialog" aria-label="Choose a Messenger reaction" className="fixed z-[10000] w-72 max-w-[calc(100vw-16px)] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl" style={position} onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-0.5">
        {MESSENGER_QUICK_REACTIONS.map(item => <button key={item.emoji} type="button" title={item.label} aria-label={`${pageEmoji === item.emoji ? "Remove" : "React with"} ${item.label}`} aria-pressed={pageEmoji === item.emoji} onClick={() => void react(pageEmoji === item.emoji ? null : item.emoji)} className={`flex h-10 w-9 items-center justify-center rounded-full text-2xl transition hover:scale-110 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500 ${pageEmoji === item.emoji ? "bg-blue-100" : ""}`}>{item.emoji}</button>)}
      </div>
      {pageEmoji ? <button type="button" onClick={() => void react(null)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Remove reaction</button> : null}
    </div>, document.body) : null}
  </>;
}
