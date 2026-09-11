import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class TrialChannelAccessError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "TrialChannelAccessError";
  }
}

// Call after verifying Page/Bot ownership, before releasing an old connection.
// The DB trigger also enforces this atomically when the channel is saved.
export async function assertTrialChannelAccess(businessId: string, platform: "facebook" | "telegram", accountId: string) {
  const { data, error } = await supabaseAdmin.rpc("check_tenh_trial_channel_access", {
    p_business_id: businessId, p_platform: platform, p_account_id: accountId,
  });
  if (error?.details === "TENH_TRIAL_EXPIRED") {
    throw new TrialChannelAccessError("Your free trial has expired. Buy a subscription to connect this channel.", 403, "TRIAL_EXPIRED");
  }
  if (error) throw new TrialChannelAccessError("TENH could not verify channel trial eligibility. Please contact support before reconnecting.", 503, "TRIAL_SECURITY_UNAVAILABLE");
  if (data !== true) throw new TrialChannelAccessError("This Page or Bot has already used a TENH free trial in another workspace. Buy a subscription to connect it here.", 403, "CHANNEL_TRIAL_ALREADY_USED");
}
