/*
 * A socket that went away versus a channel that will not work.
 *
 * Close code 1006 means the WebSocket ended without a close frame -- the
 * connection was taken from outside the app. In development that is normally
 * the dev server restarting or HMR reloading; in a browser it is a sleeping
 * laptop, a dropped network, or Realtime cycling an idle connection.
 * supabase-js reconnects on its own and the channel rejoins, and
 * scheduleRecoveryRefresh asks the server for one resync on top of that, so a
 * single one of these is a recovery in progress and not a fault.
 *
 * It was logged with console.error, which Next's dev overlay promotes into a
 * full red Console Error panel over the app -- an interruption that says
 * something is broken when nothing is. A transient close is a warning.
 *
 * Repetition is the part that matters. A socket that cannot stay up -- an
 * expired token, Realtime disabled on the project, a proxy killing WebSockets
 * -- produces the same 1006 over and over and never reaches SUBSCRIBED, and
 * that is a real failure. After three in a row without a successful
 * subscription in between it is logged as an error again.
 */
export const TRANSIENT_REALTIME_CLOSE_CODES = new Set([
  1000, 1001, 1005, 1006, 1012, 1013,
]);

export const TRANSIENT_ERRORS_BEFORE_ESCALATING = 3;

export function isTransientRealtimeError(
  error: unknown,
) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (!message) {
    return false;
  }

  if (/socket closed/i.test(message)) {
    const code = Number(
      message.match(/(\d{4})\s*$/)?.[1],
    );

    return (
      !Number.isFinite(code) ||
      TRANSIENT_REALTIME_CLOSE_CODES.has(code)
    );
  }

  return false;
}
