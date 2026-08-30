import { NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GraphSubscribedApp = {
  id?: string;
  name?: string;
  subscribed_fields?: unknown;
};

type GraphSubscribedAppsResponse = {
  data?: unknown;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

function cleanStringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string",
  );
}

function cleanSubscribedApps(
  value: unknown,
): Array<{
  id: string | null;
  name: string | null;
  subscribedFields: string[];
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is GraphSubscribedApp =>
        Boolean(item) &&
        typeof item === "object" &&
        !Array.isArray(item),
    )
    .map((item) => ({
      id:
        typeof item.id === "string"
          ? item.id
          : null,
      name:
        typeof item.name === "string"
          ? item.name
          : null,
      subscribedFields:
        cleanStringArray(
          item.subscribed_fields,
        ),
    }));
}

export async function GET() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  if (
    !(await memberHasPermission(currentMember, "channels", "view"))
  ) {
    return permissionDenied(
      "You do not have permission to view channels in this workspace.",
    );
  }

  const {
    data: accounts,
    error: accountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      platform,
      platform_account_id,
      is_active
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
    );

  if (accountError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load connected Facebook Pages.",
        details:
          accountError.message,
      },
      {
        status: 500,
      },
    );
  }

  const graphVersion =
    process.env
      .FACEBOOK_GRAPH_API_VERSION
      ?.trim() ||
    "v26.0";

  const configuredAppId =
    process.env
      .FACEBOOK_APP_ID
      ?.trim() ||
    null;

  const pages =
    await Promise.all(
      (accounts ?? []).map(
        async (account) => {
          const pageId =
            account.platform_account_id
              ?.trim();

          if (!pageId) {
            return {
              socialAccountId:
                account.id,
              pageId: null,
              ok: false,
              targetAppFound:
                false,
              targetAppHasFeed:
                false,
              subscribedApps: [],
              error:
                "Connected Facebook Page has no platform_account_id.",
            };
          }

          try {
            const pageAccessToken =
              await getFacebookPageAccessToken(
                pageId,
              );

            const graphUrl =
              new URL(
                `https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`,
              );

            graphUrl.searchParams.set(
              "access_token",
              pageAccessToken,
            );

            const response =
              await fetch(
                graphUrl,
                {
                  cache:
                    "no-store",
                },
              );

            let payload:
              GraphSubscribedAppsResponse =
              {};

            try {
              payload =
                (await response.json()) as
                  GraphSubscribedAppsResponse;
            } catch {
              // Response validation below reports a useful failure.
            }

            const subscribedApps =
              cleanSubscribedApps(
                payload.data,
              );

            const targetApps =
              configuredAppId
                ? subscribedApps.filter(
                    (app) =>
                      app.id ===
                      configuredAppId,
                  )
                : subscribedApps;

            const targetAppHasFeed =
              targetApps.some(
                (app) =>
                  app.subscribedFields.includes(
                    "feed",
                  ),
              );

            return {
              socialAccountId:
                account.id,
              pageId,
              ok:
                response.ok &&
                !payload.error,
              configuredAppId,
              targetAppFound:
                configuredAppId
                  ? targetApps.length >
                    0
                  : null,
              targetAppHasFeed,
              expectedCommentField:
                "feed",
              subscribedApps,
              error:
                payload.error
                  ?.message ??
                (!response.ok
                  ? `Meta returned HTTP ${response.status}.`
                  : null),
            };
          } catch (
            error
          ) {
            return {
              socialAccountId:
                account.id,
              pageId,
              ok: false,
              configuredAppId,
              targetAppFound:
                false,
              targetAppHasFeed:
                false,
              expectedCommentField:
                "feed",
              subscribedApps: [],
              error:
                error instanceof
                Error
                  ? error.message
                  : "Unable to inspect the Facebook Page webhook subscription.",
            };
          }
        },
      ),
    );

  return NextResponse.json({
    success: true,
    expectedCommentField:
      "feed",
    configuredAppId,
    pageCount:
      pages.length,
    pages,
  });
}
