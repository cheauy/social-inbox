export type SubscriptionPendingPayment = {
  kind: "manual" | "payway" | "bakong";
  id: string;
  businessId: string;
  memberId: string;
  planCode: string;
  billingCycle: string;
  amount: number | null;
  currency: string | null;
  status: "pending" | "submitted" | "reconciliation_required";
  expiresAt: string | null;
  resumeUrl: string;
};
