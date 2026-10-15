"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

type Action = { label: string; onSelect?: () => void; href?: string; danger?: boolean };

export function IntegrationActionMenu({ name, disabled, actions }: {
  name: string;
  disabled: boolean;
  actions: Action[];
}) {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const label = isKhmer ? `សកម្មភាពសម្រាប់ ${name}` : `Actions for ${name}`;
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div ref={root} className="relative shrink-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (disabled) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}>
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      aria-disabled={disabled} onClick={() => { if (!disabled) setOpen(!open); }}
      className="flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500 aria-disabled:opacity-50">⋯</button>
    {open && !disabled ? <div role="menu" aria-label={label} className="absolute right-0 top-full z-50 mt-1 w-52 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
      {actions.map(action => {
        const props = { role: "menuitem", className: `flex min-h-11 w-full items-center rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-blue-500 ${action.danger ? "text-red-700 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"}`, onClick: () => { close(); action.onSelect?.(); } };
        return action.href ? <a key={action.label} href={action.href} {...props}>{action.label}</a>
          : <button key={action.label} type="button" {...props}>{action.label}</button>;
      })}
    </div> : null}
  </div>;
}
