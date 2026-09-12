"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { STIPOP_CATEGORIES, type StipopStickerChoice } from "@/lib/stickers/catalog";

/** Lives inside the EXISTING sticker popover; no second Inbox or login. */
export function StipopStickerGrid({ conversationId, disabled, onSend, onSent }: {
  conversationId: string; disabled: boolean;
  onSend: (choice: StipopStickerChoice) => Promise<boolean>;
  onSent: () => void;
}) {
  const [query, setQuery] = useState("hello"), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [items, setItems] = useState<StipopStickerChoice[]>([]), [busy, setBusy] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null), [hasMore, setHasMore] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), inFlight = useRef(false);
  const current = useRef({ conversationId, disabled }); current.current = { conversationId, disabled };
  useEffect(() => { setItems([]); setPage(1); setError(""); return () => { generation.current++; }; }, [conversationId]);
  useEffect(() => {
    if (disabled) return;
    const seq = ++generation.current, target = conversationId;
    const controller = new AbortController();
    setBusy(true); setError(""); setHasMore(false);
    if (page === 1) setItems([]);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ conversationId: target, q: query.trim() || "hello", page: String(page) });
          const response = await fetch(`/api/stickers/search?${params}`, { cache: "no-store", signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !data.success || !Array.isArray(data.stickers)) throw new Error(data.error || "Unable to search online stickers.");
          if (controller.signal.aborted || generation.current !== seq || current.current.conversationId !== target) return;
          const choices: StipopStickerChoice[] = data.stickers.filter((item: StipopStickerChoice) => item?.provider === "stipop" && typeof item.stickerId === "string" && typeof item.selectionToken === "string" && typeof item.imageUrl === "string" && item.imageUrl.startsWith("https://"));
          setItems(old => page === 1 ? choices : [...old, ...choices.filter(item => !old.some(saved => saved.stickerId === item.stickerId))]);
          setHasMore(data.hasMore === true);
        } catch (e) { if (!controller.signal.aborted && generation.current === seq) setError(e instanceof Error ? e.message : "Sticker service unavailable."); }
        finally { if (generation.current === seq) setBusy(false); }
      })();
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); if (seq === generation.current) generation.current++; };
  }, [conversationId, disabled, query, page, revision]);
  async function send(choice: StipopStickerChoice) {
    if (inFlight.current || current.current.disabled || current.current.conversationId !== conversationId) return;
    if (choice.expiresAt < Date.now()) { setError("This selection expired. Search again."); setRevision(n => n + 1); return; }
    const seq = generation.current, target = conversationId;
    inFlight.current = true; setSendingId(choice.stickerId); setError("");
    try {
      const sent = await onSend(choice);
      if (current.current.conversationId !== target || generation.current !== seq) return;
      if (sent) onSent(); else setError("Send was not confirmed. Check the outgoing message before trying again.");
    } catch (e) { if (current.current.conversationId === target && generation.current === seq) setError(e instanceof Error ? e.message : "Sticker could not be sent."); }
    finally { inFlight.current = false; if (current.current.conversationId === target && generation.current === seq) setSendingId(null); }
  }
  function search(value: string) { setPage(1); setQuery(value); }
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="tenh-online-stickers">
    <div className="relative mx-3 mb-2 shrink-0"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={query} maxLength={100} onChange={e => search(e.target.value)} aria-label="Search Stipop stickers" placeholder="Search online stickers" className="h-9 w-full rounded-xl bg-slate-100 pl-9 pr-8 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-300" />{query ? <button type="button" onClick={() => search("")} aria-label="Clear sticker search" className="absolute right-2 top-2 p-0.5 text-slate-500"><X className="h-4 w-4" /></button> : null}</div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2" aria-busy={busy || Boolean(sendingId)}>
      {error ? <div role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{error}<button type="button" onClick={() => setRevision(n => n + 1)} className="ml-2 font-semibold underline">Reload search</button></div> : null}
      <div className="grid grid-cols-4 gap-2">{items.map(item => <button key={item.stickerId} type="button" disabled={disabled || Boolean(sendingId)} title={`Send ${item.label}`} aria-label={`Send sticker: ${item.label}`} onClick={() => void send(item)} className="relative flex aspect-square items-center justify-center rounded-xl p-1 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40"><img src={item.imageUrl} referrerPolicy="no-referrer" alt={item.label} loading="lazy" className="h-full w-full object-contain" />{sendingId === item.stickerId ? <Loader2 className="absolute h-6 w-6 animate-spin text-blue-600" /> : null}</button>)}</div>
      {busy ? <p role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Searching Stipop…</p> : !items.length && !error ? <p className="py-8 text-center text-sm text-slate-500">No stickers found. Try another search.</p> : null}
      {hasMore && !busy ? <button type="button" disabled={Boolean(sendingId)} onClick={() => setPage(p => p + 1)} className="mt-2 w-full rounded-lg py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50">More stickers</button> : null}
    </div>
    <p className="shrink-0 px-4 py-2 text-[10px] text-slate-500">Stickers by Stipop · click a sticker to send an image attachment. Your typed text stays in the draft.</p>
    <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-slate-200 px-2 py-2" role="tablist" aria-label="Sticker categories">{STIPOP_CATEGORIES.map(category => <button key={category.query} type="button" role="tab" aria-selected={query === category.query} aria-label={category.title} title={category.title} onClick={() => search(category.query)} className={`flex h-11 min-w-11 flex-1 items-center justify-center rounded-xl text-2xl ${query === category.query ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}>{category.icon}</button>)}</div>
  </div>;
}
