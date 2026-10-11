"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

export function DashboardMobileMenu({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null);
  const isKhmer = useWorkspaceLanguageId() === "km";
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) root.current?.removeAttribute("open"); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <details ref={root} data-dashboard-mobile-menu className="relative mr-2" onKeyDown={event => {
    if (event.key === "Escape") { root.current?.removeAttribute("open"); root.current?.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={isKhmer ? "ម៉ឺនុយ" : "App menu"} className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl text-slate-600 focus-visible:outline-2 focus-visible:outline-blue-500"><Menu className="h-5 w-5" /></summary>
    <nav aria-label={isKhmer ? "ទំព័រ" : "App pages"} className="absolute left-0 top-12 z-[100] flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-slate-200 bg-white p-2 shadow-xl" onClick={event => {
      if ((event.target as HTMLElement).closest("a")) root.current?.removeAttribute("open");
    }}>{children}</nav>
  </details>;
}
