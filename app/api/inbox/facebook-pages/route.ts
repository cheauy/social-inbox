import {
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      platform_account_id,
      account_name,
      facebook_token_status
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "platform",
      "facebook",
    )
    .eq(
      "is_active",
      true,
    )
    .order(
      "created_at",
      {
        ascending: true,
      },
    );

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load connected Facebook Pages.",
        details:
          error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json(
    {
      success: true,
      pages:
        (data ?? []).map(
          (page) => ({
            id:
              page.id,
            pageId:
              page.platform_account_id,
            name:
              page.account_name ??
              "Facebook Page",
            tokenStatus:
              page.facebook_token_status ??
              null,
          }),
        ),
    },
    {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    },
  );
}
