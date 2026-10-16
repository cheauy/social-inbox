import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PAYMENT_CANCELLATION_ENABLED } from "@/lib/billing/payment-cancellation-feature";

/**
 * Shared by all checkout writers; the database claim guard (tenh_bakong_blocking_attempt) also
 * covers insert races. Until the lifecycle release is approved, preserve the installed guard:
 * every unresolved KHQR blocks a new purchase. The reviewed future branch is retained below.
 */
export async function getPendingBakongPayment(businessId: string): Promise<string | null> {
  const failure = () => new Error("Unable to check the workspace's unresolved payment.");
  if (!PAYMENT_CANCELLATION_ENABLED) {
    // Match the installed database guard: every unresolved KHQR remains blocking, including expired QRs.
    const saved = await supabaseAdmin.from("billing_transactions").select("id").eq("business_id", businessId)
      .eq("provider", "bakong").eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (saved.error) throw failure();
    return saved.data?.id ?? null;
  }
  const pending = await supabaseAdmin.from("billing_transactions").select("id").eq("business_id", businessId)
    .eq("provider", "bakong").eq("status", "pending").order("created_at", { ascending: true });
  if (pending.error) throw failure();
  const ids = (pending.data ?? []).map(row => row.id as string);
  if (!ids.length) return null;
  const [attempts, closed] = await Promise.all([
    supabaseAdmin.from("bakong_payment_attempts").select("id,state,verified_hash,expires_at").in("id", ids),
    supabaseAdmin.from("payment_cancellations").select("payment_id").eq("kind", "bakong").in("payment_id", ids),
  ]);
  if (attempts.error || closed.error) throw failure();
  const cancelled = new Set((closed.data ?? []).map(row => row.payment_id as string));
  const saved = new Map((attempts.data ?? []).map(row => [row.id as string, row]));
  return ids.find(id => {
    const attempt = saved.get(id);
    if (!attempt) return true; // Unknown attempt state stays blocking.
    if (attempt.state === "verified" || attempt.state === "review") return true;
    return attempt.state === "pending" && !attempt.verified_hash && !cancelled.has(id) && Date.parse(attempt.expires_at) > Date.now();
  }) ?? null;
}
