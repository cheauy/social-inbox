const DEFAULT_TIMEZONE = "Asia/Phnom_Penh";

/** Calendar-day boundary, including seconds and timezone offset changes.
 * Invalid configuration falls back to Cambodia rather than a rolling day. */
export function facebookRecoveryDay(nowMs = Date.now(), requestedZone = process.env.TENH_TIMEZONE?.trim() || DEFAULT_TIMEZONE) {
  let timeZone = requestedZone;
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { timeZone = DEFAULT_TIMEZONE; format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }); }
  const endMs = Math.floor(nowMs);
  const day = format.format(endMs);
  let before = endMs - 36 * 60 * 60_000, startMs = endMs;
  while (startMs - before > 1) {
    const middle = Math.floor((before + startMs) / 2);
    if (format.format(middle) === day) startMs = middle;
    else before = middle;
  }
  return { startMs, endMs, timeZone };
}
