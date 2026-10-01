"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, ShieldCheck } from "lucide-react";

const AdminNavigationContext = createContext<{ isAdmin: boolean; inboxMounted: boolean; setInboxMounted: (value: boolean) => void }>({
  isAdmin: false, inboxMounted: false, setInboxMounted: () => {},
});

export function DashboardUtilityNavigationProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const [inboxMounted, setInboxMounted] = useState(false);
  return <AdminNavigationContext.Provider value={{ isAdmin, inboxMounted, setInboxMounted }}>{children}</AdminNavigationContext.Provider>;
}

/** Navigation visibility only; the existing destination guards still authorize access. */
export function DashboardUtilityNavigation({ placement }: { placement: "inbox" | "analytics" | "shared" }) {
  const { isAdmin, inboxMounted, setInboxMounted } = useContext(AdminNavigationContext);
  const pathname = usePathname();
  const inSettings = pathname === "/dashboard/settings" || pathname?.startsWith("/dashboard/settings/");
  const inTenhBot = pathname === "/dashboard/tenh-bot" || pathname?.startsWith("/dashboard/tenh-bot/");
  const inAnalytics = pathname === "/dashboard/analytics" || pathname?.startsWith("/dashboard/analytics/");
  const inInbox = pathname === "/dashboard/inbox" || pathname?.startsWith("/dashboard/inbox/");
  useEffect(() => {
    if (placement !== "inbox" || !inInbox) return;
    setInboxMounted(true);
    return () => setInboxMounted(false);
  }, [placement, inInbox, setInboxMounted]);
  if (inSettings || inTenhBot || (placement === "shared" && (inboxMounted || inAnalytics)) || (placement === "inbox" && !inInbox) || (placement === "analytics" && !inAnalytics)) return null;
  const items = [{ label: "Settings", href: "/dashboard/settings", Icon: Settings },
    ...(isAdmin ? [{ label: "Admin", href: "/dashboard/admin", Icon: ShieldCheck }] : [])];
  return <nav aria-label="Settings and administration" data-dashboard-utility-navigation className={placement !== "shared" ? "mt-auto flex shrink-0 flex-col gap-1 px-2 pt-3" : "flex w-15 shrink-0 flex-col justify-end gap-1 border-r border-slate-200/70 bg-white px-2 py-3"}>
    {items.map(({ label, href, Icon }) => {
      const active = pathname === href || pathname?.startsWith(`${href}/`);
      return <Link key={href} href={href} aria-label={label} title={label} aria-current={active ? "page" : undefined} className={`group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${active ? "bg-blue-50 text-blue-600 after:pointer-events-none after:absolute after:-left-2 after:top-1/2 after:h-6 after:w-[3px] after:-translate-y-1/2 after:rounded-full after:bg-blue-600" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span className="pointer-events-none absolute left-full z-[150] ml-2 hidden whitespace-nowrap rounded-lg bg-slate-950 px-2 py-1 text-xs text-white group-hover:block group-focus-visible:block">{label}</span>
      </Link>;
    })}
  </nav>;
}
