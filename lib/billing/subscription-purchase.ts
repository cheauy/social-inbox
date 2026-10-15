import "server-only";
import { calculatePlanTotalCents, calculateUpgradeTotalCents, getBillingCycleDefinition, getTrustedSubscriptionQuote } from "@/lib/subscription/plan-catalog";
import { buildCustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export type SubscriptionForQuote = {
  status: string;
  plan_code: string;
  billing_cycle: string | null;
  last_paid_amount: number | string | null;
  last_paid_currency: string | null;
  member_limit: number;
  channel_limit: number;
  pricing_version: string | null;
  pricing_snapshot: unknown;
  current_period_start: string | null;
  current_period_end: string | null;
  payment_provider: string | null;
  cancel_at_period_end?: boolean | null;
  pending_plan_change_type?: string | null;
};

export function getTrustedPlan(
  planCode: string,
  billingCycle: string,
  connections: unknown,
  users: unknown,
  renewSame: boolean,
  customUpgrade: boolean,
  extensionBillingCycle: unknown,
  subscription: SubscriptionForQuote,
) {
  let quote = getTrustedSubscriptionQuote({
    planCode,
    billingCycle,
    connections,
    users,
  });

  if (customUpgrade) {
    try {
      const upgrade = buildCustomUpgradeQuote({
        subscription,
        targetConnections: connections,
        targetUsers: users,
        targetBillingCycle: billingCycle,
        extensionBillingCycle: clean(extensionBillingCycle),
      });
      const cycle = getBillingCycleDefinition(billingCycle);
      if (!cycle || planCode !== "custom") return null;
      quote = {
        planCode: "custom",
        planName: "Custom Upgrade",
        channels: upgrade.targetConnections,
        users: upgrade.targetUsers,
        monthlyCents: upgrade.targetMonthlyCents,
        totalCents: upgrade.totalCents,
        pricingVersion: "v3.11.31.17",
        cycle,
      };
      return {
        plan: { id: "custom" as const, name: "Custom Upgrade", users: quote.users, channels: quote.channels },
        cycle,
        quote,
        renewSame: false,
        purchaseType: "custom-upgrade" as const,
        renewalTotalCents: upgrade.renewalTotalCents,
        upgradeFromPlanCode: subscription.plan_code,
        customUpgradeQuote: upgrade,
        amount: (upgrade.totalCents / 100).toFixed(2),
      };
    } catch {
      return null;
    }
  }

  if (renewSame) {
    const previousSnapshot =
      subscription.pricing_snapshot &&
      typeof subscription.pricing_snapshot === "object" &&
      !Array.isArray(subscription.pricing_snapshot)
        ? (subscription.pricing_snapshot as Record<string, unknown>)
        : {};
    const savedRenewalCents = Number(
      previousSnapshot.renewal_total_cents,
    );
    const savedAmount =
      Number.isFinite(savedRenewalCents) && savedRenewalCents > 0
        ? savedRenewalCents / 100
        : Number(subscription.last_paid_amount);
    const savedCycle = getBillingCycleDefinition(
      subscription.billing_cycle ?? "",
    );
    const currentPeriodEnd = subscription.current_period_end
      ? Date.parse(subscription.current_period_end)
      : Number.NaN;
    const eligibleStatus =
      subscription.status === "expired" ||
      subscription.status === "past_due" ||
      subscription.status === "cancelled" ||
      (subscription.status === "active" &&
        Number.isFinite(currentPeriodEnd) &&
        currentPeriodEnd <= Date.now());

    if (
      !eligibleStatus ||
      subscription.plan_code !== planCode ||
      subscription.billing_cycle !== billingCycle ||
      !savedCycle ||
      !Number.isFinite(savedAmount) ||
      savedAmount <= 0
    ) {
      return null;
    }

    if (planCode === "custom") {
      if (
        Number(connections) !== subscription.channel_limit ||
        Number(users) !== subscription.member_limit
      ) {
        return null;
      }
    }

    const previousMonthly = Number(previousSnapshot.monthly_cents);

    quote = {
      planCode: planCode as "mini" | "standard" | "pro" | "custom",
      planName:
        planCode === "custom"
          ? "Custom"
          : planCode.charAt(0).toUpperCase() + planCode.slice(1),
      channels: subscription.channel_limit,
      users: subscription.member_limit,
      monthlyCents:
        Number.isFinite(previousMonthly) && previousMonthly > 0
          ? Math.round(previousMonthly)
          : Math.round(savedAmount * 100),
      totalCents: Math.round(savedAmount * 100),
      pricingVersion: subscription.pricing_version || "renew-same",
      cycle: savedCycle,
    };
  }

  if (!quote) return null;

  let purchaseType: "subscription" | "upgrade" | "renew-same" =
    renewSame ? "renew-same" : "subscription";
  let renewalTotalCents = quote.totalCents;

  const paidPeriodActive =
    subscription.status === "active" &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now());

  if (!renewSame && paidPeriodActive) {
    const upgradeCharge = calculateUpgradeTotalCents(
      subscription.plan_code,
      quote.planCode,
      billingCycle,
    );

    if (upgradeCharge !== null) {
      renewalTotalCents =
        calculatePlanTotalCents(quote.planCode, billingCycle) ??
        quote.totalCents;
      quote = { ...quote, totalCents: upgradeCharge };
      purchaseType = "upgrade";
    }
  }

  return {
    plan: {
      id: quote.planCode,
      name: quote.planName,
      users: quote.users,
      channels: quote.channels,
    },
    cycle: quote.cycle,
    quote,
    renewSame,
    purchaseType,
    renewalTotalCents,
    upgradeFromPlanCode:
      purchaseType === "upgrade" ? subscription.plan_code : null,
    customUpgradeQuote: null,
    amount: (quote.totalCents / 100).toFixed(2),
  };
}

