import "server-only";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  DEFAULT_TAG_SEED_MARKER,
  ensureWorkspaceDefaultContent,
} from "@/lib/settings/ensure-workspace-default-content";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CustomerTag } from "@/types/inbox";

type TagSettingsPageData = {
  businessId: string;
  businessName: string;
  tags: CustomerTag[];
};

export async function getTagSettingsPageData(): Promise<
  TagSettingsPageData
> {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    throw new Error(authResult.error);
  }

  const businessId = authResult.member.business_id;

  // Backfill starter content once for older empty workspaces. The hidden seed
  // marker prevents deleted defaults from being recreated later.
  await ensureWorkspaceDefaultContent(businessId);

  const [{ data: business, error: businessError }, { data: tags, error: tagsError }] =
    await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,name")
        .eq("id", businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("tags")
        .select(`
          id,
          business_id,
          name,
          color,
          sort_index,
          description,
          is_active,
          created_at,
          updated_at
        `)
        .eq("business_id", businessId)
        .neq("name", DEFAULT_TAG_SEED_MARKER)
        .order("is_active", {
          ascending: false,
        })
        .order("sort_index", {
          ascending: true,
        })
        .order("name", {
          ascending: true,
        }),
    ]);

  if (businessError || !business) {
    console.error("Unable to load current workspace:", businessError);
    throw new Error("A workspace is required before managing tags.");
  }

  if (tagsError) {
    console.error("Unable to load tags:", tagsError);
    throw new Error("Unable to load customer tags.");
  }

  return {
    businessId,
    businessName: business.name ?? "Current workspace",
    tags: (tags ?? []) as CustomerTag[],
  };
}
