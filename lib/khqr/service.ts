import "server-only";
import { KhqrError, type KhqrBillingFacade, type KhqrContext, type KhqrIntent, type KhqrPublicIntent, type KhqrSelection } from "./contracts";
import type { MockKhqrProvider } from "./provider";

function authorize(intent: KhqrIntent, context: KhqrContext, expectedIntentId?: string) {
  if (intent.businessId !== context.businessId || (expectedIntentId !== undefined && intent.id !== expectedIntentId)) throw new KhqrError("KHQR_NOT_FOUND", 404, "Payment was not found.");
  if (intent.environment !== "mock") throw new KhqrError("KHQR_ENVIRONMENT_BLOCKED", 503, "KHQR environment is unavailable.");
}
function present(intent: KhqrIntent, nowMs: number): KhqrPublicIntent {
  return {
    intentId: intent.id, businessId: intent.businessId, provider: "khqr", environment: "mock", payable: false,
    amountMinor: intent.amountMinor, currency: intent.currency, expiresAtMs: intent.expiresAtMs,
    serverNowMs: nowMs, state: intent.state, invoiceId: intent.invoiceId,
    mockPayload: intent.state === "pending" && nowMs < intent.expiresAtMs ? intent.payload : null,
  };
}

/** Mock construction requires an explicit facade; runtime has no registered
 * facade. This service contains no independent pricing or entitlement logic.
 */
export function createMockKhqrService(facade: KhqrBillingFacade, provider: MockKhqrProvider,
  now: () => number = Date.now) {
  if (facade.environment !== "mock" || provider.environment !== "mock") throw new Error("Only a mock KHQR integration is supported.");
  const inquiries = new Map<string, Promise<KhqrIntent>>();
  return {
    async checkout(context: KhqrContext, selection: KhqrSelection, idempotencyKey: string) {
      const intent = await facade.prepareIntent(context, selection, idempotencyKey, provider.generate);
      authorize(intent, context);
      return present(intent, now());
    },
    async status(context: KhqrContext, intentId: string) {
      // Authorize each caller before joining another caller's in-flight inquiry.
      const intent = await facade.getIntent(context, intentId);
      if (!intent) throw new KhqrError("KHQR_NOT_FOUND", 404, "Payment was not found.");
      authorize(intent, context, intentId);
      if (intent.state !== "pending") return present(intent, now());
      const key = JSON.stringify([context.businessId, intent.id]);
      let inquiry = inquiries.get(key);
      if (!inquiry) {
        inquiry = (async () => {
          const decision = await provider.verify(intent, now);
          if (decision.state === "verified") return facade.activateVerified(context, intent.id, {
            transactionHash: decision.transactionHash, requestedMd5: intent.qrMd5, observedAtMs: now(),
          });
          return facade.observe(context, intent.id, decision);
        })();
        inquiries.set(key, inquiry);
      }
      try {
        const saved = await inquiry;
        authorize(saved, context, intentId);
        return present(saved, now());
      } finally { if (inquiries.get(key) === inquiry) inquiries.delete(key); }
    },
  };
}
export type MockKhqrService = ReturnType<typeof createMockKhqrService>;
