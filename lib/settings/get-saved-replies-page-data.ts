import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SavedReply } from "@/types/inbox";

export async function getSavedRepliesPageData() {
  const configuredBusinessId =
    process.env.DEFAULT_BUSINESS_ID?.trim();

  let businessQuery = supabaseAdmin
    .from("businesses")
    .select("id,name")
    .limit(1);

  if (configuredBusinessId) {
    businessQuery = businessQuery.eq("id", configuredBusinessId);
  } else {
    businessQuery = businessQuery.order("created_at", { ascending: true });
  }

  const { data: business, error } =
    await businessQuery.maybeSingle();

  if (error || !business) {
    throw new Error("A business is required.");
  }

  const { data: savedReplies, error: repliesError } =
    await supabaseAdmin
      .from("saved_replies")
      .select("id,business_id,title,shortcut,message_text,category,sort_index,is_active,created_at,updated_at")
      .eq("business_id", business.id)
      .order("is_active", { ascending: false })
      .order("sort_index", { ascending: true });

  if (repliesError) {
    throw new Error("Unable to load quick replies.");
  }

  return {
    businessId: business.id,
    businessName: business.name ?? "Current business",
    savedReplies: (savedReplies ?? []) as SavedReply[],
  };
}
