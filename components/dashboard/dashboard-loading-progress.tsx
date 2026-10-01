"use client";

import { useLinkStatus } from "next/link";
import { useForegroundLoading, useForegroundLoadingStatus } from "@/lib/display/foreground-loading";

export function DashboardLinkProgress() {
  const { pending } = useLinkStatus();
  useForegroundLoading(pending);
  return null;
}
export function DashboardLoadingProgress() {
  const pending = useForegroundLoadingStatus();
  return pending ? <span role="progressbar" aria-label="Loading" className="tenh-header-progress pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[3px]" /> : null;
}
