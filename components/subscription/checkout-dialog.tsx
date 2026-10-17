"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function CheckoutDialog({ open, busy, title, description, closeLabel, onClose, children }: {
  open: boolean; busy: boolean; title: string; description: string; closeLabel: string;
  onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current, previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    if (typeof element.showModal === "function") { if (!element.open) element.showModal(); }
    else element.setAttribute("open", "");
    element.focus();
    return () => {
      if (typeof element.close === "function") element.close(); else element.removeAttribute("open");
      document.body.style.overflowY = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialog} tabIndex={-1} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
    }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2*max(0.75rem,env(safe-area-inset-top),env(safe-area-inset-bottom)))] w-[calc(100%-1.5rem)] max-w-[572px] overflow-y-auto overscroll-contain rounded-3xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/45 backdrop:backdrop-blur-sm">
    <header className="sticky top-0 z-10 border-b border-slate-100 bg-white px-3.5 py-3.5 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-bold">{title}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label={closeLabel}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50">×</button>
      </div>
      <p id={descriptionId} className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
    </header>
    <div className="min-w-0 p-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:p-4" aria-busy={busy}>{children}</div>
  </dialog>;
}
