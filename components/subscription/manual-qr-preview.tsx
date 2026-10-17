"use client";

import { useEffect, useId, useRef } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

export function ManualQrPreview({ open, src, onClose }: { open: boolean; src: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const km = useWorkspaceLanguageId() === "km";
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    // The transfer dialog owns the body scroll lock for both dialogs' lifetimes.
    if (typeof element.showModal === "function") { if (!element.open) element.showModal(); }
    else element.setAttribute("open", "");
    close.current?.focus({ preventScroll: true });
    return () => {
      if (typeof element.close === "function") element.close(); else element.removeAttribute("open");
      const parent = previous?.closest("dialog");
      if (previous?.isConnected && (!parent || parent.open)) previous.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialog} tabIndex={-1} aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") { event.preventDefault(); event.stopPropagation(); close.current?.focus(); }
    }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2*max(0.75rem,env(safe-area-inset-top),env(safe-area-inset-bottom)))] w-[calc(100%-1.5rem)] max-w-4xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60">
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2">
      <h2 id={titleId} className="min-w-0 text-base font-bold">{km ? "QR សម្រាប់ផ្ទេរប្រាក់តាមធនាគារ" : "Manual transfer QR code"}</h2>
      <button ref={close} type="button" onClick={onClose} aria-label={km ? "បិទការមើល QR" : "Close QR preview"}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">×</button>
    </header>
    <div className="bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- Preserve the complete configured bank image and its QR margins. */}
      <img src={src} alt={km ? "រូបភាព QR ផ្ទេរប្រាក់ពេញលេញ" : "Full manual bank transfer QR image"}
        className="mx-auto block h-auto max-h-[calc(100dvh-9rem)] w-auto max-w-full object-contain" />
    </div>
  </dialog>;
}
