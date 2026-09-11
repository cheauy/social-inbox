export type PlanCode = "mini" | "standard" | "pro" | "custom";
export type BillingCycle = "monthly" | "3-months" | "6-months" | "12-months";

export type RenewalSnapshot = {
  status: string;
  plan_code: string | null;
  billing_cycle: string | null;
  current_period_end: string | null;
  last_paid_amount: number | null;
  pricing_snapshot: { renewal_total_cents?: number } | null;
  channel_limit: number | null;
  member_limit: number | null;
};

/** Same saved-price and expiry rules as PayWay/manual renewSame validation. */
export function renewalSelection(subscription: RenewalSnapshot | null, isOwner: boolean, now = Date.now()) {
  if (!subscription || !isOwner) return null;
  const end = Date.parse(subscription.current_period_end ?? "");
  const expired = ["expired", "past_due", "cancelled"].includes(subscription.status)
    || (subscription.status === "active" && Number.isFinite(end) && end <= now);
  const saved = Number(subscription.pricing_snapshot?.renewal_total_cents);
  const amount = Number.isFinite(saved) && saved > 0 ? saved : Number(subscription.last_paid_amount) * 100;
  if (!expired || !Number.isFinite(amount) || amount <= 0
    || !["mini", "standard", "pro", "custom"].includes(subscription.plan_code ?? "")
    || !["monthly", "3-months", "6-months", "12-months"].includes(subscription.billing_cycle ?? "")) return null;
  const connections = subscription.channel_limit;
  const users = subscription.member_limit;
  if (subscription.plan_code === "custom" && (!Number.isInteger(connections) || !Number.isInteger(users) || connections! < 1 || users! < 1)) return null;
  return {
    amount: Math.round(amount),
    planCode: subscription.plan_code as PlanCode,
    billingCycle: subscription.billing_cycle as BillingCycle,
    connections,
    users,
  };
}

/** Wire response only; never import server pricing code into the native bundle. */
export type UpgradeQuote = {
  targetConnections: number;
  targetUsers: number;
  targetBillingCycle: string;
  remainingDays: number;
  capacityProrationCents: number;
  durationExtensionCents: number;
  totalCents: number;
  renewalTotalCents: number;
  newPeriodEnd: string;
};

export function matchesUpgradeQuote(quote: UpgradeQuote | null, connections: number, users: number, cycle: string) {
  return Boolean(quote && quote.targetConnections === connections && quote.targetUsers === users
    && quote.targetBillingCycle === cycle && Number.isFinite(quote.totalCents) && quote.totalCents > 0);
}
