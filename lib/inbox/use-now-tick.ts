"use client";

import { useEffect, useState } from "react";

/*
 * A value that changes as time passes, so a memo can depend on "now".
 *
 * Three reminder forms decided whether Save could be pressed with a
 * useMemo comparing the chosen time against Date.now(). Date.now() cannot be
 * a dependency, so the answer was computed once and then frozen: pick a time
 * five minutes out, leave the form alone while you read the conversation, and
 * the button stayed enabled long after that time had passed. Pressing it sent
 * a past timestamp to the server, which correctly refused it with "Reminder
 * time must be in the future" -- about a time that had been in the future when
 * it was chosen, with nothing on the form to explain the change.
 *
 * Ticking makes the deadline part of the dependency list. The button now
 * disables itself when the moment passes, within one interval of it.
 *
 * Off by default so an idle form costs nothing: callers enable it only while a
 * time is actually chosen and the answer can still change.
 */
export function useNowTick(
  enabled: boolean,
  intervalMs = 15_000,
) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Re-read on wake as well as on the interval: a laptop that slept through
    // the deadline fires no timers while it is closed.
    const update = () => setNow(Date.now());

    update();

    const timer = window.setInterval(update, intervalMs);
    window.addEventListener("focus", update);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [enabled, intervalMs]);

  return now;
}
