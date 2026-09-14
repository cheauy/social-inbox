"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function DashboardNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  const props = { href, className: "tenh-dashboard-nav-link relative rounded-lg px-4 py-2 text-sm font-medium transition-colors", "aria-current": active ? "page" as const : undefined };
  // Preserve Inbox's intentional reload/reset behavior.
  return href === "/dashboard/inbox" ? <a {...props}>{children}</a> : <Link {...props}>{children}</Link>;
}
