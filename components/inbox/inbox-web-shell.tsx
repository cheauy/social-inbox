"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useCompactInboxWeb } from "@/lib/inbox/use-compact-web";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

/** Presentation only: retained panes keep list anchors and composer ownership. */
export function InboxWebShell({ active, children }: { active: boolean; children: ReactNode }) {
  const compact = useCompactInboxWeb();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!compact) return;
    const node = root.current!;
    const viewport = window.visualViewport;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    node.dataset.standalone = String(standalone);
    const resize = () => {
      // A pinched media viewer must not resize the app underneath the gesture.
      if (viewport && viewport.scale !== 1) return;
      document.documentElement.style.setProperty("--tenh-inbox-height", `${viewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty("--tenh-inbox-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | undefined;
    let longPressed = false;
    const cancel = () => { clearTimeout(timer); start = undefined; };
    const select = (row: HTMLElement | null) => {
      node.querySelectorAll("[data-message-selected]").forEach(element => element.removeAttribute("data-message-selected"));
      node.querySelectorAll("[data-message-actions-visible]").forEach(element => element.removeAttribute("data-message-actions-visible"));
      row?.setAttribute("data-message-selected", "true");
      row?.querySelectorAll<HTMLElement>("[data-message-action-toolbar], [data-comment-actions]").forEach(element => {
        if (element.closest("[data-message-row]") === row) {
          element.setAttribute("data-message-actions-visible", "true");
          element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        }
      });
    };
    const pointerDown = (event: PointerEvent) => {
      cancel();
      longPressed = false;
      if (!event.isPrimary) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-message-row]");
      if (target.closest("a, input, textarea, select, video, audio, [data-media-viewer], [data-message-action-toolbar], [data-comment-actions]")) return;
      if (!row) { select(null); return; }
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        if (!row.isConnected || !node.contains(row)) return;
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }));
        select(row); start = undefined; longPressed = true;
      }, 450);
    };
    const pointerMove = (event: PointerEvent) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel();
    };
    const click = (event: MouseEvent) => {
      if (longPressed) { event.preventDefault(); event.stopPropagation(); longPressed = false; return; }
      const target = event.target as HTMLElement;
      if (!target.closest("button, a, input, textarea, select, video, audio, [data-media-viewer]")) select(target.closest("[data-message-row]"));
    };
    const context = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>("[data-message-row]");
      if (row && !target.closest("a, input, textarea, [data-media-viewer]")) { event.preventDefault(); select(row); }
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") select(null); };
    const focus = (event: FocusEvent) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-message-row]");
      if (row) select(row);
    };
    const constrainZoom = (event: Event) => {
      // shortcut: iOS may ignore zoom restrictions; physical-device verification is required.
      if (standalone && !(event.target as HTMLElement).closest("[data-media-viewer]")) event.preventDefault();
    };
    node.addEventListener("pointerdown", pointerDown);
    node.addEventListener("pointermove", pointerMove);
    node.addEventListener("pointerup", cancel);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("scroll", cancel, true);
    node.addEventListener("click", click, true);
    node.addEventListener("focusin", focus);
    node.addEventListener("contextmenu", context);
    node.addEventListener("keydown", key);
    node.addEventListener("gesturestart", constrainZoom, { passive: false });
    return () => {
      cancel();
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      node.removeEventListener("pointerdown", pointerDown);
      node.removeEventListener("pointermove", pointerMove);
      node.removeEventListener("pointerup", cancel);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("scroll", cancel, true);
      node.removeEventListener("click", click, true);
      node.removeEventListener("focusin", focus);
      node.removeEventListener("contextmenu", context);
      node.removeEventListener("keydown", key);
      node.removeEventListener("gesturestart", constrainZoom);
      document.documentElement.style.removeProperty("--tenh-inbox-height");
      document.documentElement.style.removeProperty("--tenh-inbox-top");
    };
  }, [compact]);

  return <div ref={root} data-inbox-shell data-chat-active={active} className="relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.06)]">{children}</div>;
}

export function InboxCustomerSheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const compact = useCompactInboxWeb();
  const isKhmer = useWorkspaceLanguageId() === "km";
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!compact) return;
    const node = panel.current!;
    const previous = document.activeElement as HTMLElement | null;
    node.querySelector<HTMLElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      const dialog = (event.target as HTMLElement).closest("[role='dialog'], [role='alertdialog']");
      if (dialog && dialog !== node) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab") return;
      // Nested existing dialogs/pickers manage their own controls.
      const controls = [...node.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex='0']")].filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    node.addEventListener("keydown", key);
    return () => { node.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, [compact]);
  return <div ref={panel} data-inbox-customer-sheet role={compact ? "dialog" : undefined} aria-modal={compact || undefined} aria-label={isKhmer ? "ព័ត៌មានអតិថិជន" : "Customer details"} className="h-full min-h-0">
    <button type="button" data-inbox-sheet-close onClick={onClose} aria-label={isKhmer ? "បិទព័ត៌មានអតិថិជន" : "Close customer details"}>×</button>
    {children}
  </div>;
}
