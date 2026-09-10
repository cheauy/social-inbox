import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Whether a workspace is currently entitled to be used.
 *
 * This lived inside the Inbox access helper, where every Inbox route reached
 * it. TENH Companion needs the same answer for a paired browser, and a second
 * copy of "which statuses count, and when does the period end" is exactly the
 * kind of duplicate rule that drifts: one file learns about a new status and
 * the other quietly keeps letting an expired workspace through.
 */

const OPERATIONAL_STATUSES = new Set(["active", "trialing"]);

export type SubscriptionStateRow = {
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export function isOperationalSubscription(
  subscription: SubscriptionStateRow | null,
) {
  // Preserve legacy/unmanaged workspaces until they are migrated.
  if (!subscription) return true;

  if (!OPERATIONAL_STATUSES.has(subscription.status)) return false;

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

/**
 * The same question, asked from a route that has only a workspace id.
 *
 * A read failure answers "no". A browser that cannot be checked is a browser
 * that waits, which is the safe way round for something optional.
 */
export async function businessSubscriptionIsOperational(businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select("status,current_period_end,trial_ends_at,created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return false;

  return isOperationalSubscription(
    (data as SubscriptionStateRow | null) ?? null,
  );
}
