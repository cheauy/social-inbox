"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardLinkProgress } from "./dashboard-loading-progress";
import { useInboxReturnHref } from "./inbox-return-context";

export function DashboardNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  const returnHref = useInboxReturnHref();
  const destination = href === "/dashboard/inbox" && !active ? returnHref : href;
  const props = { href, className: "tenh-dashboard-nav-link relative rounded-lg px-4 py-2 text-sm font-medium transition-colors", "aria-current": active ? "page" as const : undefined };
  return <Link {...props} href={destination} prefetch={href === "/dashboard/inbox" ? false : undefined}
    onNavigate={href === "/dashboard/inbox" && active ? event => event.preventDefault() : undefined}>
    {children}<DashboardLinkProgress />
  </Link>;
}
