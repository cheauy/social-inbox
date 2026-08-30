import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { requirePermission } from "@/lib/auth/require-permission";
import { DEFAULT_TAG_SEED_MARKER } from "@/lib/settings/ensure-workspace-default-content";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CustomerTag } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAG_SELECT = `
  id,
  business_id,
  name,
  color,
  sort_index,
  description,
  is_active,
  created_at,
  updated_at
`;

function normalizedName(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

const OPERATIONAL_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperationalSubscription(subscription: {
  status?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
} | null) {
  // Keep legacy/unmanaged workspaces available just like /api/workspaces.
  if (!subscription) return true;

  const status = subscription.status ?? "";
  if (!OPERATIONAL_SUBSCRIPTION_STATUSES.has(status)) return false;

  const end =
    status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

async function verifyReadableWorkspace(userId: string, businessId: string) {
  const [membershipResult, subscriptionResult] = await Promise.all([
    supabaseAdmin
      .from("team_members")
      .select("id,business_id,is_active")
      .eq("user_id", userId)
      .eq("business_id", businessId)
      .eq("is_active", true)
      .maybeSingle(),
    supabaseAdmin
      .from("business_subscriptions")
      .select("status,current_period_end,trial_ends_at,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (membershipResult.error || subscriptionResult.error) {
    return {
      success: false as const,
      status: 500,
      error: "Unable to verify workspace access.",
    };
  }

  if (!membershipResult.data) {
    return {
      success: false as const,
      status: 403,
      error: "You do not have access to that workspace.",
    };
  }

  if (!isOperationalSubscription(subscriptionResult.data)) {
    return {
      success: false as const,
      status: 409,
      error: "Expired workspaces cannot be used as a tag copy source.",
    };
  }

  return { success: true as const };
}

export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const sourceBusinessId =
    request.nextUrl.searchParams.get("sourceBusinessId")?.trim() ?? "";

  if (!sourceBusinessId) {
    return NextResponse.json(
      { success: false, error: "Source workspace is required." },
      { status: 400 },
    );
  }

  if (sourceBusinessId === authResult.member.business_id) {
    return NextResponse.json(
      { success: false, error: "Choose a different workspace to copy from." },
      { status: 400 },
    );
  }

  const access = await verifyReadableWorkspace(
    authResult.user.id,
    sourceBusinessId,
  );

  if (!access.success) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  const [{ data: business, error: businessError }, { data: tags, error: tagsError }] =
    await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,name")
        .eq("id", sourceBusinessId)
        .maybeSingle(),
      supabaseAdmin
        .from("tags")
        .select(TAG_SELECT)
        .eq("business_id", sourceBusinessId)
        .neq("name", DEFAULT_TAG_SEED_MARKER)
        .order("is_active", { ascending: false })
        .order("sort_index", { ascending: true })
        .order("name", { ascending: true }),
    ]);

  if (businessError || !business) {
    return NextResponse.json(
      { success: false, error: "Source workspace was not found." },
      { status: 404 },
    );
  }

  if (tagsError) {
    return NextResponse.json(
      { success: false, error: "Unable to load tags from that workspace." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    workspace: {
      businessId: business.id,
      businessName: business.name ?? "TENH Workspace",
    },
    tags: (tags ?? []) as CustomerTag[],
  });
}

type CopyTagsBody = {
  sourceBusinessId?: unknown;
  tagIds?: unknown;
};

export async function POST(request: NextRequest) {
  const guard = await requirePermission("tags_quick_replies", "manage");

  if (!guard.success) {
    return guard.response;
  }

  let body: CopyTagsBody;
  try {
    body = (await request.json()) as CopyTagsBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const sourceBusinessId =
    typeof body.sourceBusinessId === "string"
      ? body.sourceBusinessId.trim()
      : "";
  const requestedTagIds = Array.isArray(body.tagIds)
    ? [
        ...new Set(
          body.tagIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : [];

  const destinationBusinessId = guard.context.member.business_id;

  if (!sourceBusinessId) {
    return NextResponse.json(
      { success: false, error: "Source workspace is required." },
      { status: 400 },
    );
  }

  if (sourceBusinessId === destinationBusinessId) {
    return NextResponse.json(
      { success: false, error: "Choose a different workspace to copy from." },
      { status: 400 },
    );
  }

  if (requestedTagIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "Select at least one tag to copy." },
      { status: 400 },
    );
  }

  if (requestedTagIds.length > 100) {
    return NextResponse.json(
      { success: false, error: "You can copy up to 100 tags at a time." },
      { status: 400 },
    );
  }

  const access = await verifyReadableWorkspace(
    guard.context.member.user_id,
    sourceBusinessId,
  );

  if (!access.success) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }

  const [{ data: sourceTags, error: sourceError }, { data: existingTags, error: existingError }] =
    await Promise.all([
      supabaseAdmin
        .from("tags")
        .select(TAG_SELECT)
        .eq("business_id", sourceBusinessId)
        .in("id", requestedTagIds)
        .neq("name", DEFAULT_TAG_SEED_MARKER)
        .order("sort_index", { ascending: true })
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("tags")
        .select("id,name,sort_index")
        .eq("business_id", destinationBusinessId)
        .neq("name", DEFAULT_TAG_SEED_MARKER),
    ]);

  if (sourceError) {
    return NextResponse.json(
      { success: false, error: "Unable to read the selected source tags." },
      { status: 500 },
    );
  }

  if (existingError) {
    return NextResponse.json(
      { success: false, error: "Unable to verify destination tags." },
      { status: 500 },
    );
  }

  const sourceRows = (sourceTags ?? []) as CustomerTag[];
  const existingRows = (existingTags ?? []) as Array<{
    id: string;
    name: string;
    sort_index: number;
  }>;
  const existingNames = new Set(existingRows.map((tag) => normalizedName(tag.name)));
  let nextSortIndex =
    existingRows.reduce(
      (largest, tag) => Math.max(largest, Number(tag.sort_index) || 0),
      0,
    ) + 1;

  const copied: CustomerTag[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];

  for (const sourceTag of sourceRows) {
    const key = normalizedName(sourceTag.name);

    if (!key || existingNames.has(key)) {
      skipped.push({
        id: sourceTag.id,
        name: sourceTag.name,
        reason: "A tag with this name already exists in the destination workspace.",
      });
      continue;
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from("tags")
      .insert({
        business_id: destinationBusinessId,
        name: sourceTag.name,
        color: sourceTag.color,
        sort_index: nextSortIndex,
        description: sourceTag.description,
        is_active: sourceTag.is_active,
      })
      .select(TAG_SELECT)
      .single();

    if (createError) {
      if (createError.code === "23505") {
        skipped.push({
          id: sourceTag.id,
          name: sourceTag.name,
          reason: "A tag with this name already exists in the destination workspace.",
        });
        existingNames.add(key);
        continue;
      }

      console.error("Unable to copy tag:", {
        sourceBusinessId,
        destinationBusinessId,
        sourceTagId: sourceTag.id,
        error: createError,
      });
      skipped.push({
        id: sourceTag.id,
        name: sourceTag.name,
        reason: "Unable to copy this tag.",
      });
      continue;
    }

    copied.push(created as CustomerTag);
    existingNames.add(key);
    nextSortIndex += 1;
  }

  return NextResponse.json({
    success: true,
    copied,
    skipped,
    copiedCount: copied.length,
    skippedCount: skipped.length,
    note: "Only tag definitions are copied. Customer tag assignments stay in their original workspace.",
  });
}
