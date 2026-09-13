import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
export type FacebookBlockScope = { businessId: string; socialAccountId: string; contactId: string };
export type FacebookBlockMode = "messages" | "page";
export type FacebookBlockState = {
  block_mode?: FacebookBlockMode;
  is_blocked: boolean; updated_by_name: string | null; provider_confirmed_at: string | null;
  operation_id: string | null; operation_started_at: string | null; requested_blocked: boolean | null;
};
export function blockStorageMissing(error: { code?: string } | null) {
  return Boolean(error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? ""));
}
export async function readFacebookBlock(scope: FacebookBlockScope): Promise<{ available: boolean; modesAvailable: boolean; state: FacebookBlockState | null }> {
  const fields = "is_blocked,updated_by_name,provider_confirmed_at,operation_id,operation_started_at,requested_blocked";
  const read = (columns: string) => supabaseAdmin.from("facebook_customer_blocks").select(columns)
    .eq("business_id", scope.businessId).eq("social_account_id", scope.socialAccountId).eq("contact_id", scope.contactId).maybeSingle();
  let { data, error } = await read(`${fields},block_mode`);
  let modesAvailable = true;
  // Retain enforcement of existing blocks while the mode migration is pending.
  if (error && ["42703", "PGRST204"].includes(error.code ?? "")) {
    modesAvailable = false;
    ({ data, error } = await read(fields));
  }
  // Older deployments keep normal messaging. New block operations require migration.
  if (blockStorageMissing(error)) return { available: false, modesAvailable: false, state: null };
  if (error) throw new Error("Unable to check the customer's Facebook messaging block.");
  return { available: true, modesAvailable, state: data as FacebookBlockState | null };
}
export function isBlockPending(state: FacebookBlockState | null) {
  return Boolean(state?.operation_id && state.operation_started_at && Date.now() - Date.parse(state.operation_started_at) < 90000);
}
export async function facebookSendBlockReason(scope: FacebookBlockScope): Promise<string | null> {
  const { state } = await readFacebookBlock(scope);
  if (isBlockPending(state)) return "A Facebook block/unblock operation is in progress. Please wait.";
  return state?.is_blocked ? "This customer is blocked on this Facebook Page. Unblock the customer before sending a message." : null;
}
