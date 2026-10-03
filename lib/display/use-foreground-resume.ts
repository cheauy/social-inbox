"use client";

import { useEffect } from "react";

/** Recover freshness once when a tab returns, without doing hidden reads. */
export function useForegroundResume(refresh: () => void) {
  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      if (document.visibilityState === "hidden" || timer !== null) return;
      timer = window.setTimeout(() => { timer = null; refresh(); }, 120);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
      } else schedule();
    };
    window.addEventListener("focus", schedule);
    window.addEventListener("online", schedule);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("online", schedule);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
}
