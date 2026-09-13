"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2, Search, X } from "lucide-react";
import type { MetaStickerChoice, MetaStickerPack } from "@/lib/stickers/catalog";

import { META_STICKER_RECENTS_CHANGED, readMetaStickerRecents, rememberMetaSticker } from "@/lib/stickers/meta-sticker-recents";

import { invalidateMetaStickerCache, loadMetaStickerItems, loadMetaStickerPacks, loadMetaStickerPreviews, metaStickerItemsKey, readMetaStickerCache } from "@/lib/stickers/meta-sticker-cache";

function cachedCovers(businessId: string, packs: MetaStickerPack[]) {
  const covers: Record<string, string> = {};
  for (const pack of packs) {
    const preview = readMetaStickerCache<MetaStickerChoice | null>(businessId, `preview:${pack.packId}`)?.value;
    if (preview?.previewUrl) covers[pack.packId] = preview.previewUrl;
  }
  return covers;
}
type Props = {
  businessId: string;
  conversationId: string;
  disabled: boolean;
  onSend: (choice: MetaStickerChoice) => Promise<boolean>;
  onSent: () => void;
};

export function MetaStickerGrid({ businessId, conversationId, disabled, onSend, onSent }: Props) {
  const [packs, setPacks] = useState<MetaStickerPack[]>(() => readMetaStickerCache<MetaStickerPack[]>(businessId, "packs")?.value || []);
  const [covers, setCovers] = useState<Record<string, string>>(() => cachedCovers(businessId, packs));
  const [recent, setRecent] = useState<MetaStickerChoice[]>(() => readMetaStickerRecents(businessId));
  const [activePack, setActivePack] = useState<string>(() => recent.length ? "recent" : packs[0]?.packId || "recent");
  const [items, setItems] = useState<MetaStickerChoice[]>(() => readMetaStickerCache<MetaStickerChoice[]>(businessId, `pack:${activePack}`)?.value || []);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [packsBusy, setPacksBusy] = useState(false);
  const [packError, setPackError] = useState(""), [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const generation = useRef(0), itemRequest = useRef(0), inFlight = useRef(false), strip = useRef<HTMLDivElement>(null);
  const current = useRef({ conversationId, disabled }); current.current = { conversationId, disabled };

  const catalogScope = useRef(`${businessId}:${conversationId}`);
  useEffect(() => {
    const seq = ++generation.current, target = conversationId;
    let disposed = false;
    itemRequest.current++;
    const cached = readMetaStickerCache<MetaStickerPack[]>(businessId, "packs"), known = cached?.value || [];
    const latestRecent = readMetaStickerRecents(businessId);
    setPacks(known); setCovers(cachedCovers(businessId, known)); setRecent(latestRecent);
    setError(""); setPackError(""); setSendingId(null); setPacksBusy(!disabled && !cached);
    if (catalogScope.current !== `${businessId}:${conversationId}`) {
      catalogScope.current = `${businessId}:${conversationId}`;
      const selected = latestRecent.length ? "recent" : known[0]?.packId || "recent";
      setQuery(""); setActivePack(selected); setItems(readMetaStickerCache<MetaStickerChoice[]>(businessId, `pack:${selected}`)?.value || []);
    }
    if (!disabled && !cached?.fresh) void (async () => {
      try {
        const valid = await loadMetaStickerPacks(businessId, target);
        if (disposed || generation.current !== seq || current.current.conversationId !== target) return;
        setPacks(valid);
        if (!readMetaStickerRecents(businessId).length && valid[0]) setActivePack(value => value === "recent" ? valid[0].packId : value);
      } catch (e) {
        // Keep an expired cached catalog usable while its background refresh fails.
        if (!cached && !disposed && generation.current === seq) setPackError(e instanceof Error ? e.message : "Messenger sticker catalog unavailable.");
      } finally { if (!disposed && generation.current === seq) setPacksBusy(false); }
    })();
    return () => { disposed = true; generation.current++; };
  }, [businessId, conversationId, disabled, reload]);

  useEffect(() => {
    const refresh = () => setRecent(readMetaStickerRecents(businessId));
    window.addEventListener(META_STICKER_RECENTS_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(META_STICKER_RECENTS_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [businessId]);

  useEffect(() => {
    if (disabled || !packs.length || !strip.current) return;
    const seq = generation.current;
    const queued = new Set<string>(), requested = new Set<string>();
    let timer = 0, running = false, disposed = false;
    const load = async () => {
      if (running || disposed) return;
      running = true;
      try {
        while (queued.size && !disposed) {
          const ids = [...queued].slice(0, 8);
          ids.forEach(id => queued.delete(id));
          try {
            const previews = await loadMetaStickerPreviews(businessId, conversationId, ids);
            if (disposed || generation.current !== seq) return;
            const next: Record<string, string> = {};
            for (const [id, sticker] of Object.entries(previews)) if (sticker?.previewUrl) next[id] = sticker.previewUrl;
            setCovers(previous => ({ ...previous, ...next }));
          } catch { /* A missing tab preview must never block browsing or sending. */ }
        }
      } finally { running = false; }
    };
    const enqueue = (id: string) => {
      if (id === "recent" || requested.has(id)) return;
      requested.add(id);
      const cached = readMetaStickerCache<MetaStickerChoice | null>(businessId, `preview:${id}`);
      if (cached?.value?.previewUrl) setCovers(previous => ({ ...previous, [id]: cached.value!.previewUrl! }));
      if (cached?.fresh) return;
      queued.add(id); window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 30);
    };
    const tabs = strip.current.querySelectorAll<HTMLElement>("[data-pack-id]");
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) enqueue((entry.target as HTMLElement).dataset.packId!);
    }, { root: strip.current, rootMargin: "0px 44px", threshold: 0.01 });
    if (observer) tabs.forEach(tab => observer.observe(tab));
    else Array.from(tabs).slice(0, 8).forEach(tab => enqueue(tab.dataset.packId!));
    return () => { disposed = true; observer?.disconnect(); window.clearTimeout(timer); };
  }, [businessId, conversationId, disabled, packs, reload]);

  useEffect(() => {
    const q = query.trim(), search = q.length >= 2;
    const requestId = ++itemRequest.current, seq = generation.current, target = conversationId;
    let disposed = false;
    setError("");
    if (disabled || (!search && activePack === "recent")) { setItems([]); setBusy(false); return; }
    const cached = readMetaStickerCache<MetaStickerChoice[]>(businessId, metaStickerItemsKey(activePack, q));
    setItems(cached?.value || []); setBusy(!cached);
    if (cached?.fresh) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const stickers = await loadMetaStickerItems(businessId, target, activePack, q);
          if (disposed || generation.current !== seq || itemRequest.current !== requestId || current.current.conversationId !== target) return;
          setItems(stickers);
        } catch (e) {
          if (!cached && !disposed && generation.current === seq && itemRequest.current === requestId) setError(e instanceof Error ? e.message : "Unable to load Messenger stickers.");
        } finally {
          if (!disposed && generation.current === seq && itemRequest.current === requestId) setBusy(false);
        }
      })();
    }, search && !cached ? 250 : 0);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [businessId, conversationId, disabled, activePack, query, reload]);

  const loading = busy || packsBusy;
  const displayError = error || (query.trim().length < 2 ? packError : "");

  const shown = useMemo(() => query.trim().length >= 2 ? items : activePack === "recent" ? recent : items, [query, activePack, recent, items]);

  async function send(choice: MetaStickerChoice) {
    if (inFlight.current || current.current.disabled || current.current.conversationId !== conversationId) return;
    const seq = generation.current, target = conversationId;
    inFlight.current = true; setSendingId(choice.stickerId); setError("");
    try {
      const ok = await onSend(choice);
      // Sending disables/closes the parent picker before this promise resolves.
      // Record the confirmed send even after unmount; only UI updates need a guard.
      if (ok) rememberMetaSticker(businessId, choice);
      if (current.current.conversationId !== target || generation.current !== seq) return;
      if (ok) { setRecent(readMetaStickerRecents(businessId)); onSent(); }
      else setError("Meta did not confirm this sticker send. Check the conversation before trying again.");
    } catch (e) { if (current.current.conversationId === target && generation.current === seq) setError(e instanceof Error ? e.message : "Sticker could not be sent."); }
    finally { inFlight.current = false; if (current.current.conversationId === target && generation.current === seq) setSendingId(null); }
  }

  function retry() {
    invalidateMetaStickerCache(businessId, ["packs", metaStickerItemsKey(activePack, query)]);
    setReload(value => value + 1);
  }
  function selectPack(packId: string) {
    setQuery(""); setError(""); setActivePack(packId);
    strip.current?.querySelector<HTMLElement>(`[data-pack-id="${CSS.escape(packId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
  function scrollPacks(direction: -1 | 1) { strip.current?.scrollBy({ left: direction * 180, behavior: "smooth" }); }

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="tenh-meta-stickers">
    <div className="relative mx-3 mb-2 shrink-0">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} aria-label="Search Messenger stickers" placeholder="Search Messenger stickers" className="h-9 w-full rounded-xl bg-slate-100 pl-9 pr-8 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-300" />
      {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear sticker search" className="absolute right-2 top-2 p-0.5 text-slate-500"><X className="h-4 w-4" /></button> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2" aria-busy={loading || Boolean(sendingId)}>
      {displayError ? <div role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{displayError}<button type="button" disabled={loading || Boolean(sendingId)} onClick={retry} className="ml-2 font-semibold underline">Try again</button></div> : null}
      <div className="grid grid-cols-4 gap-2">
        {shown.map(item => <button key={item.stickerId} type="button" disabled={disabled || busy || Boolean(sendingId)} title={item.label} aria-label={`Send sticker: ${item.label}`} onClick={() => void send(item)} className="relative flex aspect-square items-center justify-center rounded-xl p-1 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40">
          {item.previewUrl ? <img src={item.previewUrl} referrerPolicy="no-referrer" alt={item.label} loading="lazy" className="h-full w-full object-contain" /> : <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">Sticker</span>}
          {sendingId === item.stickerId ? <Loader2 className="absolute h-6 w-6 animate-spin text-blue-600" /> : null}
        </button>)}
      </div>
      {loading ? <p role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading stickers…</p> : !shown.length && !displayError ? <p className="py-8 text-center text-sm text-slate-500">{activePack === "recent" && query.trim().length < 2 ? "Your recently sent Messenger stickers appear here." : "No stickers found."}</p> : null}
    </div>
    <div className="flex shrink-0 items-center border-t border-slate-200 px-1 py-2">
      <button type="button" aria-label="Previous sticker packs" onClick={() => scrollPacks(-1)} className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
      <div ref={strip} className="flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Messenger sticker packs">
        <button data-pack-id="recent" type="button" role="tab" aria-selected={activePack === "recent" && query.trim().length < 2} title="Recent" aria-label="Recently sent stickers" onClick={() => selectPack("recent")} className={`relative flex h-11 min-w-11 items-center justify-center rounded-xl ${activePack === "recent" && query.trim().length < 2 ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}><Clock className="h-6 w-6 text-blue-500" /></button>
        {packs.map(pack => <button key={pack.packId} data-pack-id={pack.packId} type="button" role="tab" aria-selected={activePack === pack.packId && query.trim().length < 2} title={pack.name} onClick={() => selectPack(pack.packId)} className={`relative flex h-11 min-w-11 items-center justify-center overflow-hidden rounded-xl ${activePack === pack.packId && query.trim().length < 2 ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}>{covers[pack.packId] ? <img src={covers[pack.packId]} referrerPolicy="no-referrer" alt="" className="h-9 w-9 object-contain" /> : <span className="text-xs font-semibold text-slate-500">{pack.name.slice(0, 2).toUpperCase()}</span>}</button>)}
      </div>
      <button type="button" aria-label="Next sticker packs" onClick={() => scrollPacks(1)} className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><ChevronRight className="h-5 w-5" /></button>
    </div>
  </div>;
}
