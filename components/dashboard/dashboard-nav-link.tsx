"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardLinkProgress } from "./dashboard-loading-progress";

export function DashboardNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  const props = { href, className: "tenh-dashboard-nav-link relative rounded-lg px-4 py-2 text-sm font-medium transition-colors", "aria-current": active ? "page" as const : undefined };
  // Clicking Inbox while already there retains the explicit reset action.
  // Returning from another dashboard uses Next navigation and keeps its shell.
  return href === "/dashboard/inbox" && active ? <a {...props}>{children}</a> :
    <Link {...props} prefetch={href === "/dashboard/inbox" ? false : undefined}>{children}<DashboardLinkProgress /></Link>;
}
