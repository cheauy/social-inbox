import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyAndFinalizePayWayTransaction } from "@/lib/payway/finalize-payment";
import { closePayWayTransaction } from "@/lib/payway/close-transaction";
import { PAYMENT_CANCELLATION_ENABLED } from "@/lib/billing/payment-cancellation-feature";
import { requireKhqrCheckoutSchema } from "@/lib/billing/require-khqr-checkout-schema";

// checkout_closed/expired: a KHQR checkout is closed; its settlement is not asserted either way.
export type CancellationOutcome = "processing" | "reconciliation_required" | "cancelled" | "checkout_closed" | "expired" | "withdrawn" | "paid";
export async function cancelPayment(input: {
  kind: "manual" | "payway" | "bakong"; paymentId: string; businessId: string;
  actorId: string; memberId: string; withdraw: boolean;
}): Promise<CancellationOutcome> {
  if (!PAYMENT_CANCELLATION_ENABLED) throw new Error("Payment cancellation is temporarily unavailable. Your saved payment is unchanged.");
  if (input.kind === "bakong") await requireKhqrCheckoutSchema();
  const { data, error } = await supabaseAdmin.rpc("tenh_request_payment_cancellation", {
    p_kind: input.kind, p_payment_id: input.paymentId, p_business: input.businessId,
    p_actor: input.actorId, p_member: input.memberId, p_withdraw: input.withdraw,
  });
  if (error || !data) throw new Error("Unable to cancel this payment. Refresh its saved status before trying again.");
  if (input.kind !== "payway" || data.claimed !== true) return data.outcome;

  let closed = false;
  let evidence: Record<string, unknown>;
  try {
    const verified = await verifyAndFinalizePayWayTransaction(input.paymentId, "browser-status");
    evidence = { paymentState: verified.paymentState, providerStatus: verified.providerStatus };
    if (["pending", "cancelled", "declined", "failed"].includes(verified.paymentState) &&
      ["PENDING", "CANCELLED", "CANCELED", "DECLINED", "FAILED"].includes(verified.providerStatus ?? "")) {
      // PROCESSING, missing and uncertain observations must remain for reconciliation.
      const result = await closePayWayTransaction(input.paymentId);
      closed = result.closed;
      evidence = { ...evidence, close: result.response, requestTime: result.reqTime };
    }
  } catch {
    // A timeout can happen after the provider has closed or received a payment.
    evidence = { uncertain: true };
  }
  const finished = await supabaseAdmin.rpc("tenh_finish_payway_cancellation", {
    p_payment_id: input.paymentId, p_closed: closed, p_result: evidence,
  });
  if (finished.error || !finished.data) throw new Error("Cancellation status is uncertain. The attempt is retained for reconciliation. Do not pay again.");
  return finished.data.outcome;
}
