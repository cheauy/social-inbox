import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class WorkspaceFacebookPageError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function getWorkspaceFacebookPage(businessId: string, value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 100) throw new WorkspaceFacebookPageError("Choose a connected Facebook Page.", 400);
  const { data, error } = await supabaseAdmin.from("social_accounts")
    .select("id,platform_account_id,facebook_token_status")
    .eq("id", id).eq("business_id", businessId).eq("platform", "facebook")
    .eq("is_active", true).maybeSingle();
  if (error) throw new WorkspaceFacebookPageError("Unable to verify Facebook Page access.", 503);
  if (!data?.platform_account_id || data.facebook_token_status === "disconnected") {
    throw new WorkspaceFacebookPageError("This Facebook Page is not connected to your workspace.", 404);
  }
  return { id: data.id as string, pageId: data.platform_account_id as string };
}
