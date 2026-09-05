import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORY_COLUMNS =
  "id,business_id,name,sort_index,created_at,updated_at";

export const SAVED_REPLY_CATEGORY_NAME_MAX = 100;

function jsonError(
  error: string,
  status: number,
) {
  return NextResponse.json(
    { success: false, error },
    { status },
  );
}

function cleanName(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .slice(0, SAVED_REPLY_CATEGORY_NAME_MAX);
}

/** List a workspace's categories in the order the Owner arranged them. */
export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const { data, error } = await supabaseAdmin
    .from("saved_reply_categories")
    .select(CATEGORY_COLUMNS)
    .eq(
      "business_id",
      authResult.member.business_id,
    )
    .order("sort_index", {
      ascending: true,
    })
    .order("name", { ascending: true });

  if (error) {
    console.error(
      `Unable to load quick reply categories — ${error.message}`,
    );

    return jsonError(
      "Unable to load categories.",
      500,
    );
  }

  return NextResponse.json({
    success: true,
    categories: data ?? [],
  });
}

/** Create one category, placed last. */
export async function POST(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const permissionGuard =
    await requirePermission(
      "tags_quick_replies",
      "manage",
    );

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  let body: { name?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(
      "Invalid JSON request.",
      400,
    );
  }

  const name = cleanName(body.name);

  if (!name) {
    return jsonError(
      "A category name is required.",
      400,
    );
  }

  const businessId =
    authResult.member.business_id;

  const { data: last } = await supabaseAdmin
    .from("saved_reply_categories")
    .select("sort_index")
    .eq("business_id", businessId)
    .order("sort_index", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  const sortIndex =
    ((last?.sort_index as number | null) ??
      0) + 10;

  const { data, error } = await supabaseAdmin
    .from("saved_reply_categories")
    .insert({
      business_id: businessId,
      name,
      sort_index: sortIndex,
    })
    .select(CATEGORY_COLUMNS)
    .single();

  if (error) {
    /*
     * The unique index is on lower(name), so this is the same category under
     * different capitals rather than a coincidence worth reporting as a fault.
     */
    if (
      error.code === "23505" ||
      error.message
        .toLowerCase()
        .includes("duplicate key")
    ) {
      return jsonError(
        `"${name}" already exists in this workspace.`,
        409,
      );
    }

    console.error(
      `Unable to create quick reply category — ${error.message}`,
    );

    return jsonError(
      "Unable to create that category.",
      500,
    );
  }

  return NextResponse.json({
    success: true,
    category: data,
  });
}

/**
 * Save a new order.
 *
 * The whole list arrives rather than one moved item: a drag changes where
 * everything sits relative to everything else, and rewriting the order in one
 * request keeps it consistent even if two people rearrange at once -- the last
 * writer wins cleanly instead of interleaving two half-orders.
 */
export async function PUT(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const permissionGuard =
    await requirePermission(
      "tags_quick_replies",
      "manage",
    );

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  let body: { categoryIds?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(
      "Invalid JSON request.",
      400,
    );
  }

  const categoryIds = Array.isArray(
    body.categoryIds,
  )
    ? body.categoryIds.filter(
        (id): id is string =>
          typeof id === "string" && id.length > 0,
      )
    : [];

  if (categoryIds.length === 0) {
    return jsonError(
      "An order is required.",
      400,
    );
  }

  const businessId =
    authResult.member.business_id;

  /*
   * Each update is scoped to this workspace, so an id belonging to another
   * business simply matches nothing rather than being reordered.
   */
  for (const [
    index,
    categoryId,
  ] of categoryIds.entries()) {
    const { error } = await supabaseAdmin
      .from("saved_reply_categories")
      .update({
        sort_index: (index + 1) * 10,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", categoryId)
      .eq("business_id", businessId);

    if (error) {
      console.error(
        `Unable to reorder quick reply categories — ${error.message}`,
      );

      return jsonError(
        "Unable to save the new order.",
        500,
      );
    }
  }

  return NextResponse.json({ success: true });
}
