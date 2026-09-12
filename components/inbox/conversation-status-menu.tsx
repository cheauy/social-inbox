"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { statusOptions } from "./inbox-utils";
import type { ConversationStatus } from "@/types/inbox";

const statusDotClasses: Record<ConversationStatus, string> = {
  open: "bg-[#10B981]",
  pending: "bg-[#F59E0B]",
  resolved: "bg-[#0089CC]",
  closed: "bg-[#94A3B8]",
  spam: "bg-[#EF4444]",
};

export function ConversationStatusMenu({ value, disabled, label, statusLabel, onChange }: {
  value: ConversationStatus;
  disabled: boolean;
  label: string;
  statusLabel: (value: ConversationStatus, english: string) => string;
  onChange: (value: ConversationStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <div ref={root} className="relative" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    if (!open || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }}>
    <button ref={trigger} type="button" disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}
      className="flex h-10 min-w-[128px] items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-700 shadow-sm outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-wait disabled:opacity-50">
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${statusDotClasses[value]}`} />
        {statusLabel(value, statusOptions.find((option) => option.value === value)?.label ?? value)}
      </span>
      <ChevronDown size={15} />
    </button>
    {open && !disabled ? <div role="menu" aria-label={label} className="absolute right-0 top-full z-50 mt-2 min-w-[168px] space-y-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
      {statusOptions.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value}
        onClick={() => { setOpen(false); trigger.current?.focus(); onChange(option.value); }}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${value === option.value ? "bg-[#E0F2FE] font-semibold text-[#0089CC]" : "font-normal text-slate-700 hover:bg-slate-50"}`}>
        <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${statusDotClasses[option.value]}`} />
        {statusLabel(option.value, option.label)}
      </button>)}
    </div> : null}
  </div>;
}
