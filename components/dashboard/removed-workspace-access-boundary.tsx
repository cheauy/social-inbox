"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { RemovedWorkspaceAccessShell } from "@/components/dashboard/removed-workspace-access-shell";

export function RemovedWorkspaceAccessBoundary({
  children,
  message,
}: {
  children: ReactNode;
  message: string;
}) {
  const pathname = usePathname();

  // A user whose membership was explicitly removed cannot open the old Inbox,
  // but they may still create and pay for a completely new TENH subscription.
  // The create-subscription endpoint authenticates the user independently and
  // assigns the new workspace as the active cookie only after it is created.
  const canOpenNewSubscriptionFlow =
    pathname === "/dashboard/subscription/buy" ||
    pathname.startsWith("/dashboard/subscription/buy/");

  if (canOpenNewSubscriptionFlow) {
    return <>{children}</>;
  }

  return <RemovedWorkspaceAccessShell message={message} />;
}
