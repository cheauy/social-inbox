import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function syncBusinessSubscriptionLifecycle(
  businessId: string,
) {
  const normalizedBusinessId = businessId.trim();

  if (!normalizedBusinessId) {
    throw new Error("Workspace ID is required for subscription lifecycle sync.");
  }

  const { error } = await supabaseAdmin.rpc(
    "tenh_sync_subscription_lifecycle",
    {
      p_business_id: normalizedBusinessId,
    },
  );

  if (error) {
    throw new Error(
      `Unable to synchronize subscription lifecycle: ${error.message}`,
    );
  }
}
