import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import { DEFAULT_TAG_SEED_MARKER } from "@/lib/settings/ensure-workspace-default-content";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth/require-permission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidHexColor(
  value: string,
) {
  return /^#[0-9A-F]{6}$/i.test(
    value,
  );
}

type RouteContext = {
  params: Promise<{
    tagId: string;
  }>;
};

type UpdateTagBody = {
  name?: string;
  color?: string;
  sortIndex?: number;
  description?: string | null;
  isActive?: boolean;
};

function cleanOptionalText(
  value: string | null | undefined,
) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }
  const permissionGuard =
    await requirePermission("tags_quick_replies", "manage");

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  const currentMember =
    authResult.member;
  const { tagId } =
    await context.params;
  const normalizedTagId =
    tagId?.trim();

  if (!normalizedTagId) {
    return NextResponse.json(
      {
        success: false,
        error: "Tag ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  let body: UpdateTagBody;

  try {
    body =
      (await request.json()) as UpdateTagBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const updates: {
    name?: string;
    color?: string;
    sort_index?: number;
    description?: string | null;
    is_active?: boolean;
    updated_at: string;
  } = {
    updated_at:
      new Date().toISOString(),
  };

  if (body.name !== undefined) {
    const name = body.name.trim();

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tag name cannot be empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (name.length > 50) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tag name must be 50 characters or fewer.",
        },
        {
          status: 400,
        },
      );
    }

    updates.name = name;
  }

  if (body.color !== undefined) {
    const color =
      body.color.toUpperCase();

    if (!isValidHexColor(color)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Tag color must be a valid HEX color, for example #13C2C2.",
        },
        {
          status: 400,
        },
      );
    }

    updates.color = color;
  }

  if (body.sortIndex !== undefined) {
    if (!Number.isFinite(body.sortIndex)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "sortIndex must be a number.",
        },
        {
          status: 400,
        },
      );
    }

    updates.sort_index = Math.max(
      0,
      Math.trunc(body.sortIndex),
    );
  }

  if (
    body.description !== undefined
  ) {
    const description =
      cleanOptionalText(
        body.description,
      );

    if (
      description &&
      description.length > 500
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Description must be 500 characters or fewer.",
        },
        {
          status: 400,
        },
      );
    }

    updates.description =
      description;
  }

  if (body.isActive !== undefined) {
    updates.is_active =
      body.isActive;
  }

  const { data, error } =
    await supabaseAdmin
      .from("tags")
      .update(updates)
      .eq(
        "id",
        normalizedTagId,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .neq("name", DEFAULT_TAG_SEED_MARKER)
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
      .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error.code === "23505"
            ? "A tag with this name already exists."
            : "Unable to update tag.",
      },
      {
        status:
          error.code === "23505"
            ? 409
            : 500,
      },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Tag was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    success: true,
    tag: data,
  });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }
  const permissionGuard =
    await requirePermission("tags_quick_replies", "manage");

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  const currentMember =
    authResult.member;
  const { tagId } =
    await context.params;
  const normalizedTagId =
    tagId?.trim();

  if (!normalizedTagId) {
    return NextResponse.json(
      {
        success: false,
        error: "Tag ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: deleted,
    error,
  } = await supabaseAdmin
    .from("tags")
    .delete()
    .eq(
      "id",
      normalizedTagId,
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .neq("name", DEFAULT_TAG_SEED_MARKER)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete tag.",
      },
      {
        status: 500,
      },
    );
  }

  if (!deleted) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Tag was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    success: true,
  });
}
