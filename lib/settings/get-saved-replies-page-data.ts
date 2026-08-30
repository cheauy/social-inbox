import "server-only";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  DEFAULT_SAVED_REPLY_SEED_MARKER,
  ensureWorkspaceDefaultContent,
} from "@/lib/settings/ensure-workspace-default-content";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SavedReply } from "@/types/inbox";

export async function getSavedRepliesPageData() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    throw new Error(authResult.error);
  }

  const businessId = authResult.member.business_id;

  await ensureWorkspaceDefaultContent(businessId);

  const [
    { data: business, error: businessError },
    { data: savedReplies, error: repliesError },
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,name")
      .eq("id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("saved_replies")
      .select(
        "id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at",
      )
      .eq("business_id", businessId)
      .neq("title", DEFAULT_SAVED_REPLY_SEED_MARKER)
      .order("is_active", { ascending: false })
      .order("sort_index", { ascending: true }),
  ]);

  if (businessError || !business) {
    throw new Error("A workspace is required.");
  }

  if (repliesError) {
    throw new Error("Unable to load quick replies.");
  }

  return {
    businessId,
    businessName: business.name ?? "Current workspace",
    savedReplies: (savedReplies ?? []) as SavedReply[],
  };
}
