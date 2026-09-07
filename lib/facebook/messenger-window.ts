export type FacebookMessengerWindowState =
  | "standard"
  | "human_agent"
  | "expired"
  | "private_reply_available"
  | "waiting_for_customer_reply"
  | "unknown";

const DAY_MS = 24 * 60 * 60 * 1000;

// Shared by the composer and server policy. Comments never reset the DM clock.
export function getFacebookMessengerWindowState(
  latestDirectIncomingMs: number,
  latestIncomingCommentMs: number,
  latestDirectOutgoingMs: number,
  nowMs = Date.now(),
): FacebookMessengerWindowState {
  const directAge = nowMs - latestDirectIncomingMs;
  if (Number.isFinite(directAge) && directAge >= 0) {
    if (directAge < DAY_MS) return "standard";
    if (directAge < 7 * DAY_MS) return "human_agent";
  }

  const commentAge = nowMs - latestIncomingCommentMs;
  const newerComment =
    Number.isFinite(commentAge) && commentAge >= 0 &&
    (!Number.isFinite(latestDirectIncomingMs) ||
      latestIncomingCommentMs > latestDirectIncomingMs);

  if (newerComment) {
    if (commentAge >= 7 * DAY_MS) return "expired";
    if (Number.isFinite(latestDirectOutgoingMs) &&
        latestDirectOutgoingMs <= nowMs &&
        latestDirectOutgoingMs >= latestIncomingCommentMs) {
      return "waiting_for_customer_reply";
    }
    return "private_reply_available";
  }

  return Number.isFinite(directAge) && directAge >= 7 * DAY_MS
    ? "expired"
    : "unknown";
}
