import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

type TagBody = {
  tagId?: string;
};

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  const { contactId } = await context.params;

  let body: TagBody;

  try {
    body = (await request.json()) as TagBody;
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

  const tagId = body.tagId?.trim();

  if (!tagId) {
    return NextResponse.json(
      {
        success: false,
        error: "tagId is required.",
      },
      {
        status: 400,
      },
    );
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id,business_id")
    .eq("id", contactId)
    .maybeSingle();

  const { data: tag } = await supabaseAdmin
    .from("tags")
    .select("id,business_id")
    .eq("id", tagId)
    .maybeSingle();

  if (
    !contact ||
    !tag ||
    contact.business_id !== tag.business_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer or matching business tag was not found.",
      },
      {
        status: 400,
      },
    );
  }

  const { error } = await supabaseAdmin
    .from("contact_tags")
    .upsert(
      {
        contact_id: contactId,
        tag_id: tagId,
      },
      {
        onConflict: "contact_id,tag_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to assign tag to customer.",
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

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  const { contactId } = await context.params;

  let body: TagBody;

  try {
    body = (await request.json()) as TagBody;
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

  const tagId = body.tagId?.trim();

  if (!tagId) {
    return NextResponse.json(
      {
        success: false,
        error: "tagId is required.",
      },
      {
        status: 400,
      },
    );
  }

  const { error } = await supabaseAdmin
    .from("contact_tags")
    .delete()
    .eq("contact_id", contactId)
    .eq("tag_id", tagId);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to remove tag from customer.",
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
