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
  cancel_at_period_end?: boolean | null;
  pending_plan_change_type?: string | null;
};

export type CustomUpgradeQuote = {
  quotedAt: string;
  currentConnections: number;
  currentUsers: number;
  targetConnections: number;
  targetUsers: number;
  currentBillingCycle: string;
  targetBillingCycle: string;
  extensionBillingCycle: string | null;
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
  paidTermSegments: PaidTermSegment[];
};

export type PaidTermSegment = {
  start_at: string;
  end_at: string;
  months: number;
  discount_basis_points: number;
  source_type: string;
  source_payment_id: string | null;
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
  extensionBillingCycle?: string | null;
  now?: Date;
}): CustomUpgradeQuote {
  const { subscription } = args;
  const now = args.now ?? new Date();
  const savedPricing = subscription.pricing_snapshot &&
    typeof subscription.pricing_snapshot === "object" &&
    !Array.isArray(subscription.pricing_snapshot)
    ? subscription.pricing_snapshot as Record<string, unknown>
    : {};
  if (subscription.cancel_at_period_end || subscription.pending_plan_change_type) {
    throw new Error("Resolve the scheduled subscription change before starting a Custom Upgrade.");
  }
  if (savedPricing.paid_term_basis_version !== 1 &&
      savedPricing.purchase_type === "custom-upgrade") {
    throw new Error("This subscription has combined paid terms. TENH must verify its paid-term pricing before another upgrade.");
  }
  const end = subscription.current_period_end ? new Date(subscription.current_period_end) : null;
  if (subscription.status !== "active" || !end || !Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) {
    throw new Error("Only an active subscription with remaining paid time can be upgraded.");
  }

  const currentCycle = getBillingCycleDefinition(subscription.billing_cycle ?? "");
  const targetCycle = getBillingCycleDefinition(args.targetBillingCycle);
  const extensionCode = (args.extensionBillingCycle ?? "").trim().toLowerCase();
  const extensionCycle = extensionCode && extensionCode !== "none"
    ? getBillingCycleDefinition(extensionCode)
    : null;
  if (!currentCycle || !targetCycle || (extensionCode && extensionCode !== "none" && !extensionCycle)) {
    throw new Error("Billing duration is not available for this upgrade.");
  }
  if (targetCycle.id !== (extensionCycle?.id ?? currentCycle.id)) {
    throw new Error("Renewal duration must match the selected extension or current duration.");
  }

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

  // Each original/added paid term retains its duration discount and actual
  // dates. The renewal preference must never replace the paid pricing basis.
  const periodStart = subscription.current_period_start
    ? new Date(subscription.current_period_start)
    : null;
  if (!periodStart || !Number.isFinite(periodStart.getTime()) || periodStart >= end) {
    throw new Error("TENH must verify the original paid period before this upgrade.");
  }
  let paidTermSegments: PaidTermSegment[];
  if (savedPricing.paid_term_basis_version === 1) {
    if (!Array.isArray(savedPricing.paid_term_segments) || savedPricing.paid_term_segments.length === 0) {
      throw new Error("TENH must verify the paid-term pricing basis before this upgrade.");
    }
    let expectedStart = periodStart.toISOString();
    paidTermSegments = savedPricing.paid_term_segments.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("TENH must verify the paid-term pricing basis before this upgrade.");
      }
      const segment = value as PaidTermSegment;
      const start = new Date(segment.start_at);
      const finish = new Date(segment.end_at);
      const segmentCycle = ["monthly", "3-months", "6-months", "12-months"]
        .map(getBillingCycleDefinition)
        .find((item) => item?.months === segment.months);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(finish.getTime()) ||
          start >= finish || start.toISOString() !== expectedStart ||
          !segmentCycle || segment.discount_basis_points !== segmentCycle.discountBasisPoints ||
          typeof segment.source_type !== "string" ||
          (segment.source_payment_id !== null && typeof segment.source_payment_id !== "string")) {
        throw new Error("TENH must verify the paid-term pricing basis before this upgrade.");
      }
      expectedStart = finish.toISOString();
      return { ...segment, start_at: start.toISOString(), end_at: finish.toISOString() };
    });
    if (expectedStart !== end.toISOString()) {
      throw new Error("TENH must verify the paid-term pricing basis before this upgrade.");
    }
  } else {
    // Only a single authoritative recorded subscription period can initialize
    // the basis. Mixed historical periods require verified payment recovery.
    paidTermSegments = [{
      start_at: periodStart.toISOString(), end_at: end.toISOString(),
      months: currentCycle.months, discount_basis_points: currentCycle.discountBasisPoints,
      source_type: "subscription-period", source_payment_id: null,
    }];
  }
  const capacityProrationCents = paidTermSegments.reduce((total, segment) => {
    const start = Date.parse(segment.start_at);
    const finish = Date.parse(segment.end_at);
    const remaining = Math.max(0, finish - Math.max(now.getTime(), start));
    const segmentCapacityCents = Math.round(
      addedMonthlyCents * segment.months * (10_000 - segment.discount_basis_points) / 10_000,
    );
    return total + Math.round(segmentCapacityCents * remaining / (finish - start));
  }, 0);

  const extensionMonths = extensionCycle?.months ?? 0;
  const discountMultiplier = (10_000 - (extensionCycle?.discountBasisPoints ?? 0)) / 10_000;
  const durationExtensionCents = Math.round(targetMonthlyCents * extensionMonths * discountMultiplier);
  const newPeriodEnd = addUtcMonths(end.toISOString(), extensionMonths);
  if (extensionCycle) paidTermSegments.push({
    start_at: end.toISOString(), end_at: newPeriodEnd,
    months: extensionCycle.months, discount_basis_points: extensionCycle.discountBasisPoints,
    source_type: "extension", source_payment_id: null,
  });
  const totalCents = capacityProrationCents + durationExtensionCents;
  if (totalCents <= 0) throw new Error("Increase connections, team users, or billing duration to upgrade.");

  const renewalTotalCents = Math.round(
    targetMonthlyCents *
      targetCycle.months *
      ((10_000 - targetCycle.discountBasisPoints) / 10_000),
  );

  return {
    quotedAt: now.toISOString(),
    currentConnections,
    currentUsers,
    targetConnections,
    targetUsers,
    currentBillingCycle: currentCycle.id,
    targetBillingCycle: targetCycle.id,
    extensionBillingCycle: extensionCycle?.id ?? null,
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
    newPeriodEnd,
    paidTermSegments,
  };
}
