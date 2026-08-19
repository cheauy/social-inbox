import {
  TENH_CUSTOM_PRICING,
  calculateCapacityMonthlyCents,
  getBillingCycleDefinition,
  getPlanDefinition,
} from "@/lib/subscription/plan-catalog";

export type UpgradeSubscriptionSnapshot = {
  status: string;
  plan_code: string;
  billing_cycle: string | null;
  member_limit: number;
  channel_limit: number;
  current_period_start?: string | null;
  current_period_end: string | null;
  pricing_snapshot: unknown;
};

export type CustomUpgradeQuote = {
  currentConnections: number;
  currentUsers: number;
  targetConnections: number;
  targetUsers: number;
  currentBillingCycle: string;
  targetBillingCycle: string;
  currentMonths: number;
  targetMonths: number;
  remainingDays: number;
  addedMonthlyCents: number;
  currentMonthlyCents: number;
  targetMonthlyCents: number;
  capacityProrationCents: number;
  extensionMonths: number;
  durationExtensionCents: number;
  totalCents: number;
  renewalTotalCents: number;
  currentPeriodEnd: string;
  newPeriodEnd: string;
};

function addUtcMonths(value: string, months: number) {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) throw new Error("Invalid current subscription expiry date.");
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  const result = new Date(source.getTime());
  result.setUTCDate(1);
  result.setUTCFullYear(year);
  result.setUTCMonth(month + months);
  result.setUTCDate(Math.min(day, lastDay));
  return result.toISOString();
}

export function buildCustomUpgradeQuote(args: {
  subscription: UpgradeSubscriptionSnapshot;
  targetConnections: unknown;
  targetUsers: unknown;
  targetBillingCycle: string;
  now?: Date;
}): CustomUpgradeQuote {
  const { subscription } = args;
  const now = args.now ?? new Date();
  const end = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  if (subscription.status !== "active" || !end || !Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) {
    throw new Error("Only an active subscription with remaining paid time can be upgraded.");
  }

  const currentCycle = getBillingCycleDefinition(subscription.billing_cycle ?? "");
  const targetCycle = getBillingCycleDefinition(args.targetBillingCycle);
  if (!currentCycle || !targetCycle) throw new Error("Billing duration is not available for this upgrade.");
  if (targetCycle.months < currentCycle.months) throw new Error("Upgrade duration cannot be shorter than the current subscription duration.");

  const currentConnections = Number(subscription.channel_limit);
  const currentUsers = Number(subscription.member_limit);
  const targetConnections = Number(args.targetConnections);
  const targetUsers = Number(args.targetUsers);
  if (!Number.isInteger(targetConnections) || !Number.isInteger(targetUsers) ||
      targetConnections < currentConnections || targetUsers < currentUsers ||
      targetConnections > TENH_CUSTOM_PRICING.maxConnections || targetUsers > TENH_CUSTOM_PRICING.maxUsers) {
    throw new Error("Upgrade connections and team users can only stay the same or increase within TENH limits.");
  }

  // Price both the current and target capacity against today's TENH package
  // anchors. This prevents an older pricing snapshot from making an upgrade
  // more expensive than buying the same capacity today.
  let currentMonthlyCents: number;
  if (subscription.plan_code === "custom") {
    const currentCapacityPrice = calculateCapacityMonthlyCents(
      currentConnections,
      currentUsers,
    );
    if (currentCapacityPrice === null) {
      throw new Error("TENH could not determine the current custom subscription price.");
    }
    currentMonthlyCents = currentCapacityPrice;
  } else {
    const fixed = getPlanDefinition(subscription.plan_code);
    if (!fixed) throw new Error("TENH could not determine the current subscription price.");
    currentMonthlyCents = fixed.monthlyCents;
  }

  const targetMonthlyCents = calculateCapacityMonthlyCents(
    targetConnections,
    targetUsers,
  );
  if (targetMonthlyCents === null) {
    throw new Error("TENH could not determine the target custom subscription price.");
  }

  const addedMonthlyCents = Math.max(
    0,
    targetMonthlyCents - currentMonthlyCents,
  );
  const remainingMilliseconds = Math.max(1, end.getTime() - now.getTime());
  const remainingDays = Math.max(1, Math.ceil(remainingMilliseconds / 86_400_000));

  // Capacity upgrades inherit the discount of the customer's current paid
  // duration. Prorate against the actual paid period when its start date is
  // available so a full remaining 1-year term charges exactly the discounted
  // annual difference (for example $5/month -> $48/year at 20% off).
  const currentDiscountMultiplier =
    (10_000 - currentCycle.discountBasisPoints) / 10_000;
  const currentCycleCapacityCents = Math.round(
    addedMonthlyCents * currentCycle.months * currentDiscountMultiplier,
  );
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start)
    : null;
  const actualPeriodMilliseconds =
    periodStart &&
    Number.isFinite(periodStart.getTime()) &&
    periodStart.getTime() < end.getTime()
      ? end.getTime() - periodStart.getTime()
      : Math.round(
          currentCycle.months * (365.2425 / 12) * 86_400_000,
        );
  const capacityProrationCents = Math.round(
    currentCycleCapacityCents *
      Math.min(1, remainingMilliseconds / actualPeriodMilliseconds),
  );

  const extensionMonths = targetCycle.months - currentCycle.months;
  const discountMultiplier = (10_000 - targetCycle.discountBasisPoints) / 10_000;
  const durationExtensionCents = Math.round(targetMonthlyCents * extensionMonths * discountMultiplier);
  const totalCents = capacityProrationCents + durationExtensionCents;
  if (totalCents <= 0) throw new Error("Increase connections, team users, or billing duration to upgrade.");

  const renewalTotalCents = Math.round(
    targetMonthlyCents * targetCycle.months * discountMultiplier,
  );

  return {
    currentConnections,
    currentUsers,
    targetConnections,
    targetUsers,
    currentBillingCycle: currentCycle.id,
    targetBillingCycle: targetCycle.id,
    currentMonths: currentCycle.months,
    targetMonths: targetCycle.months,
    remainingDays,
    addedMonthlyCents,
    currentMonthlyCents,
    targetMonthlyCents,
    capacityProrationCents,
    extensionMonths,
    durationExtensionCents,
    totalCents,
    renewalTotalCents,
    currentPeriodEnd: end.toISOString(),
    newPeriodEnd: addUtcMonths(end.toISOString(), extensionMonths),
  };
}
