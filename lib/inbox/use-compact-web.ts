"use client";

import { useSyncExternalStore } from "react";

export const COMPACT_INBOX_QUERY = "(max-width: 1023px), (max-width: 1366px) and (pointer: coarse)";

function subscribe(listener: () => void) {
  if (!window.matchMedia) return () => {};
  const media = window.matchMedia(COMPACT_INBOX_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

export function useCompactInboxWeb() {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(COMPACT_INBOX_QUERY).matches ?? false, () => false);
}
