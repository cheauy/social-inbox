import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { getInboxConversationScope } from "@/lib/inbox/get-conversations";
import { DEFAULT_TAG_SEED_MARKER } from "@/lib/settings/ensure-workspace-default-content";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MembershipRow = {
  id: string;
  business_id: string;
};

type BusinessRow = {
  id: string;
  name: string | null;
};

type TagRow = {
  id: string;
  business_id: string;
  name: string;
  color: string;
};

type ContactTagRow = {
  tag_id: string;
};

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      { status: authResult.status },
    );
  }

  let scope;

  try {
    scope = await getInboxConversationScope();
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Smart View workspace access.",
      },
      { status: 500 },
    );
  }

  const accessibleBusinessIds = scope.accessibleBusinessIds;

  if (accessibleBusinessIds.length === 0) {
    return NextResponse.json({
      success: true,
      currentBusinessId: scope.currentBusinessId,
      workspaces: [],
      tags: [],
    });
  }

  const [membershipResult, businessResult, tagResult] =
    await Promise.all([
      supabaseAdmin
        .from("team_members")
        .select("id,business_id")
        .eq("user_id", authResult.user.id)
        .eq("is_active", true)
        .in("business_id", accessibleBusinessIds),
      supabaseAdmin
        .from("businesses")
        .select("id,name")
        .in("id", accessibleBusinessIds),
      supabaseAdmin
        .from("tags")
        .select("id,business_id,name,color")
        .in("business_id", accessibleBusinessIds)
        .eq("is_active", true)
        .neq("name", DEFAULT_TAG_SEED_MARKER)
        .order("name", { ascending: true }),
    ]);

  if (
    membershipResult.error ||
    businessResult.error ||
    tagResult.error
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load Smart View options.",
        details:
          membershipResult.error?.message ??
          businessResult.error?.message ??
          tagResult.error?.message,
      },
      { status: 500 },
    );
  }

  const memberships =
    (membershipResult.data ?? []) as MembershipRow[];
  const businesses =
    (businessResult.data ?? []) as BusinessRow[];
  const tags = (tagResult.data ?? []) as TagRow[];

  const membershipByBusiness = new Map(
    memberships.map((membership) => [
      membership.business_id,
      membership,
    ]),
  );
  const businessNameById = new Map(
    businesses.map((business) => [
      business.id,
      business.name?.trim() || "TENH Workspace",
    ]),
  );

  const tagIds = tags.map((tag) => tag.id);
  const tagCounts = new Map<string, number>();

  if (tagIds.length > 0) {
    const tagIdChunks: string[][] = [];

    for (let index = 0; index < tagIds.length; index += 100) {
      tagIdChunks.push(tagIds.slice(index, index + 100));
    }

    const countResults = await Promise.all(
      tagIdChunks.map((chunk) =>
        supabaseAdmin
          .from("contact_tags")
          .select("tag_id")
          .in("tag_id", chunk),
      ),
    );

    for (const result of countResults) {
      if (result.error) {
        console.warn(
          "Unable to count one Smart View tag batch:",
          result.error,
        );
        continue;
      }

      for (const row of (result.data ?? []) as ContactTagRow[]) {
        tagCounts.set(
          row.tag_id,
          (tagCounts.get(row.tag_id) ?? 0) + 1,
        );
      }
    }
  }

  const workspaces = accessibleBusinessIds
    .map((businessId) => {
      const membership = membershipByBusiness.get(businessId);

      if (!membership) {
        return null;
      }

      return {
        businessId,
        businessName:
          businessNameById.get(businessId) ?? "TENH Workspace",
        memberId: membership.id,
      };
    })
    .filter(
      (
        workspace,
      ): workspace is {
        businessId: string;
        businessName: string;
        memberId: string;
      } => Boolean(workspace),
    );

  return NextResponse.json({
    success: true,
    currentBusinessId: scope.currentBusinessId,
    workspaces,
    tags: tags.map((tag) => ({
      id: tag.id,
      businessId: tag.business_id,
      name: tag.name,
      color: tag.color,
      count: tagCounts.get(tag.id) ?? 0,
    })),
  });
}
