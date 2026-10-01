"use client";

import { useEffect, useSyncExternalStore } from "react";

const pending = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
/** One ticket per real foreground operation. Cleanup is idempotent. */
export function beginForegroundLoading() {
  const ticket = Symbol();
  pending.add(ticket); notify();
  return () => { if (pending.delete(ticket)) notify(); };
}
export function useForegroundLoading(active: boolean) {
  useEffect(() => active ? beginForegroundLoading() : undefined, [active]);
}
export function useForegroundLoadingStatus() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => pending.size > 0, () => false);
}
