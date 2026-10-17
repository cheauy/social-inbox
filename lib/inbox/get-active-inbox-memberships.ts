import "server-only";
import { cache } from "react";
import { requestMemo } from "@/lib/server/request-scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Called with the verified user's id; nothing is retained after this request
// (or server render). Operational subscription filtering remains with callers.
export const getActiveInboxMemberships = cache((userId: string) => requestMemo(`inbox-memberships:${userId}`, async () => {
  const { data, error } = await supabaseAdmin.from("team_members")
    .select("id,business_id").eq("user_id", userId).eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error("Unable to load active Inbox memberships.");
  return (data ?? []) as Array<{ id: string; business_id: string }>;
}));
