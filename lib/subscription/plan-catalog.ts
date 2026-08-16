export type PlanCode =
  | "mini"
  | "standard"
  | "pro";

export type BillingCycle =
  | "monthly"
  | "3-months"
  | "6-months"
  | "12-months";

export type PlanDefinition = {
  id: PlanCode;
  name: string;
  description: string;
  channels: number;
  users: number;
  monthlyPriceCents: number;
  oldMonthlyPriceCents?: number;
};

export type BillingCycleDefinition = {
  id: BillingCycle;
  label: string;
  months: number;
  discountBasisPoints: number;
};

export const TENH_PLANS: readonly PlanDefinition[] = [
  {
    id: "mini",
    name: "Mini",
    description: "For solo sellers and small shops",
    channels: 1,
    users: 3,
    monthlyPriceCents: 900,
    oldMonthlyPriceCents: 1200,
  },
  {
    id: "standard",
    name: "Standard",
    description: "For small customer-support teams",
    channels: 3,
    users: 5,
    monthlyPriceCents: 1900,
    oldMonthlyPriceCents: 2400,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing businesses and larger teams",
    channels: 6,
    users: 10,
    monthlyPriceCents: 4900,
    oldMonthlyPriceCents: 5900,
  },
] as const;

export const TENH_BILLING_CYCLES: readonly BillingCycleDefinition[] = [
  {
    id: "monthly",
    label: "Monthly",
    months: 1,
    discountBasisPoints: 0,
  },
  {
    id: "3-months",
    label: "3 months",
    months: 3,
    discountBasisPoints: 1000,
  },
  {
    id: "6-months",
    label: "6 months",
    months: 6,
    discountBasisPoints: 1800,
  },
  {
    id: "12-months",
    label: "12 months",
    months: 12,
    discountBasisPoints: 3000,
  },
] as const;

export function getPlanDefinition(
  planCode: string,
): PlanDefinition | null {
  return (
    TENH_PLANS.find(
      (plan) => plan.id === planCode,
    ) ?? null
  );
}

export function getBillingCycleDefinition(
  billingCycle: string,
): BillingCycleDefinition | null {
  return (
    TENH_BILLING_CYCLES.find(
      (cycle) => cycle.id === billingCycle,
    ) ?? null
  );
}

export function calculatePlanTotalCents(
  planCode: string,
  billingCycle: string,
): number | null {
  const plan = getPlanDefinition(planCode);
  const cycle =
    getBillingCycleDefinition(
      billingCycle,
    );

  if (!plan || !cycle) {
    return null;
  }

  const subtotalCents =
    plan.monthlyPriceCents *
    cycle.months;

  const discountCents = Math.round(
    (subtotalCents *
      cycle.discountBasisPoints) /
      10_000,
  );

  return Math.max(
    0,
    subtotalCents - discountCents,
  );
}

export function formatUsdFromCents(
  cents: number,
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
