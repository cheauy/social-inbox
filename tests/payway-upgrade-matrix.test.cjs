/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test or draft-generator harness. */
// Synthetic pricing regressions; no database, provider, or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const { buildCustomUpgradeQuote } = loader()('lib/subscription/custom-upgrade.ts');
const terms = [
  { code: 'monthly', months: 1, multiplier: 1 },
  { code: '3-months', months: 3, multiplier: .95 },
  { code: '6-months', months: 6, multiplier: .9 },
  { code: '12-months', months: 12, multiplier: .8 },
];
const changes = [
  { name: 'User only', users: 2, connections: 3, monthly: 1600, difference: 300 },
  { name: 'Connection only', users: 1, connections: 4, monthly: 1700, difference: 400 },
  { name: 'User and Connection', users: 2, connections: 4, monthly: 2000, difference: 700 },
];
const date = months => new Date(Date.UTC(2026, months, 1)).toISOString();
for (const original of terms) for (const change of changes) for (const extension of [null, ...terms]) {
  test(`${original.code}: ${change.name}, ${extension?.code ?? 'keep expiry'} retains paid days and discount`, () => {
    const start = date(0), end = date(original.months);
    const now = new Date((Date.parse(start) + Date.parse(end)) / 2);
    const subscription = {
      status: 'active', plan_code: 'mini', billing_cycle: original.code,
      member_limit: 1, channel_limit: 3, current_period_start: start,
      current_period_end: end, pricing_snapshot: {},
    };
    const untouched = JSON.stringify(subscription);
    const result = buildCustomUpgradeQuote({ subscription, now,
      targetConnections: change.connections, targetUsers: change.users,
      targetBillingCycle: extension?.code ?? original.code,
      extensionBillingCycle: extension?.code ?? null });
    const proration = Math.round(Math.round(change.difference * original.months * original.multiplier) / 2);
    const duration = extension ? Math.round(change.monthly * extension.months * extension.multiplier) : 0;
    assert.equal(result.capacityProrationCents, proration);
    assert.equal(result.durationExtensionCents, duration);
    assert.equal(result.totalCents, proration + duration);
    assert.equal(result.currentPeriodEnd, end);
    assert.equal(result.newPeriodEnd, date(original.months + (extension?.months ?? 0)));
    assert.equal(result.quotedAt, now.toISOString());
    assert.equal(result.paidTermSegments[0].months, original.months);
    assert.equal(result.paidTermSegments[0].discount_basis_points, Math.round((1 - original.multiplier) * 10000));
    assert.equal(JSON.stringify(subscription), untouched);
  });
}
for (const original of terms) for (const extension of terms) {
  test(`${original.code}: months only +${extension.months} starts at existing expiry`, () => {
    const start = date(0), end = date(original.months);
    const result = buildCustomUpgradeQuote({
      subscription: { status: 'active', plan_code: 'mini', billing_cycle: original.code,
        member_limit: 1, channel_limit: 3, current_period_start: start,
        current_period_end: end, pricing_snapshot: {} },
      now: new Date((Date.parse(start) + Date.parse(end)) / 2),
      targetConnections: 3, targetUsers: 1, targetBillingCycle: extension.code,
      extensionBillingCycle: extension.code,
    });
    assert.equal(result.capacityProrationCents, 0);
    assert.equal(result.totalCents, Math.round(1300 * extension.months * extension.multiplier));
    assert.equal(result.paidTermSegments[1].start_at, end);
    assert.equal(result.newPeriodEnd, date(original.months + extension.months));
  });
}
