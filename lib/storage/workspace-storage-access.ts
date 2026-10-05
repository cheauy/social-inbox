import "server-only";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { isOperationalSubscription, type SubscriptionStateRow } from "@/lib/subscription/is-operational-subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Storage never recovers an explicit stale workspace by selecting another one. */
export async function getWorkspaceStorageAccess() {
  const auth = await getCurrentMember(true);
  if (!auth.success) return auth;
  const { data, error } = await supabaseAdmin.from("business_subscriptions")
    .select("status,current_period_end,trial_ends_at,created_at")
    .eq("business_id", auth.member.business_id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return { success: false as const, status: 500 as const, error: "Unable to verify workspace subscription status." };
  if (!isOperationalSubscription(data as SubscriptionStateRow | null)) {
    return { success: false as const, status: 409 as const, error: "This workspace subscription has expired. Select an active workspace before opening Storage." };
  }
  return auth;
}
