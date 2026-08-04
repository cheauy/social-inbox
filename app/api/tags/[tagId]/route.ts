import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TagColor } from "@/types/inbox";

function isValidHexColor(value: string) {
  return /^#[0-9A-F]{6}$/i.test(value);
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
  const { tagId } = await context.params;

  let body: UpdateTagBody;

  try {
    body = (await request.json()) as UpdateTagBody;
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
    updated_at: new Date().toISOString(),
  };

  if (body.name !== undefined) {
    const name = body.name.trim();

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          error: "Tag name cannot be empty.",
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
  const color = body.color.toUpperCase();

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
    updates.sort_index = Math.max(
      0,
      Math.trunc(body.sortIndex),
    );
  }

  if (body.description !== undefined) {
    const description = cleanOptionalText(
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

    updates.description = description;
  }

  if (body.isActive !== undefined) {
    updates.is_active = body.isActive;
  }

  const { data, error } = await supabaseAdmin
    .from("tags")
    .update(updates)
    .eq("id", tagId)
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
        error: "Unable to update tag.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!data) {
    return NextResponse.json(
      {
        success: false,
        error: "Tag was not found.",
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
  const { tagId } = await context.params;

  const { error } = await supabaseAdmin
    .from("tags")
    .delete()
    .eq("id", tagId);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete tag.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
  });
}
