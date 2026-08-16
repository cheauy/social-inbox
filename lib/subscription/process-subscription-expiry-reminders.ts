import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type SubscriptionExpiryReminderSweep = {
  lifecycleRowsSynced: number;
  notificationsCreated: number;
};

type SweepRpcRow = {
  lifecycle_rows_synced?: number | null;
  notifications_created?: number | null;
};

export async function processSubscriptionExpiryReminders(): Promise<SubscriptionExpiryReminderSweep> {
  const { data, error } = await supabaseAdmin.rpc(
    "tenh_process_subscription_expiry_notifications",
  );

  if (error) {
    throw new Error(
      `Unable to process TENH subscription expiry reminders: ${error.message}`,
    );
  }

  const row = Array.isArray(data)
    ? (data[0] as SweepRpcRow | undefined)
    : (data as SweepRpcRow | null);

  return {
    lifecycleRowsSynced:
      typeof row?.lifecycle_rows_synced === "number"
        ? row.lifecycle_rows_synced
        : 0,
    notificationsCreated:
      typeof row?.notifications_created === "number"
        ? row.notifications_created
        : 0,
  };
}
