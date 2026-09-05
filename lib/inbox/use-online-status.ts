"use client";

import { useEffect, useState } from "react";

/*
 * Whether the browser currently has a network connection.
 *
 * navigator.onLine is not a promise that requests will succeed -- it only says
 * the device has a route out, so a captive portal or a dead server still reads
 * as online. It is reliable in the direction that matters here: when it says
 * offline, nothing will get through, which is exactly when an agent needs to be
 * told before they type a reply that cannot be sent.
 *
 * `justReconnected` stays true briefly after coming back, so the interface can
 * say the connection returned rather than silently dropping the warning and
 * leaving the agent unsure whether anything was missed.
 */
export function useOnlineStatus() {
  /*
   * Starts optimistic. On the server there is no navigator, and rendering
   * "offline" for the first paint would flash a warning at everyone.
   */
  const [online, setOnline] = useState(true);
  const [justReconnected, setJustReconnected] =
    useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    /*
     * Read the real value once mounted. The initial state is optimistic
     * because the server has no navigator, so this is the first honest answer.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);

    let reconnectTimer: number | null = null;

    function handleOnline() {
      setOnline(true);
      setJustReconnected(true);

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      reconnectTimer = window.setTimeout(
        () => setJustReconnected(false),
        4000,
      );
    }

    function handleOffline() {
      setOnline(false);
      setJustReconnected(false);
    }

    window.addEventListener(
      "online",
      handleOnline,
    );
    window.addEventListener(
      "offline",
      handleOffline,
    );

    return () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      window.removeEventListener(
        "online",
        handleOnline,
      );
      window.removeEventListener(
        "offline",
        handleOffline,
      );
    };
  }, []);

  return { online, justReconnected };
}
