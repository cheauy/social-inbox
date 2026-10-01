"use client";

import { useForegroundLoading } from "@/lib/display/foreground-loading";

export default function DashboardLoading() {
  useForegroundLoading(true);
  return <div role="status" className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">Loading…</div>;
}
