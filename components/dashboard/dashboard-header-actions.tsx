"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

type DashboardHeaderActionsProps = {
  children: ReactNode;
};

export function DashboardHeaderActions({
  children,
}: DashboardHeaderActionsProps) {
  const pathname = usePathname();

  if (pathname?.startsWith("/dashboard/integrations")) {
    return null;
  }

  return (
    <div className="ml-auto flex items-center gap-1">
      {children}
    </div>
  );
}
