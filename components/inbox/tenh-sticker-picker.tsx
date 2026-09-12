"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { StipopStickerGrid } from "./stipop-sticker-grid";
import type { StipopStickerChoice } from "@/lib/stickers/catalog";
import { ChevronLeft, ChevronRight, Clock, Loader2, Plus, Search, Sticker, X } from "lucide-react";
import { TELEGRAM_STICKER_PACKS, normalizeStickerSetName, type TelegramStickerChoice } from "@/lib/telegram/sticker-catalog";
import { readStickerPack, rememberStickerChoice, stickerMatchesSearch, stickerPanelLayout, STICKER_PACK_CACHE_MS, type StickerPanelLayout } from "@/lib/inbox/sticker-picker-ui";

// Same existing artwork and public export; these are NOT Facebook's native store packs.
export const TENH_STICKERS = [
  { id: "hello", label: "Hello" }, { id: "thanks", label: "Thank you" },
  { id: "ok", label: "OK" }, { id: "love", label: "Love it" },
  { id: "sorry", label: "Sorry" }, { id: "delivery", label: "On the way" },
] as const;
type ImageId = typeof TENH_STICKERS[number]["id"];
type Pack = { name: string; title: string; icon: string };
type CachedPack = { title: string; stickers: TelegramStickerChoice[]; at: number };
type Props = {
  disabled: boolean;
  conversationId: string;
  platform?: string;
  onSelect: (file: File) => void;
  onSelectTelegram?: (sticker: TelegramStickerChoice) => void;
  onOpen: () => void;
  onSendFacebook?: (sticker: StipopStickerChoice) => Promise<boolean>;
};

