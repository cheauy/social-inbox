export type BakongPaymentView = {
  customerReference?: string | null;
  id: string; businessId: string; userId: string; memberId: string; workspaceName: string;
  recipientName: string | null;
  planCode: string; billingCycle: string; amount: string; currency: "USD";
  reference: string; transactionReference: string | null; environment: "sandbox" | "production";
  state: "pending" | "verified" | "applied" | "review" | "test_paid";
  application: "none" | "active" | "historical" | "review";
  // Checkout lifecycle, independent of settlement: a closed checkout can still receive a late payment.
  checkout: "open" | "expired" | "cancelled";
  qrImage: string | null; createdAt: string; expiresAt: string; serverTime: string; nextCheckAt: string;
  invoiceId: string | null; canCheck: boolean; automaticChecksRemaining: number;
  reconciliationRequired?: boolean;
  reconciliationReason?: string | null;
};
