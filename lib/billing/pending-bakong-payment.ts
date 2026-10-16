import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Shared by all checkout writers; the database claim guard (tenh_bakong_blocking_attempt) also
 * covers insert races. Only an open KHQR checkout or received funds awaiting application/review
 * block a workspace. Expired or customer-closed unpaid QRs never block a new purchase.
 */
export async function getPendingBakongPayment(businessId: string): Promise<string | null> {
  const failure = () => new Error("Unable to check the workspace's unresolved payment.");
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
