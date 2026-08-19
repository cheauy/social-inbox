export type FixedPlanCode = "mini" | "standard" | "pro";
export type PlanCode = FixedPlanCode | "custom";
export type BillingCycle =
  | "monthly"
  | "3-months"
  | "6-months"
  | "12-months";

export type TenhPlanDefinition = {
  id: FixedPlanCode;
  name: string;
  description: string;
  channels: number;
  users: number;
  monthlyCents: number;
};

export type BillingCycleDefinition = {
  id: BillingCycle;
  label: string;
  months: number;
  /** Decimal discount used by pricing math (0.05 = 5%). */
  discount: number;
  /** Basis points retained for the existing Subscription UI. */
  discountBasisPoints: number;
};

export const TENH_PLANS: TenhPlanDefinition[] = [
  {
    id: "mini",
    name: "Standard",
    description: "For solo sellers and small shops getting started with TENH.",
    channels: 3,
    users: 1,
    monthlyCents: 1300,
  },
  {
    id: "standard",
    name: "Team",
    description: "For small teams managing several Pages, Bots, and Agents.",
    channels: 5,
    users: 3,
    monthlyCents: 2500,
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing support teams with more channels and agents.",
    channels: 12,
    users: 8,
    monthlyCents: 5900,
  },
];

export const TENH_BILLING_CYCLES: BillingCycleDefinition[] = [
  { id: "monthly", label: "1 Month", months: 1, discount: 0, discountBasisPoints: 0 },
  { id: "3-months", label: "3 Months", months: 3, discount: 0.05, discountBasisPoints: 500 },
  { id: "6-months", label: "6 Months", months: 6, discount: 0.1, discountBasisPoints: 1000 },
  { id: "12-months", label: "1 Year", months: 12, discount: 0.2, discountBasisPoints: 2000 },
];

export const TENH_CUSTOM_PRICING = {
  version: "v3.11.31.21",
  baseMonthlyCents: 1300,
  includedConnections: 3,
  includedUsers: 1,
  extraConnectionCents: 400,
  extraUserCents: 300,
  minConnections: 3,
  maxConnections: 30,
  minUsers: 1,
  maxUsers: 100,
} as const;

export function getPlanDefinition(value: string | null | undefined) {
  const code = (value ?? "").trim().toLowerCase();

  if (code === "custom") {
    return {
      id: "custom" as const,
      name: "Custom",
      description: "Build a TENH plan with your own connection and user limits.",
      channels: 0,
      users: 0,
      monthlyCents: 0,
    };
  }

  return TENH_PLANS.find((plan) => plan.id === code) ?? null;
}

export function getBillingCycleDefinition(value: string | null | undefined) {
  const code = (value ?? "").trim().toLowerCase();
  return TENH_BILLING_CYCLES.find((cycle) => cycle.id === code) ?? null;
}

function discountedTotalCents(monthlyCents: number, cycle: BillingCycleDefinition) {
  const gross = monthlyCents * cycle.months;
  return Math.round(gross * (1 - cycle.discount));
}

export function calculatePlanTotalCents(
  planCode: string,
  billingCycle: string,
): number | null {
  const plan = TENH_PLANS.find((item) => item.id === planCode);
  const cycle = getBillingCycleDefinition(billingCycle);

  if (!plan || !cycle) {
    return null;
  }

  return discountedTotalCents(plan.monthlyCents, cycle);
}


export function getFixedPlanRank(planCode: string): number {
  const index = TENH_PLANS.findIndex((item) => item.id === planCode);
  return index >= 0 ? index + 1 : 0;
}

export function calculateUpgradeTotalCents(
  currentPlanCode: string,
  targetPlanCode: string,
  billingCycle: string,
): number | null {
  const currentRank = getFixedPlanRank(currentPlanCode);
  const targetRank = getFixedPlanRank(targetPlanCode);

  if (currentRank < 1 || targetRank <= currentRank) {
    return null;
  }

  const currentTotal = calculatePlanTotalCents(
    currentPlanCode,
    billingCycle,
  );
  const targetTotal = calculatePlanTotalCents(
    targetPlanCode,
    billingCycle,
  );

  if (currentTotal === null || targetTotal === null) {
    return null;
  }

  return Math.max(0, targetTotal - currentTotal);
}

