import assert from "node:assert/strict";
import test from "node:test";
import { getFacebookMessengerWindowState } from "./messenger-window.ts";

const now = Date.parse("2026-09-07T12:00:00Z");
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const absent = Number.NaN;
const ago = (age) => now - age;

const cases = [
  ["today's DM stays open after a new comment", ago(hour), ago(1000), absent, "standard"],
  ["sending after the new comment does not lock an open chat", ago(hour), ago(2000), ago(1000), "standard"],
  ["just before 24 hours uses standard messaging", ago(day - 1), ago(2000), ago(1000), "standard"],
  ["at 24 hours uses the human agent path", ago(day), ago(2000), ago(1000), "human_agent"],
  ["six-day DM stays on human agent path after a comment", ago(6 * day), ago(2000), ago(1000), "human_agent"],
  ["just before seven days uses human agent path", ago(7 * day - 1), absent, absent, "human_agent"],
  ["at seven days the DM window expires", ago(7 * day), absent, ago(hour), "expired"],
  ["outgoing messages do not extend expired DM window", ago(8 * day), absent, ago(1000), "expired"],
  ["comment-only permits an initial private reply", absent, ago(hour), absent, "private_reply_available"],
  ["comment-only waits after a private reply", absent, ago(hour), ago(1000), "waiting_for_customer_reply"],
  ["customer DM after private reply opens normal chat", ago(1000), ago(hour), ago(2000), "standard"],
  ["expired DM with a fresh comment permits a private reply", ago(8 * day), ago(hour), ago(2 * hour), "private_reply_available"],
  ["expired DM waits after fresh comment private reply", ago(8 * day), ago(hour), ago(1000), "waiting_for_customer_reply"],
  ["seven-day-old comment cannot start a private reply", absent, ago(7 * day), absent, "expired"],
  ["comment just inside seven days permits private reply", absent, ago(7 * day - 1), absent, "private_reply_available"],
  ["old comments do not override a new customer DM", ago(hour), ago(8 * day), absent, "standard"],
  ["missing history remains unknown", absent, absent, absent, "unknown"],
  ["future DM cannot open the window", now + hour, absent, absent, "unknown"],
  ["future comment cannot open the window", absent, now + hour, absent, "unknown"],
];

for (const [name, incoming, comment, outgoing, expected] of cases) {
  test(name, () => {
    assert.equal(getFacebookMessengerWindowState(incoming, comment, outgoing, now), expected);
  });
}
