"use client";

import { useEffect, useMemo, useRef } from "react";

/** Instance-local ownership only: no completed data or cross-workspace cache. */
export function useAnalyticsRequest() {
  const active = useRef<{ key: string; controller: AbortController; signal: AbortSignal; followUp?: () => void } | null>(null);
  const epoch = useRef(0);
  const followUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requests = useMemo(() => ({
    cancel() {
      active.current?.controller.abort();
      active.current = null;
      epoch.current++;
      if (followUpTimer.current !== null) clearTimeout(followUpTimer.current);
      followUpTimer.current = null;
    },
    start(key: string, silent = false, followUp?: () => void) {
      if (silent && document.visibilityState === "hidden") return null;
      if (active.current?.key === key && !active.current.signal.aborted) {
        if (silent) active.current.followUp = followUp;
        return null;
      }
      active.current?.controller.abort();
      if (followUpTimer.current !== null) clearTimeout(followUpTimer.current);
      followUpTimer.current = null;
      const version = ++epoch.current;
      const controller = new AbortController();
      const flight: NonNullable<typeof active.current> = { key, controller, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) };
      active.current = flight;
      return {
        signal: flight.signal,
        current: () => active.current === flight,
        finish: () => {
          if (active.current !== flight) return;
          active.current = null;
          // A live event during a read may be newer than its database snapshot.
          // Retain one trailing refresh, owned by this key and this mount.
          if (flight.followUp) followUpTimer.current = setTimeout(() => {
            followUpTimer.current = null;
            if (version === epoch.current && !active.current && document.visibilityState !== "hidden") flight.followUp?.();
          }, 120);
        },
      };
    },
  }), []);
  useEffect(() => () => requests.cancel(), [requests]);
  return requests;
}

/** Focus, resume and reconnect share one refresh; background tabs do no reads. */
export function useAnalyticsResume(load: (silent: boolean) => Promise<void>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (document.visibilityState === "hidden" || timer !== null) return;
      timer = setTimeout(() => { timer = null; void load(true); }, 120);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      } else schedule();
    };
    window.addEventListener("focus", schedule);
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load]);
}
