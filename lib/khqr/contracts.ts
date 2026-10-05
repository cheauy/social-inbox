import type { BillingCycle, PlanCode } from "@/lib/subscription/plan-catalog";
import type { Decision, MockIntent } from "./verification-policy";

export type KhqrContext = Readonly<{ businessId: string; memberId: string }>;
export type KhqrSelection = Readonly<{
  planCode: PlanCode;
  billingCycle: BillingCycle;
  connections?: number;
  users?: number;
  renewSame: boolean;
  customUpgrade: boolean;
  extensionBillingCycle?: BillingCycle | "none";
}>;
export type KhqrIntent = MockIntent & Readonly<{
  memberId: string;
  payload: string;
  planCode: PlanCode;
  billingCycle: BillingCycle;
  invoiceId: string | null;
}>;
export type KhqrPublicIntent = Readonly<{
  intentId: string;
  businessId: string;
  provider: "khqr";
  environment: "mock";
  payable: false;
  amountMinor: number;
  currency: "USD" | "KHR";
  expiresAtMs: number;
  serverNowMs: number;
  state: KhqrIntent["state"];
  invoiceId: string | null;
  mockPayload: string | null;
}>;

/** Billing-owned implementation must reauthorize and serialize every method.
 * prepareIntent uses shared trusted pricing/baseline rules and a global workspace
 * billing lock; it atomically reserves/persists a unique QR with idempotency.
 * activateVerified rechecks expiry/baseline, claims a unique full hash, activates
 * through the reviewed billing core and issues one invoice in one transaction.
 * Existing PayWay/Manual routines are never called as KHQR activation substitutes.
 */
export interface KhqrBillingFacade {
  readonly environment: "mock";
  prepareIntent(context: KhqrContext, selection: KhqrSelection, idempotencyKey: string,
    generate: (intent: Omit<KhqrIntent, "payload" | "qrMd5">) => { payload: string; md5: string }): Promise<KhqrIntent>;
  getIntent(context: KhqrContext, intentId: string): Promise<KhqrIntent | null>;
  observe(context: KhqrContext, intentId: string, decision: Decision): Promise<KhqrIntent>;
  activateVerified(context: KhqrContext, intentId: string,
    proof: { transactionHash: string; requestedMd5: string; observedAtMs: number }): Promise<KhqrIntent>;
}

export class KhqrError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
  }
}
