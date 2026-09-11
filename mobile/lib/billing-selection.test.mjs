import test from "node:test";
import assert from "node:assert/strict";
import { renewalSelection, matchesUpgradeQuote } from "./billing-selection.ts";

const now = Date.parse("2026-09-11T06:00:00Z");
const subscription = {
  status: "expired", plan_code: "custom", billing_cycle: "3-months",
  current_period_end: "2026-09-10T06:00:00Z",
  last_paid_amount: 12.5, pricing_snapshot: { renewal_total_cents: 9876 },
  channel_limit: 9, member_limit: 7,
};

test("reactivation keeps the saved renewal price, duration and custom capacity after an upgrade", () => {
  assert.deepEqual(renewalSelection(subscription, true, now), {
    amount: 9876, planCode: "custom", billingCycle: "3-months", connections: 9, users: 7,
  });
});

test("older paid subscriptions fall back to the last paid amount", () => {
  assert.equal(renewalSelection({ ...subscription, pricing_snapshot: null }, true, now).amount, 1250);
  assert.equal(renewalSelection({ ...subscription, pricing_snapshot: { renewal_total_cents: Infinity } }, true, now).amount, 1250);
});

test("only an owner of an expired paid subscription can reactivate", () => {
  assert.equal(renewalSelection(subscription, false, now), null);
  for (const status of ["trialing", "suspended", "unmanaged"]) {
    assert.equal(renewalSelection({ ...subscription, status }, true, now), null);
  }
  assert.equal(renewalSelection({ ...subscription, status: "active", current_period_end: "2026-09-12T06:00:00Z" }, true, now), null);
  assert.ok(renewalSelection({ ...subscription, status: "active", current_period_end: new Date(now).toISOString() }, true, now));
});

test("missing or invalid saved payment details never become a payable renewal", () => {
  for (const change of [
    { pricing_snapshot: null, last_paid_amount: null },
    { pricing_snapshot: null, last_paid_amount: NaN },
    { plan_code: "trial" }, { billing_cycle: "unknown" },
    { channel_limit: null }, { member_limit: 1.5 },
  ]) assert.equal(renewalSelection({ ...subscription, ...change }, true, now), null);
});

test("an upgrade quote cannot be reused after capacity or duration changes", () => {
  const quote = { targetConnections: 12, targetUsers: 8, targetBillingCycle: "6-months", totalCents: 1450 };
  assert.equal(matchesUpgradeQuote(quote, 12, 8, "6-months"), true);
  assert.equal(matchesUpgradeQuote(quote, 13, 8, "6-months"), false);
  assert.equal(matchesUpgradeQuote(quote, 12, 9, "6-months"), false);
  assert.equal(matchesUpgradeQuote(quote, 12, 8, "12-months"), false);
  assert.equal(matchesUpgradeQuote(null, 12, 8, "6-months"), false);
  for (const totalCents of [0, -10, NaN, Infinity]) {
    assert.equal(matchesUpgradeQuote({ ...quote, totalCents }, 12, 8, "6-months"), false);
  }
});
