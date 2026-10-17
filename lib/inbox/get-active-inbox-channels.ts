import "server-only";
import { cache } from "react";
import { requestMemo } from "@/lib/server/request-scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Raw metadata only. Callers still apply their own platform and user-specific
// Personal visibility rules after establishing the current Inbox scope.
const read = cache((scopeKey: string) => requestMemo(`inbox-active-channels:${scopeKey}`, async () => {
  const { data, error } = await supabaseAdmin.from("social_accounts")
    .select("id,platform,facebook_token_status,telegram_token_status")
    .in("business_id", JSON.parse(scopeKey) as string[]).eq("is_active", true);
  if (error) {
    console.error("Unable to load active Inbox channels:", error);
    throw new Error("Unable to load active TENH channels.");
  }
  return data ?? [];
}));

export function getActiveInboxChannels(businessIds: readonly string[]) {
  return read(JSON.stringify([...new Set(businessIds)].sort()));
}
