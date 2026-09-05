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

type RouteContext = {
  params: Promise<{ categoryId: string }>;
};

function jsonError(
  error: string,
  status: number,
) {
  return NextResponse.json(
    { success: false, error },
    { status },
  );
}

async function loadCategory(
  categoryId: string,
  businessId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("saved_reply_categories")
    .select(CATEGORY_COLUMNS)
    .eq("id", categoryId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as {
    id: string;
    name: string;
  } | null;
}

/**
 * Rename a category.
 *
 * Replies store the category by name, so the rename has to reach them too --
 * otherwise every reply would quietly fall out of the category it was filed
 * under. Both writes happen here, category first: a reply pointing at a name
 * that no longer exists is worse than a category nothing points at yet.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext,
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

  const { categoryId } =
    await context.params;
  const businessId =
    authResult.member.business_id;

  let body: { name?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(
      "Invalid JSON request.",
      400,
    );
  }

  const name =
    typeof body.name === "string"
      ? body.name.trim().slice(0, 100)
      : "";

  if (!name) {
    return jsonError(
      "A category name is required.",
      400,
    );
  }

  let existing;

  try {
    existing = await loadCategory(
      categoryId,
      businessId,
    );
  } catch (loadError) {
    console.error(
      `Unable to load quick reply category — ${
        loadError instanceof Error
          ? loadError.message
          : loadError
      }`,
    );

    return jsonError(
      "Unable to rename that category.",
      500,
    );
  }

  if (!existing) {
    return jsonError(
      "That category was not found.",
      404,
    );
  }

  if (existing.name === name) {
    return NextResponse.json({
      success: true,
      category: existing,
      renamedReplies: 0,
    });
  }

  const { data, error } = await supabaseAdmin
    .from("saved_reply_categories")
    .update({
      name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", categoryId)
    .eq("business_id", businessId)
    .select(CATEGORY_COLUMNS)
    .single();

  if (error) {
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
      `Unable to rename quick reply category — ${error.message}`,
    );

    return jsonError(
      "Unable to rename that category.",
      500,
    );
  }

  const { error: replyError } =
    await supabaseAdmin
      .from("saved_replies")
      .update({
        category: name,
        updated_at:
          new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .eq("category", existing.name);

  if (replyError) {
    /*
     * The category is renamed but its replies still carry the old name. Say so
     * plainly: retrying the same rename repairs it, and pretending it worked
     * would leave replies quietly uncategorised.
     */
    console.error(
      `Category renamed but replies were not moved — ${replyError.message}`,
    );

    return jsonError(
      "The category was renamed, but its quick replies still carry the old name. Rename it again to finish.",
      500,
    );
  }

  return NextResponse.json({
    success: true,
    category: data,
  });
}

/**
 * Delete a category, keeping its replies.
 *
 * The replies become uncategorised rather than being deleted or blocking the
 * delete. Losing a quick reply because someone tidied a category would be a bad
 * trade -- the text is the work, the category is only filing.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
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

  const { categoryId } =
    await context.params;
  const businessId =
    authResult.member.business_id;

  let existing;

  try {
    existing = await loadCategory(
      categoryId,
      businessId,
    );
  } catch (loadError) {
    console.error(
      `Unable to load quick reply category — ${
        loadError instanceof Error
          ? loadError.message
          : loadError
      }`,
    );

    return jsonError(
      "Unable to delete that category.",
      500,
    );
  }

  if (!existing) {
    return NextResponse.json({
      success: true,
    });
  }

  const { error: replyError } =
    await supabaseAdmin
      .from("saved_replies")
      .update({
        category: null,
        updated_at:
          new Date().toISOString(),
      })
      .eq("business_id", businessId)
      .eq("category", existing.name);

  if (replyError) {
    console.error(
      `Unable to clear category from quick replies — ${replyError.message}`,
    );

    return jsonError(
      "Unable to delete that category.",
      500,
    );
  }

  const { error } = await supabaseAdmin
    .from("saved_reply_categories")
    .delete()
    .eq("id", categoryId)
    .eq("business_id", businessId);

  if (error) {
    console.error(
      `Unable to delete quick reply category — ${error.message}`,
    );

    return jsonError(
      "Unable to delete that category.",
      500,
    );
  }

  return NextResponse.json({
    success: true,
  });
}
