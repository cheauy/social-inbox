import { NextRequest, NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
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

type GraphResult = {
  success?: boolean;
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
};

async function readGraphResult(
  response: Response,
): Promise<GraphResult> {
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as GraphResult;
  } catch {
    return {};
  }
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

  if (authResult.member.role !== "owner") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Only the workspace owner can repair Facebook webhook subscriptions.",
      },
      {
        status: 403,
      },
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
    .eq("is_active", true);

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

  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION
      ?.trim() || "v26.0";

  const subscribedFields = [
    "messages",
    "feed",
    "messaging_postbacks",
    "message_deliveries",
    "message_reads",
  ];

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
      const pageAccessToken =
        await getFacebookPageAccessToken(
          pageId,
        );

      const url = new URL(
        `https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`,
      );
      url.searchParams.set(
        "subscribed_fields",
        subscribedFields.join(","),
      );
      url.searchParams.set(
        "access_token",
        pageAccessToken,
      );

      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
      });
      const result =
        await readGraphResult(response);

      const success =
        response.ok &&
        result.success !== false;
      const errorMessage = success
        ? null
        : result.error?.message ??
          `Meta returned HTTP ${response.status}.`;

      await supabaseAdmin
        .from("social_accounts")
        .update({
          facebook_token_last_error:
            errorMessage,
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
        success,
        subscribedFields,
        error: errorMessage,
        details: result.error ?? null,
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
    subscribedFields,
    pages: results,
    ...(failed.length > 0
      ? {
          error:
            "One or more Facebook Pages could not be subscribed. Check the returned Page details.",
        }
      : {}),
  });
}