/** Same draft-selection interface, with a scrollable grid and a fixed bottom pack strip. */
export function TenhStickerPicker({ disabled, conversationId, platform, onSelect, onSelectTelegram, onOpen, onSendFacebook }: Props) {
  const telegram = platform === "telegram" && Boolean(onSelectTelegram);
  const [onlineSource, setOnlineSource] = useState(true);
  const facebookOnline = platform === "facebook" && Boolean(onSendFacebook) && onlineSource;
  const id = useId();
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), strip = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const context = `${platform || "other"}:${conversationId}`;
  const current = useRef({ context, disabled }); current.current = { context, disabled };
  const packCache = useRef(new Map<string, CachedPack>());
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [query, setQuery] = useState("");
  const [packName, setPackName] = useState<string>(TELEGRAM_STICKER_PACKS[0].name);
  const [imageTab, setImageTab] = useState<string>("all"), [recentTab, setRecentTab] = useState(false);
  const [packTitle, setPackTitle] = useState(""), [stickers, setStickers] = useState<TelegramStickerChoice[]>([]);
  const [recentTelegram, setRecentTelegram] = useState<TelegramStickerChoice[]>([]), [recentImages, setRecentImages] = useState<ImageId[]>([]);
  const [extraPacks, setExtraPacks] = useState<Pack[]>([]), [customPack, setCustomPack] = useState("");
  const [showAdd, setShowAdd] = useState(false), [reload, setReload] = useState(0);
  const [layout, setLayout] = useState<StickerPanelLayout | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [scrollButtons, setScrollButtons] = useState({ back: false, next: false });
  const packs: Pack[] = [...TELEGRAM_STICKER_PACKS, ...extraPacks];

  function close(restoreFocus = false) {
    generation.current++; request.current?.abort(); setBusy(false); setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    generation.current++; request.current?.abort(); packCache.current.clear();
    setOpen(false); setBusy(false); setError(""); setQuery(""); setStickers([]); setPackTitle("");
    setRecentTelegram([]); setRecentImages([]); setCovers({}); setRecentTab(false); setShowAdd(false);
    setExtraPacks([]); setCustomPack(""); setPackName(TELEGRAM_STICKER_PACKS[0].name); setImageTab("all");
    return () => { generation.current++; request.current?.abort(); };
  }, [context]);
  useEffect(() => {
    if (disabled) { generation.current++; request.current?.abort(); setOpen(false); setBusy(false); }
  }, [disabled]);

  useEffect(() => {
    if (!open) { setLayout(null); return; }
    let frame = 0;
    const position = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
        const viewport = window.visualViewport;
        const next = stickerPanelLayout(anchor, { width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight, left: viewport?.offsetLeft, top: viewport?.offsetTop });
        setLayout(old => old && old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height ? old : next);
      });
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(true); };
    position();
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position); window.visualViewport?.addEventListener("scroll", position);
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position); window.visualViewport?.removeEventListener("scroll", position);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !telegram || recentTab || disabled) return;
    const seq = ++generation.current, expectedContext = context;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setError(""); setQuery("");
    const cached = packCache.current.get(packName);
    if (cached && Date.now() - cached.at < STICKER_PACK_CACHE_MS) {
      setStickers(cached.stickers); setPackTitle(cached.title); setBusy(false);
      return () => { controller.abort(); if (seq === generation.current) generation.current++; };
    }
    setBusy(true); setStickers([]); setPackTitle("");
    void (async () => {
      try {
        const response = await fetch(`/api/telegram/stickers?${new URLSearchParams({ conversationId, set: packName })}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        const pack = readStickerPack(data, packName, conversationId);
        if (!response.ok || !pack) throw new Error(typeof data?.error === "string" ? data.error : "Unable to load this sticker pack.");
        if (controller.signal.aborted || seq !== generation.current || current.current.context !== expectedContext) return;
        setStickers(pack.stickers); setPackTitle(pack.title);
        if (packCache.current.size >= 12) packCache.current.delete(packCache.current.keys().next().value as string);
        packCache.current.set(packName, { ...pack, at: Date.now() });
        const cover = pack.stickers.find(item => item.previewUrl)?.previewUrl;
        if (cover) setCovers(old => ({ ...old, [packName]: cover }));
      } catch (e) {
        if (seq === generation.current && !controller.signal.aborted && current.current.context === expectedContext) setError(e instanceof Error ? e.message : "Unable to load stickers.");
      } finally { if (seq === generation.current) setBusy(false); }
    })();
    return () => { controller.abort(); if (seq === generation.current) generation.current++; };
  }, [open, telegram, recentTab, disabled, context, conversationId, packName, reload]);

  function updateScrollButtons() {
    const element = strip.current; if (!element) return;
    const next = { back: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 };
    setScrollButtons(old => old.back === next.back && old.next === next.next ? old : next);
  }
  useEffect(() => {
    if (!open || !layout) return;
    updateScrollButtons();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollButtons) : null;
    if (strip.current) observer?.observe(strip.current);
    return () => observer?.disconnect();
  }, [open, layout, extraPacks.length, telegram]);

  function selectTab(name: string) {
    const selectedTab = recentTab ? "recent" : telegram ? packName : imageTab;
    if (name === selectedTab) { setShowAdd(false); setQuery(""); return; }
    generation.current++; request.current?.abort(); setBusy(false); setError(""); setQuery(""); setShowAdd(false);
    setRecentTab(name === "recent");
    if (name !== "recent") { if (telegram) setPackName(name); else setImageTab(name); }
  }
  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement); if (at < 0 || !buttons.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click(); buttons[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function addPack() {
    const name = normalizeStickerSetName(customPack);
    if (!name) { setError("Enter a pack name or its t.me/addstickers link."); return; }
    if (!packs.some(pack => pack.name.toLowerCase() === name.toLowerCase())) {
      if (extraPacks.length >= 6) { setError("Up to six extra packs can be loaded in this conversation session."); return; }
      setExtraPacks(items => [...items, { name, title: name, icon: "✨" }]);
    }
    selectTab(packs.find(pack => pack.name.toLowerCase() === name.toLowerCase())?.name || name); setCustomPack("");
    setReload(value => value + 1);
  }
  async function chooseImage(imageId: ImageId) {
    if (current.current.disabled || busy || !TENH_STICKERS.some(item => item.id === imageId)) return;
    const seq = ++generation.current, expectedContext = context;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/stickers/tenh/${imageId}.png`, { signal: controller.signal });
      if (!response.ok) throw new Error("Sticker could not be loaded. Please try again.");
      const blob = await response.blob();
      if (!blob.size || blob.size > 1024 * 1024 || !blob.type.startsWith("image/png")) throw new Error("Invalid sticker image.");
      if (controller.signal.aborted || generation.current !== seq || current.current.context !== expectedContext || current.current.disabled) return;
      onSelect(new File([blob], `tenh-${imageId}.png`, { type: "image/png" }));
      setRecentImages(items => rememberStickerChoice(items, imageId, item => item)); close(true);
    } catch (e) {
      if (generation.current === seq && !controller.signal.aborted && current.current.context === expectedContext) setError(e instanceof Error ? e.message : "Unable to load sticker.");
    } finally { if (generation.current === seq) setBusy(false); }
  }
  function chooseTelegram(item: TelegramStickerChoice) {
    if (current.current.disabled || current.current.context !== context || busy) return;
    onSelectTelegram?.(item); setRecentTelegram(items => rememberStickerChoice(items, item, value => `${value.setName}:${value.stickerId}`)); close(true);
  }

  const activeTab = recentTab ? "recent" : telegram ? packName : imageTab;
  const shownTelegram = (recentTab ? recentTelegram : stickers).filter(item => stickerMatchesSearch(query, item.label, item.emoji, item.setName, item.format));
  const imageItems = recentTab ? recentImages.flatMap(imageId => TENH_STICKERS.filter(item => item.id === imageId)) : TENH_STICKERS.filter(item => imageTab === "all" || item.id === imageTab);
  const shownImages = imageItems.filter(item => stickerMatchesSearch(query, item.label));
  const currentTitle = recentTab ? "Recent choices" : telegram ? packTitle || packs.find(pack => pack.name === packName)?.title || packName : imageTab === "all" ? "All stickers" : TENH_STICKERS.find(item => item.id === imageTab)?.label || "Stickers";
  const itemCount = telegram ? shownTelegram.length : shownImages.length;
  const tabs = [
    { key: "recent", title: "Recent choices", content: <Clock className="h-6 w-6" aria-hidden="true" /> },
    ...(telegram ? packs.map(pack => ({ key: pack.name, title: pack.title, content: <><span aria-hidden="true" className="text-2xl">{pack.icon}</span>{covers[pack.name] ? <img src={covers[pack.name]} alt="" className="absolute inset-1 h-9 w-9 rounded-lg bg-white object-contain" onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : null}</> })) : [
      { key: "all", title: "All TENH stickers", content: <Sticker className="h-6 w-6" aria-hidden="true" /> },
      ...TENH_STICKERS.map(item => ({ key: item.id, title: item.label, content: <img src={`/stickers/tenh/${item.id}.png`} alt="" className="h-9 w-9 object-contain" /> })),
    ]),
  ];

  return <div ref={root} className="relative shrink-0">
    <button ref={trigger} type="button" disabled={disabled} aria-label="Stickers" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-dialog`} title="Stickers" onClick={() => { if (open) close(); else { onOpen(); setOpen(true); setError(""); setQuery(""); } }} className={`flex h-9 w-9 items-center justify-center rounded-xl transition disabled:opacity-40 ${open ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-50"}`}><Sticker className="h-5 w-5" /></button>
    {open && layout ? createPortal(
      <div ref={panel} id={`${id}-dialog`} role="dialog" aria-label={telegram ? "Telegram stickers" : facebookOnline ? "Online sticker search" : "TENH image stickers"} style={layout} className="fixed z-[120] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-900">Stickers</h3><p className="text-[11px] text-slate-500">{telegram ? "Telegram packs" : facebookOnline ? "Stipop · online sticker search" : "TENH image library · not Facebook’s Sticker Store"}</p></div>
          {platform === "facebook" && onSendFacebook ? <div className="flex rounded-lg bg-slate-100 p-0.5 text-[10px]"><button type="button" onClick={() => setOnlineSource(true)} className={`rounded px-2 py-1 ${onlineSource ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"}`}>Online</button><button type="button" onClick={() => setOnlineSource(false)} className={`rounded px-2 py-1 ${!onlineSource ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"}`}>TENH</button></div> : null}
          <button type="button" aria-label="Close stickers" onClick={() => close(true)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {facebookOnline && onSendFacebook ? <StipopStickerGrid key={conversationId} conversationId={conversationId} disabled={disabled} onSend={onSendFacebook} onSent={() => close(true)} /> : <>
        <div className="relative mx-3 mb-2 shrink-0"><Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" /><input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this pack" aria-label="Search current sticker pack" className="h-9 w-full rounded-xl border-0 bg-slate-100 pr-8 pl-9 text-sm text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-300" />{query ? <button type="button" aria-label="Clear sticker search" onClick={() => { setQuery(""); searchInput.current?.focus(); }} className="absolute top-2 right-2 rounded p-0.5 text-slate-500"><X className="h-4 w-4" /></button> : null}</div>
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 text-xs"><span id={`${id}-pack-title`} className="truncate font-medium text-slate-600">{currentTitle}</span><span className="ml-2 text-slate-400">{busy ? "" : itemCount}</span></div>
        <div id={`${id}-grid`} role="tabpanel" aria-labelledby={`${id}-pack-title`} aria-busy={busy} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {busy && telegram && !recentTab ? <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading stickers…</div> :
            <div className="grid grid-cols-4 content-start gap-2">
              {telegram ? shownTelegram.map(item => <button key={`${item.setName}:${item.stickerId}`} type="button" disabled={busy || disabled} title={`${item.label} · ${item.format}`} aria-label={`Choose ${item.label}`} onClick={() => chooseTelegram(item)} className="relative flex aspect-square w-full items-center justify-center rounded-xl text-3xl transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40"><span aria-hidden="true">{item.emoji || "🙂"}</span>{item.previewUrl ? <img loading="lazy" src={item.previewUrl} alt="" className="absolute inset-0 h-full w-full rounded-xl bg-white object-contain p-1" onError={event => { event.currentTarget.style.display = "none"; }} /> : null}</button>) :
                shownImages.map(item => <button key={item.id} type="button" disabled={busy || disabled} aria-label={`Choose ${item.label}`} title={item.label} onClick={() => void chooseImage(item.id)} className="flex aspect-square w-full items-center justify-center rounded-xl transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40"><img src={`/stickers/tenh/${item.id}.png`} alt="" className="h-full w-full object-contain p-1" /></button>)}
              {!itemCount && !error ? <div className="col-span-4 px-3 py-10 text-center text-sm text-slate-400">{query ? "No matching stickers in this pack." : recentTab ? "Stickers you choose in this conversation appear here." : "No stickers available in this pack."}</div> : null}
            </div>}
          {error ? <div role="alert" className="my-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}{telegram && !recentTab ? <button type="button" onClick={() => { packCache.current.delete(packName); setReload(value => value + 1); }} className="ml-2 font-semibold underline">Retry pack</button> : null}</div> : null}
        </div>
        {showAdd && telegram ? <div className="shrink-0 border-t border-slate-100 px-3 py-2"><p className="mb-1 text-xs font-medium text-slate-600">Add Telegram pack</p><div className="flex gap-2"><input value={customPack} onChange={event => setCustomPack(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addPack(); } }} placeholder="Pack name or t.me/addstickers link" aria-label="Telegram sticker pack name or link" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2 text-xs" /><button type="button" onClick={addPack} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">Load</button></div></div> : null}
        <p className="shrink-0 px-4 pt-1 pb-2 text-[10px] text-slate-400">{telegram ? "Choose, then Send · native Telegram sticker · previews may be still images" : "Choose, then Send · delivered as an image, not a native Facebook sticker"}</p>
        <div className="flex shrink-0 items-center gap-1 border-t border-slate-200 bg-white px-2 py-2">
          {scrollButtons.back ? <button type="button" aria-label="Previous sticker packs" onClick={() => strip.current?.scrollBy({ left: -160, behavior: "smooth" })} className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button> : null}
          <div ref={strip} role="tablist" aria-label="Sticker packs" onKeyDown={navigateTabs} onScroll={updateScrollButtons} className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map(tab => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} aria-controls={`${id}-grid`} aria-label={tab.title} tabIndex={activeTab === tab.key ? 0 : -1} title={tab.title} onClick={() => selectTab(tab.key)} className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition focus-visible:outline-2 focus-visible:outline-blue-400 ${activeTab === tab.key ? "bg-blue-50 text-blue-600 after:absolute after:right-3 after:bottom-0 after:left-3 after:h-0.5 after:rounded-full after:bg-blue-600" : "text-slate-500 hover:bg-slate-50"}`}>{tab.content}</button>)}
          </div>
          <button type="button" aria-label="Next sticker packs" disabled={!scrollButtons.next} onClick={() => strip.current?.scrollBy({ left: 160, behavior: "smooth" })} className="shrink-0 rounded-full p-1.5 text-slate-500 shadow-sm hover:bg-slate-100 disabled:opacity-25"><ChevronRight className="h-5 w-5" /></button>
          {telegram ? <button type="button" aria-label="Add Telegram sticker pack" aria-expanded={showAdd} onClick={() => { setShowAdd(value => !value); setError(""); }} className={`shrink-0 rounded-xl p-2 ${showAdd ? "bg-blue-50 text-blue-600" : "text-slate-500 hover:bg-slate-100"}`}><Plus className="h-5 w-5" /></button> : null}
        </div>
        </>}
      </div>, document.body,
    ) : null}
  </div>;
}
