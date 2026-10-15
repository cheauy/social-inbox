import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Shared by all checkout writers; the database claim guard also covers insert races. */
export async function getPendingBakongPayment(businessId: string): Promise<string | null> {
  const result = await supabaseAdmin.from("billing_transactions").select("id").eq("business_id", businessId)
    .eq("provider", "bakong").eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error("Unable to check the workspace's unresolved payment.");
  return result.data?.id ?? null;
}
