import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidHexColor(
  value: string,
) {
  return /^#[0-9A-F]{6}$/i.test(
    value,
  );
}

type CreateTagBody = {
  /* Kept for backward-compatible client payloads. */
  businessId?: string;
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

export async function GET(
  request: NextRequest,
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

  const currentMember =
    authResult.member;

  const activeOnly =
    request.nextUrl.searchParams.get(
      "activeOnly",
    ) === "true";

  /* Ignore browser-supplied businessId and use the authenticated workspace. */
  let query = supabaseAdmin
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
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .order("is_active", {
      ascending: false,
    })
    .order("sort_index", {
      ascending: true,
    })
    .order("name", {
      ascending: true,
    });

  if (activeOnly) {
    query = query.eq(
      "is_active",
      true,
    );
  }

  const { data, error } =
    await query;

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load tags.",
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    tags: data ?? [],
  });
}

export async function POST(
  request: NextRequest,
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

  const currentMember =
    authResult.member;

  let body: CreateTagBody;

  try {
    body =
      (await request.json()) as CreateTagBody;
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

  const name = body.name?.trim();
  const color = (
    body.color ?? "#64748B"
  ).toUpperCase();
  const sortIndex =
    Number.isFinite(body.sortIndex)
      ? Math.max(
          0,
          Math.trunc(
            body.sortIndex as number,
          ),
        )
      : 0;
  const description =
    cleanOptionalText(
      body.description,
    );
  const isActive =
    body.isActive ?? true;

  if (!name) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Tag name is required.",
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

  const { data: existing } =
    await supabaseAdmin
      .from("tags")
      .select("id")
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .ilike("name", name)
      .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        success: false,
        error:
          "A tag with this name already exists.",
      },
      {
        status: 409,
      },
    );
  }

  const { data, error } =
    await supabaseAdmin
      .from("tags")
      .insert({
        business_id:
          currentMember.business_id,
        name,
        color,
        sort_index: sortIndex,
        description,
        is_active: isActive,
      })
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
      .single();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error.code === "23505"
            ? "A tag with this name already exists."
            : "Unable to create tag.",
      },
      {
        status:
          error.code === "23505"
            ? 409
            : 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    tag: data,
  });
}
