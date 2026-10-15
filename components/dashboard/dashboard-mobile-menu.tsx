"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BarChart3, Menu, MessageSquare, X } from "lucide-react";
import { DashboardNavLink } from "./dashboard-nav-link";
import { DashboardNavigationLabel } from "./dashboard-navigation-label";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { useCompactInboxWeb } from "@/lib/inbox/use-compact-web";

export function DashboardMobileMenu({ children, notifications }: { children: ReactNode; notifications: ReactNode }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const compact = useCompactInboxWeb();
  const isKhmer = useWorkspaceLanguageId() === "km";
  const inMore = ["subscription", "integrations", "settings", "admin"].some(page => pathname === `/dashboard/${page}` || pathname?.startsWith(`/dashboard/${page}/`));
  useEffect(() => { drawer.current?.close(); }, [pathname, compact]);
  useEffect(() => {
    const dismiss = () => drawer.current?.close();
    window.addEventListener("popstate", dismiss);
    return () => window.removeEventListener("popstate", dismiss);
  }, []);
  const close = () => drawer.current?.close();
  return <>
    <nav data-dashboard-bottom-nav aria-label={isKhmer ? "ការរុករកកម្មវិធី" : "App navigation"}>
      <div data-compact-destination><DashboardNavLink href="/dashboard/inbox"><MessageSquare aria-hidden="true" /><DashboardNavigationLabel label="Inbox" /></DashboardNavLink></div>
      <div data-compact-destination><DashboardNavLink href="/dashboard/analytics"><BarChart3 aria-hidden="true" /><DashboardNavigationLabel label="Analytics" /></DashboardNavLink></div>
      {notifications}
      <button ref={trigger} data-compact-destination data-more-trigger type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls="dashboard-more-drawer" aria-current={inMore ? "page" : undefined}
        onClick={() => { drawer.current?.showModal(); setOpen(true); closeButton.current?.focus(); }}>
        <Menu aria-hidden="true" /><DashboardNavigationLabel label="More" />
      </button>
    </nav>
    <dialog ref={drawer} id="dashboard-more-drawer" data-dashboard-more-drawer aria-label={isKhmer ? "បន្ថែម" : "More"}
      onClose={() => { setOpen(false); trigger.current?.focus(); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key !== "Tab") return;
        const items = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-xl font-bold text-slate-950"><DashboardNavigationLabel label="More" /></h2>
        <button ref={closeButton} type="button" onClick={close} aria-label={isKhmer ? "បិទម៉ឺនុយ" : "Close More"} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"><X aria-hidden="true" /></button>
      </div>
      <nav aria-label={isKhmer ? "ទំព័របន្ថែម" : "More pages"} className="px-4 py-3" onClick={event => { if ((event.target as HTMLElement).closest("a")) close(); }}>{children}</nav>
    </dialog>
  </>;
}
