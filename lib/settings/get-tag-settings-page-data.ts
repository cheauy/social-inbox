import "server-only";

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
  const configuredBusinessId =
    process.env.DEFAULT_BUSINESS_ID?.trim();

  let businessQuery = supabaseAdmin
    .from("businesses")
    .select("id,name")
    .limit(1);

  if (configuredBusinessId) {
    businessQuery = businessQuery.eq(
      "id",
      configuredBusinessId,
    );
  } else {
    businessQuery = businessQuery.order(
      "created_at",
      {
        ascending: true,
      },
    );
  }

  const {
    data: business,
    error: businessError,
  } = await businessQuery.maybeSingle();

  if (businessError || !business) {
    console.error(
      "Unable to load business:",
      businessError,
    );

    throw new Error(
      "A business is required before managing tags.",
    );
  }

  const { data: tags, error: tagsError } =
    await supabaseAdmin
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
      .eq("business_id", business.id)
      .order("is_active", {
        ascending: false,
      })
      .order("sort_index", {
        ascending: true,
      })
      .order("name", {
        ascending: true,
      });

  if (tagsError) {
    console.error(
      "Unable to load tags:",
      tagsError,
    );

    throw new Error(
      "Unable to load customer tags.",
    );
  }

  return {
    businessId: business.id,
    businessName:
      business.name ?? "Current business",
    tags: (tags ?? []) as CustomerTag[],
  };
}
