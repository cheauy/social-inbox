import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { customerPaymentReference } from "./payment-display";

type Payment = { source: "manual" | "payway" | "bakong"; paymentId: string };
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const paymentReferenceKey = (payment: Payment) => `${payment.source}:${payment.paymentId.toLowerCase()}`;

/** Call only after payment/workspace authorization. This reference is never an access credential. */
export async function getCustomerPaymentReferences(payments: Payment[]): Promise<Map<string, string>> {
  const saved = new Map<string, string>();
  const unique = new Map(payments.filter(p => uuid.test(p.paymentId)).map(p => [paymentReferenceKey(p), { ...p, paymentId: p.paymentId.toLowerCase() }]));
  const all = [...unique.values()];
  for (let offset = 0; offset < all.length; offset += 600) {
    let pending = all.slice(offset, offset + 600);
    for (let retry = 0; pending.length && retry < 8; retry++) {
      const candidates = pending.map(payment => ({ ...payment, reference: Array.from(randomBytes(8), byte => alphabet[byte & 31]).join("") }));
      try {
        const result = await supabaseAdmin.rpc("tenh_claim_customer_payment_references", { p_candidates: candidates });
        if (result.error || !Array.isArray(result.data)) break;
        const collided = new Set<string>();
        const pendingKeys = new Set(pending.map(paymentReferenceKey));
        for (const row of result.data) {
          if (!row || typeof row.payment_id !== "string" || !["manual", "payway", "bakong"].includes(row.source_type)) continue;
          const key = paymentReferenceKey({ source: row.source_type, paymentId: row.payment_id });
          if (!pendingKeys.has(key)) continue;
          const reference = customerPaymentReference(row.reference);
          if (reference && ["created", "existing"].includes(row.outcome)) saved.set(key, reference);
          else if (row.outcome === "collision") collided.add(key);
        }
        pending = pending.filter(payment => collided.has(paymentReferenceKey(payment)));
      } catch { break; }
      // Reference availability must never undo a saved payment or enable another charge.
    }
  }
  return saved;
}