export function normalizeCustomCapacity(
  connections: unknown,
  users: unknown,
): { connections: number; users: number } | null {
  const connectionCount = Number(connections);
  const userCount = Number(users);

  if (
    !Number.isInteger(connectionCount) ||
    !Number.isInteger(userCount) ||
    connectionCount < TENH_CUSTOM_PRICING.minConnections ||
    connectionCount > TENH_CUSTOM_PRICING.maxConnections ||
    userCount < TENH_CUSTOM_PRICING.minUsers ||
    userCount > TENH_CUSTOM_PRICING.maxUsers
  ) {
    return null;
  }

  return { connections: connectionCount, users: userCount };
}

export function calculateCapacityMonthlyCents(
  connections: number,
  users: number,
): number | null {
  if (
    !Number.isInteger(connections) ||
    !Number.isInteger(users) ||
    connections < TENH_CUSTOM_PRICING.minConnections ||
    connections > TENH_CUSTOM_PRICING.maxConnections ||
    users < 1 ||
    users > TENH_CUSTOM_PRICING.maxUsers
  ) {
    return null;
  }

  // Custom pricing always uses the cheapest eligible TENH package as its
  // anchor, then charges only for capacity above that package. This keeps a
  // Custom subscription from costing more than a fixed plan with the exact
  // same capacity.
  const standardMonthly =
    1300 +
    Math.max(0, connections - 3) * TENH_CUSTOM_PRICING.extraConnectionCents +
    Math.max(0, users - 1) * TENH_CUSTOM_PRICING.extraUserCents;

  const candidates = [standardMonthly];

  if (connections >= 5 && users >= 3) {
    candidates.push(
      2500 +
        (connections - 5) * TENH_CUSTOM_PRICING.extraConnectionCents +
        (users - 3) * TENH_CUSTOM_PRICING.extraUserCents,
    );
  }

  if (connections >= 12 && users >= 8) {
    candidates.push(
      5900 +
        (connections - 12) * TENH_CUSTOM_PRICING.extraConnectionCents +
        (users - 8) * TENH_CUSTOM_PRICING.extraUserCents,
    );
  }

  return Math.min(...candidates);
}

export function calculateCustomMonthlyCents(
  connections: number,
  users: number,
): number | null {
  const capacity = normalizeCustomCapacity(connections, users);

  if (!capacity) {
    return null;
  }

  return calculateCapacityMonthlyCents(
    capacity.connections,
    capacity.users,
  );
}

export function calculateCustomTotalCents(
  connections: number,
  users: number,
  billingCycle: string,
): number | null {
  const monthlyCents = calculateCustomMonthlyCents(connections, users);
  const cycle = getBillingCycleDefinition(billingCycle);

  if (monthlyCents === null || !cycle) {
    return null;
  }

  return discountedTotalCents(monthlyCents, cycle);
}


export type TrustedSubscriptionQuote = {
  planCode: PlanCode;
  planName: string;
  cycle: BillingCycleDefinition;
  channels: number;
  users: number;
  monthlyCents: number;
  totalCents: number;
  pricingVersion: string;
};

export function getTrustedSubscriptionQuote(input: {
  planCode: string;
  billingCycle: string;
  connections?: unknown;
  users?: unknown;
}): TrustedSubscriptionQuote | null {
  const cycle = getBillingCycleDefinition(input.billingCycle);

  if (!cycle) {
    return null;
  }

  if (input.planCode === "custom") {
    const capacity = normalizeCustomCapacity(input.connections, input.users);

    if (!capacity) {
      return null;
    }

    const monthlyCents = calculateCustomMonthlyCents(
      capacity.connections,
      capacity.users,
    );
    const totalCents = calculateCustomTotalCents(
      capacity.connections,
      capacity.users,
      cycle.id,
    );

    if (monthlyCents === null || totalCents === null) {
      return null;
    }

    return {
      planCode: "custom" as const,
      planName: "Custom",
      cycle,
      channels: capacity.connections,
      users: capacity.users,
      monthlyCents,
      totalCents,
      pricingVersion: TENH_CUSTOM_PRICING.version,
    };
  }

  const plan = TENH_PLANS.find((item) => item.id === input.planCode);
  const totalCents = calculatePlanTotalCents(input.planCode, cycle.id);

  if (!plan || totalCents === null) {
    return null;
  }

  return {
    planCode: plan.id,
    planName: plan.name,
    cycle,
    channels: plan.channels,
    users: plan.users,
    monthlyCents: plan.monthlyCents,
    totalCents,
    pricingVersion: TENH_CUSTOM_PRICING.version,
  };
}

export function formatUsdFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
