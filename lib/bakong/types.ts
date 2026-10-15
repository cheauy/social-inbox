export type BakongPaymentView = {
  id: string; businessId: string; userId: string; memberId: string; workspaceName: string;
  planCode: string; billingCycle: string; amount: string; currency: "USD";
  reference: string; transactionReference: string | null; environment: "sandbox" | "production";
  state: "pending" | "verified" | "applied" | "review" | "test_paid";
  application: "none" | "active" | "historical" | "review";
  qrImage: string | null; expiresAt: string; serverTime: string; nextCheckAt: string;
  invoiceId: string | null; canCheck: boolean; automaticChecksRemaining: number;
};
