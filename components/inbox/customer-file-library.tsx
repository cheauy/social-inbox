"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Images, Link2, Play, X } from "lucide-react";

export type LibraryTab = "media" | "files" | "links";
export type LibraryItem = {
  id: string;
  kind: "image" | "video" | "audio" | "file" | "link";
  name: string;
  url: string | null;
  createdAt: string;
  detail: string;
  savedId?: string;
  conversationId?: string | null;
};
const tabs = [
  { id: "media" as const, label: "Photos & videos", Icon: Images },
  { id: "files" as const, label: "Files", Icon: FileText },
  { id: "links" as const, label: "Links", Icon: Link2 },
];
const category = (item: LibraryItem): LibraryTab => item.kind === "image" || item.kind === "video" ? "media" : item.kind === "link" ? "links" : "files";
const actionClass = "rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#0089CC] hover:bg-[#EAF7FF] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50";

function MediaViewer({ item, close }: { item: LibraryItem; close: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
      if (event.key === "Tab") {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button, video[controls]') ?? []);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); previous?.focus(); };
  }, [close]);
  return <div role="dialog" aria-modal="true" aria-label={item.kind === "video" ? "Video preview" : "Photo preview"} className="fixed inset-0 z-[160] flex items-center justify-center bg-[#08101C]/95 p-5 sm:p-12" onClick={close}>
    {item.kind === "video" ? <video src={item.url!} controls autoPlay className="max-h-[85dvh] max-w-full" onClick={(event) => event.stopPropagation()} />
      : <img src={item.url!} alt={item.name} className="max-h-[85dvh] max-w-full object-contain" onClick={(event) => event.stopPropagation()} />}
    <button ref={closeRef} type="button" onClick={close} aria-label="Close preview" className="absolute right-5 top-5 rounded-full bg-white/15 p-2.5 text-white hover:bg-white/25"><X size={22} /></button>
  </div>;
}

export function CustomerFileLibrary({ items, tab, onTab, loading, deletingId, onDelete, onDownload }: {
  items: LibraryItem[];
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  loading: boolean;
  deletingId: string | null;
  onDelete: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const shown = items.filter((item) => category(item) === tab).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const months = new Map<string, LibraryItem[]>();
  for (const item of shown) {
    const at = new Date(item.createdAt);
    const month = Number.isFinite(at.getTime()) ? at.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "Earlier";
    months.set(month, [...(months.get(month) ?? []), item]);
  }

  function actions(item: LibraryItem) {
    return <div className="flex flex-wrap items-center gap-1">
      {item.savedId ? <>
        {item.kind !== "link" ? <button type="button" onClick={() => onDownload(item.savedId!)} className={actionClass}>Download</button> : null}
        <button type="button" disabled={deletingId === item.savedId} onClick={() => onDelete(item.savedId!)} className={`${actionClass} !text-red-600`}>{deletingId === item.savedId ? "Deleting…" : "Delete"}</button>
      </> : item.conversationId ? <a href={`/dashboard/inbox?conversation=${encodeURIComponent(item.conversationId)}`} className={actionClass}>Conversation</a> : null}
    </div>;
  }

  return <>
    <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-[#E3EAF2] px-5 py-3" aria-label="File categories">
      {tabs.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => onTab(id)} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 transition-colors ${tab === id ? "bg-[#EAF7FF] text-[#0089CC]" : "bg-[#F6F8FC] text-[#6D7E91] hover:bg-slate-100"}`}>
        <Icon size={19} /><span className="text-xs font-bold">{label}</span><span className="text-[11px] text-[#6D7E91]">{loading ? "—" : items.filter((item) => category(item) === id).length}</span>
      </button>)}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5" aria-busy={loading}>
      {loading ? <div className="mt-5 grid grid-cols-3 gap-2 motion-safe:animate-pulse" role="status" aria-label="Loading customer files">{Array.from({ length: 9 }, (_, index) => <div key={index} className="aspect-square rounded-xl bg-[#E3EAF2]" />)}</div>
        : shown.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-[#6D7E91]"><FolderOpen size={32} /><p className="text-sm">{tab === "media" ? "No photos or videos from this customer yet." : tab === "files" ? "No documents have been sent or saved." : "No links have been saved for this customer."}</p></div>
          : Array.from(months, ([month, entries]) => <section key={month} className="mt-5">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#6D7E91]">{month}</h3>
            <div className={tab === "media" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "divide-y divide-[#E3EAF2] overflow-hidden rounded-2xl border border-[#E3EAF2]"}>
              {entries.map((item) => tab === "media" ? <article key={item.id} className="overflow-hidden rounded-xl border border-[#E3EAF2] bg-white">
                <button type="button" disabled={!item.url} onClick={() => setPreview(item)} aria-label={`View ${item.kind}: ${item.name}`} className="relative block aspect-square w-full overflow-hidden bg-[#F6F8FC] disabled:opacity-50">
                  {item.kind === "image" && item.url ? <img src={item.url} alt={item.name} loading="lazy" className="h-full w-full object-cover" /> : item.url ? <video src={item.url} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : <Images className="mx-auto text-[#6D7E91]" />}
                  {item.kind === "video" ? <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/50 p-3 text-white"><Play size={20} fill="currentColor" /></span></span> : null}
                </button>
                <div className="px-1 py-1.5">{actions(item)}</div>
              </article> : <article key={item.id} className="flex flex-wrap items-center gap-3 bg-white p-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EAF7FF] text-[#0089CC]">{item.kind === "link" ? <Link2 size={21} /> : <FileText size={21} />}</span>
                <div className="min-w-0 flex-1">
                  {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="block break-words text-sm font-semibold text-[#102238] hover:text-[#0089CC]">{item.name}</a> : <p className="break-words text-sm font-semibold text-[#102238]">{item.name}</p>}
                  {item.kind === "link" && item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-xs text-[#0089CC]">{item.url}</a> : null}
                  <p className="mt-1 text-xs text-[#6D7E91]">{item.detail}</p>
                  {item.kind === "audio" && item.url ? <audio src={item.url} controls preload="metadata" className="mt-2 w-full max-w-xs" /> : null}
                </div>
                {actions(item)}
              </article>)}
            </div>
          </section>)}
    </div>
    {preview ? <MediaViewer item={preview} close={() => setPreview(null)} /> : null}
  </>;
}
