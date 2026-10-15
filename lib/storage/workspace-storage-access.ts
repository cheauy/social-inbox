import "server-only";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { isOperationalSubscription, type SubscriptionStateRow } from "@/lib/subscription/is-operational-subscription";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Storage never recovers an explicit stale workspace by selecting another one. */
export async function getWorkspaceStorageAccess(request?: Request) {
  const auth = await getCurrentMember(true);
  if (!auth.success) return auth;
  // Expected identity pins a web request; the cookie still selects an authorized membership.
  const businessId = request?.headers.get("x-tenh-business-id");
  const memberId = request?.headers.get("x-tenh-member-id");
  if ((businessId !== null && businessId !== undefined && businessId !== auth.member.business_id) ||
      (memberId !== null && memberId !== undefined && memberId !== auth.member.id)) {
    return { success: false as const, status: 403 as const, error: "Storage workspace or membership changed. Reopen Storage from Inbox." };
  }
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
