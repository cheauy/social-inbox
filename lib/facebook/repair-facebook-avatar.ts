import "server-only";

import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { syncFacebookContactProfilePhoto } from "@/lib/facebook/facebook-profile-photo";

// Cache the outcome, never a token. A denied/missing photo should not consume
// another Graph call on every list render. Authorization happens in the route.
const repairOnce = unstable_cache(async (businessId: string, contactId: string) => {
  const { data: contact, error } = await supabaseAdmin.from("contacts")
    .select("id,platform_user_id,conversations(social_account:social_accounts(platform_account_id,business_id,platform,is_active))")
    .eq("id", contactId).eq("business_id", businessId).eq("platform", "facebook")
    .maybeSingle();
  if (error || !contact?.platform_user_id) return false;

  const accounts = (contact.conversations ?? []).flatMap(conversation => {
    const account = conversation.social_account;
    return Array.isArray(account) ? account : account ? [account] : [];
  });
  const account = accounts.find(value => value.business_id === businessId && value.platform === "facebook" && value.is_active && value.platform_account_id);
  if (!account) return false;

  try {
    const pageAccessToken = await getFacebookPageAccessToken(account.platform_account_id);
    const result = await syncFacebookContactProfilePhoto({
      businessId, contactId, customerId: contact.platform_user_id, pageAccessToken,
    });
    return result.stored;
  } catch { return false; }
}, ["facebook-avatar-repair-v1"], { revalidate: 3600 });

const pending = new Map<string, Promise<boolean>>();

/** Repair missing storage on demand, including contacts created long ago. */
export function repairFacebookAvatar(businessId: string, contactId: string): Promise<boolean> {
  const key = JSON.stringify([businessId, contactId]);
  const existing = pending.get(key);
  if (existing) return existing;
  const task = repairOnce(businessId, contactId).catch(() => false).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