export function buildPurchaseRecord(requestId: string, businessId: string, memberId: string,
  trustedPlan: NonNullable<ReturnType<typeof getTrustedPlan>>, subscription: SubscriptionForQuote) {
  return {
          // The prepare trigger compares the complete server-read row under its lock.
          _expected_subscription: subscription,
          id: requestId,
          business_id: businessId,
          requested_by_member_id: memberId,
          plan_code: trustedPlan.plan.id,
          billing_cycle: trustedPlan.cycle.id,
          target_member_limit: trustedPlan.quote.users,
          target_channel_limit: trustedPlan.quote.channels,
          pricing_version: trustedPlan.quote.pricingVersion,
          renew_same: trustedPlan.renewSame,
          pricing_snapshot: {
            monthly_cents: trustedPlan.quote.monthlyCents,
            total_cents: trustedPlan.quote.totalCents,
            renewal_total_cents: trustedPlan.renewalTotalCents,
            purchase_type: trustedPlan.purchaseType,
            custom_upgrade: trustedPlan.purchaseType === "custom-upgrade",
            custom_upgrade_version: trustedPlan.customUpgradeQuote ? 2 : null,
            quoted_at: trustedPlan.customUpgradeQuote?.quotedAt ?? null,
            paid_term_basis_version: trustedPlan.customUpgradeQuote ? 1 : null,
            paid_term_segments: trustedPlan.customUpgradeQuote?.paidTermSegments ?? null,
            current_billing_cycle: trustedPlan.customUpgradeQuote?.currentBillingCycle ?? null,
            current_plan_code:
              trustedPlan.customUpgradeQuote
                ? subscription.plan_code
                : null,
            current_member_limit:
              trustedPlan.customUpgradeQuote
                ? subscription.member_limit
                : null,
            current_channel_limit:
              trustedPlan.customUpgradeQuote
                ? subscription.channel_limit
                : null,
            current_period_start:
              trustedPlan.customUpgradeQuote
                ? subscription.current_period_start
                : null,
            target_billing_cycle: trustedPlan.customUpgradeQuote?.targetBillingCycle ?? null,
            extension_billing_cycle:
              trustedPlan.customUpgradeQuote?.extensionBillingCycle ?? null,
            remaining_days: trustedPlan.customUpgradeQuote?.remainingDays ?? null,
            capacity_proration_cents: trustedPlan.customUpgradeQuote?.capacityProrationCents ?? null,
            extension_months: trustedPlan.customUpgradeQuote?.extensionMonths ?? null,
            duration_extension_cents: trustedPlan.customUpgradeQuote?.durationExtensionCents ?? null,
            current_period_end: trustedPlan.customUpgradeQuote?.currentPeriodEnd ?? null,
            new_period_end: trustedPlan.customUpgradeQuote?.newPeriodEnd ?? null,
            upgrade_from_plan_code: trustedPlan.upgradeFromPlanCode,
            upgrade_charge_cents:
              trustedPlan.purchaseType === "upgrade"
                ? trustedPlan.quote.totalCents
                : null,
            member_limit: trustedPlan.quote.users,
            channel_limit: trustedPlan.quote.channels,
            cycle: trustedPlan.quote.cycle.id,
            cycle_months: trustedPlan.quote.cycle.months,
            cycle_discount: trustedPlan.quote.cycle.discount,
            renew_same: trustedPlan.renewSame,
          },
          amount: trustedPlan.amount,
          currency: "USD",
        };
}
