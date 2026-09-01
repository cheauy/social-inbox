import { NextRequest, NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  FACEBOOK_REQUIRED_WEBHOOK_FIELDS,
  ensureFacebookPageWebhookSubscription,
} from "@/lib/facebook/facebook-connection-health";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscribeBody = {
  socialAccountId?: string;
};

type FacebookAccountRow = {
  id: string;
  platform_account_id: string | null;
  account_name: string | null;
};

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

  if (
    !(await memberHasPermission(authResult.member, "channels", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to manage channels in this workspace.",
    );
  }

  let body: SubscribeBody = {};

  try {
    const text = await request.text();
    body = text.trim()
      ? (JSON.parse(text) as SubscribeBody)
      : {};
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

  const requestedSocialAccountId =
    body.socialAccountId?.trim() || null;

  let query = supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      platform_account_id,
      account_name
    `)
    .eq(
      "business_id",
      authResult.member.business_id,
    )
    .eq("platform", "facebook")
    .eq("is_active", true)
    .or("facebook_token_status.is.null,facebook_token_status.neq.disconnected");

  if (requestedSocialAccountId) {
    query = query.eq(
      "id",
      requestedSocialAccountId,
    );
  }

  const {
    data: accountData,
    error: accountError,
  } = await query;

  if (accountError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load connected Facebook Pages.",
      },
      {
        status: 500,
      },
    );
  }

  const accounts =
    (accountData ?? []) as FacebookAccountRow[];

  if (accounts.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          "No active Facebook Page connection was found.",
      },
      {
        status: 404,
      },
    );
  }

  const results = [];

  for (const account of accounts) {
    const pageId =
      account.platform_account_id?.trim();
    const pageName =
      account.account_name?.trim() ||
      "Facebook Page";

    if (!pageId) {
      results.push({
        socialAccountId: account.id,
        pageId: null,
        pageName,
        success: false,
        error:
          "Connected Page has no Facebook Page ID.",
      });
      continue;
    }

    try {
      const repair =
        await ensureFacebookPageWebhookSubscription({
          pageId,
        });
      const errorMessage = repair.healthy
        ? null
        : repair.error ??
          "TENH could not verify all required Facebook webhook fields.";

      await supabaseAdmin
        .from("social_accounts")
        .update({
          facebook_token_last_error:
            errorMessage,
          ...(repair.healthy
            ? {
                facebook_token_status:
                  "connected",
              }
            : {}),
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", account.id)
        .eq(
          "business_id",
          authResult.member.business_id,
        );

      results.push({
        socialAccountId: account.id,
        pageId,
        pageName,
        success: repair.healthy,
        repaired: repair.repaired,
        tokenRepaired:
          repair.tokenRepaired,
        subscribedFields:
          repair.subscribedFields,
        missingFields:
          repair.missingFields,
        requiredFields:
          FACEBOOK_REQUIRED_WEBHOOK_FIELDS,
        error: errorMessage,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to repair the Facebook webhook subscription.";

      await supabaseAdmin
        .from("social_accounts")
        .update({
          facebook_token_last_error:
            errorMessage,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", account.id)
        .eq(
          "business_id",
          authResult.member.business_id,
        );

      results.push({
        socialAccountId: account.id,
        pageId,
        pageName,
        success: false,
        error: errorMessage,
      });
    }
  }

  const failed = results.filter(
    (result) => !result.success,
  );

  return NextResponse.json({
    success: failed.length === 0,
    repairedCount:
      results.length - failed.length,
    failedCount: failed.length,
    subscribedFields:
      FACEBOOK_REQUIRED_WEBHOOK_FIELDS,
    pages: results,
    ...(failed.length > 0
      ? {
          error:
            "One or more Facebook Pages could not be subscribed. Check the returned Page details.",
        }
      : {}),
  });
}
