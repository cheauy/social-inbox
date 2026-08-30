import "server-only";

import { createHash } from "node:crypto";

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
  sanitizeFacebookDiagnosticValue,
} from "@/lib/facebook/sanitize-facebook-diagnostic";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_MESSENGER_SCOPES = [
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_messaging",
] as const;

type GraphCallResult = {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  error: string | null;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function cleanStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function unixToIso(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return new Date(numeric * 1000).toISOString();
}

function tokenFingerprint(token: string) {
  return createHash("sha256")
    .update(token)
    .digest("hex")
    .slice(0, 12);
}

async function graphGet({
  path,
  bearerToken,
  params,
}: {
  path: string;
  bearerToken: string;
  params?: Record<string, string>;
}): Promise<GraphCallResult> {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${path}`,
  );

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};

    if (text.trim()) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          status: response.status,
          data: {},
          error: `Meta returned invalid JSON (${response.status}).`,
        };
      }
    }

    const graphError = isRecord(data.error)
      ? data.error
      : null;

    return {
      ok: response.ok && !graphError,
      status: response.status,
      data,
      error:
        cleanString(graphError?.message) ??
        (!response.ok
          ? `Meta returned HTTP ${response.status}.`
          : null),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {},
      error:
        error instanceof Error
          ? error.message
          : "Meta request failed.",
    };
  }
}

async function debugPageToken({
  pageAccessToken,
  appAccessToken,
}: {
  pageAccessToken: string;
  appAccessToken: string;
}): Promise<GraphCallResult> {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/debug_token`,
  );

  // Meta's debug_token endpoint requires input_token as a query parameter.
  // TENH never logs or returns this URL, and the response is reconstructed
  // below so the page token itself is not exposed.
  url.searchParams.set("input_token", pageAccessToken);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
      },
    });

    const text = await response.text();
    let data: Record<string, unknown> = {};

    if (text.trim()) {
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          status: response.status,
          data: {},
          error: `Meta returned invalid JSON (${response.status}).`,
        };
      }
    }

    const graphError = isRecord(data.error)
      ? data.error
      : null;

    return {
      ok: response.ok && !graphError,
      status: response.status,
      data,
      error:
        cleanString(graphError?.message) ??
        (!response.ok
          ? `Meta returned HTTP ${response.status}.`
          : null),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {},
      error:
        error instanceof Error
          ? error.message
          : "Meta token debug request failed.",
    };
  }
}

function getAppAccessToken() {
  const explicit =
    process.env.FACEBOOK_APP_ACCESS_TOKEN?.trim();

  if (explicit) {
    return {
      token: explicit,
      source: "FACEBOOK_APP_ACCESS_TOKEN",
    } as const;
  }

  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret =
    process.env.FACEBOOK_APP_SECRET?.trim();

  if (appId && appSecret) {
    return {
      token: `${appId}|${appSecret}`,
      source: "FACEBOOK_APP_ID + FACEBOOK_APP_SECRET",
    } as const;
  }

  return {
    token: null,
    source: null,
  } as const;
}

function normalizeGranularScopes(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<{
      scope: string;
      targetIds: string[];
    }>;
  }

  const output: Array<{
    scope: string;
    targetIds: string[];
  }> = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const scope = cleanString(item.scope);

    if (!scope) {
      continue;
    }

    output.push({
      scope,
      targetIds: cleanStringArray(item.target_ids),
    });
  }

  return output;
}

export async function GET() {
  const authResult = await getCurrentMember();

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

  const currentMember = authResult.member;

  if (
    !(await memberHasPermission(currentMember, "channels", "view"))
  ) {
    return permissionDenied(
      "You do not have permission to view channels in this workspace.",
    );
  }

  // V3.1.15.1 — diagnostic route access follows the current TENH
  // membership model. getCurrentMember() has already authenticated an active
  // member and every query below remains business-scoped by business_id.
  // Do not hard-code legacy role names here because current TENH workspaces
  // can expose a different role label while still being a valid member.

  const { data: socialAccounts, error: socialAccountsError } =
    await supabaseAdmin
      .from("social_accounts")
      .select(`
        id,
        platform,
        platform_account_id,
        account_name,
        is_active,
        facebook_token_status
      `)
      .eq("business_id", currentMember.business_id)
      .eq("platform", "facebook")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

  if (socialAccountsError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load connected Facebook Pages.",
        details: socialAccountsError.message,
      },
      {
        status: 500,
      },
    );
  }

  const configuredAppId =
    process.env.FACEBOOK_APP_ID?.trim() ?? null;
  const appAccess = getAppAccessToken();
  const pages = [] as Array<Record<string, unknown>>;

  for (const socialAccount of socialAccounts ?? []) {
    const pageId =
      socialAccount.platform_account_id?.trim();

    if (!pageId) {
      pages.push({
        socialAccountId: socialAccount.id,
        ok: false,
        error: "Connected Page is missing platform_account_id.",
      });
      continue;
    }

    let pageAccessToken: string;

    try {
      pageAccessToken =
        await getFacebookPageAccessToken(pageId);
    } catch (error) {
      pages.push({
        socialAccountId: socialAccount.id,
        pageId,
        pageName: socialAccount.account_name ?? null,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Facebook Page token.",
      });
      continue;
    }

    const [identityProbe, conversationsProbe, subscriptionProbe] =
      await Promise.all([
        graphGet({
          path: "me",
          bearerToken: pageAccessToken,
          params: {
            fields: "id,name",
          },
        }),
        graphGet({
          path: `${pageId}/conversations`,
          bearerToken: pageAccessToken,
          params: {
            fields: "id,updated_time",
            limit: "1",
          },
        }),
        graphGet({
          path: `${pageId}/subscribed_apps`,
          bearerToken: pageAccessToken,
        }),
      ]);

    let tokenDebug: GraphCallResult | null = null;

    if (appAccess.token) {
      tokenDebug = await debugPageToken({
        pageAccessToken,
        appAccessToken: appAccess.token,
      });
    }

    const debugData =
      tokenDebug && isRecord(tokenDebug.data.data)
        ? tokenDebug.data.data
        : null;

    const scopes = cleanStringArray(debugData?.scopes);
    const granularScopes = normalizeGranularScopes(
      debugData?.granular_scopes,
    );

    const allScopeNames = new Set([
      ...scopes,
      ...granularScopes.map((item) => item.scope),
    ]);

    const missingRequiredScopes =
      tokenDebug?.ok
        ? REQUIRED_MESSENGER_SCOPES.filter(
            (scope) => !allScopeNames.has(scope),
          )
        : [];

    const granularTargetChecks =
      REQUIRED_MESSENGER_SCOPES.map((scope) => {
        const granular = granularScopes.find(
          (item) => item.scope === scope,
        );

        return {
          scope,
          present:
            allScopeNames.has(scope),
          hasExplicitTargets:
            Boolean(granular?.targetIds.length),
          targetsThisPage:
            granular?.targetIds.length
              ? granular.targetIds.includes(pageId)
              : null,
          targetIds:
            granular?.targetIds ?? [],
        };
      });

    const subscribedApps = Array.isArray(
      subscriptionProbe.data.data,
    )
      ? subscriptionProbe.data.data
      : [];

    const configuredAppEntry =
      configuredAppId
        ? subscribedApps.find(
            (item) =>
              isRecord(item) &&
              cleanString(item.id) === configuredAppId,
          )
        : null;

    const configuredSubscribedFields =
      isRecord(configuredAppEntry)
        ? cleanStringArray(
            configuredAppEntry.subscribed_fields,
          )
        : [];

    const debugAppId = cleanString(debugData?.app_id);
    const pageIdentityId = cleanString(
      identityProbe.data.id,
    );

    const tokenValid =
      debugData?.is_valid === true;
    const appMatches =
      configuredAppId && debugAppId
        ? configuredAppId === debugAppId
        : null;
    const identityMatchesPage =
      pageIdentityId
        ? pageIdentityId === pageId
        : false;

    const technicalMessengerAccessHealthy =
      identityProbe.ok &&
      identityMatchesPage &&
      conversationsProbe.ok &&
      subscriptionProbe.ok &&
      (!tokenDebug ||
        !tokenDebug.ok ||
        (tokenValid &&
          missingRequiredScopes.length === 0 &&
          appMatches !== false));

    pages.push({
      socialAccountId: socialAccount.id,
      pageId,
      pageName:
        cleanString(identityProbe.data.name) ??
        socialAccount.account_name ??
        null,
      ok: technicalMessengerAccessHealthy,
      token: {
        // A short SHA-256 fingerprint lets the owner confirm whether a
        // reconnect actually changed the token without exposing any token bytes.
        fingerprint: tokenFingerprint(pageAccessToken),
        storedStatus:
          socialAccount.facebook_token_status ?? null,
      },
      pageIdentity: {
        ok: identityProbe.ok,
        status: identityProbe.status,
        returnedPageId: pageIdentityId,
        matchesConnectedPage:
          identityMatchesPage,
        error: identityProbe.error,
      },
      conversationsAccess: {
        ok: conversationsProbe.ok,
        status: conversationsProbe.status,
        returnedConversationCount:
          Array.isArray(conversationsProbe.data.data)
            ? conversationsProbe.data.data.length
            : 0,
        error: conversationsProbe.error,
      },
      webhookSubscription: {
        ok: subscriptionProbe.ok,
        status: subscriptionProbe.status,
        configuredAppId,
        configuredAppFound:
          Boolean(configuredAppEntry),
        subscribedFields:
          configuredSubscribedFields,
        hasMessages:
          configuredSubscribedFields.includes(
            "messages",
          ),
        hasFeed:
          configuredSubscribedFields.includes(
            "feed",
          ),
        error: subscriptionProbe.error,
      },
      tokenDebug: appAccess.token
        ? {
            available: true,
            appAccessTokenSource:
              appAccess.source,
            ok: tokenDebug?.ok ?? false,
            status: tokenDebug?.status ?? 0,
            error: tokenDebug?.error ?? null,
            isValid: tokenValid,
            tokenType:
              cleanString(debugData?.type),
            application:
              cleanString(debugData?.application),
            tokenAppId: debugAppId,
            configuredAppId,
            appMatches,
            expiresAt:
              unixToIso(debugData?.expires_at),
            dataAccessExpiresAt:
              unixToIso(
                debugData?.data_access_expires_at,
              ),
            scopes,
            granularScopes,
            requiredMessengerScopes:
              REQUIRED_MESSENGER_SCOPES,
            missingRequiredScopes,
            granularTargetChecks,
          }
        : {
            available: false,
            reason:
              "Add FACEBOOK_APP_SECRET (with FACEBOOK_APP_ID) or FACEBOOK_APP_ACCESS_TOKEN to enable /debug_token scope inspection.",
            configuredAppIdPresent:
              Boolean(configuredAppId),
            facebookAppSecretPresent:
              Boolean(
                process.env.FACEBOOK_APP_SECRET?.trim(),
              ),
            facebookAppAccessTokenPresent:
              Boolean(
                process.env.FACEBOOK_APP_ACCESS_TOKEN?.trim(),
              ),
          },
      manualAppReviewChecks: [
        {
          name: "Advanced Access for Messenger permissions",
          why:
            "Meta requires Advanced Access for conversations with people who do not have a role on the app/Page/business.",
          canAuditAutomatically: false,
          path:
            "Meta App Dashboard -> App Review -> Permissions and Features",
        },
        {
          name: "Business Asset User Profile Access",
          why:
            "Check whether this App Review feature is available/approved for TENH before the next real-avatar test.",
          canAuditAutomatically: false,
          path:
            "Meta App Dashboard -> App Review -> Permissions and Features",
        },
      ],
      avatarNextDecision:
        tokenDebug?.ok &&
        tokenValid &&
        missingRequiredScopes.length === 0 &&
        appMatches !== false &&
        conversationsProbe.ok
          ? "Base Messenger token/scopes look healthy. Next inspect App Review access level/features, especially Business Asset User Profile Access, then retry a real PSID user-field request only after that access is approved."
          : "Fix the failed token/app/scope checks above before trying another real-avatar endpoint.",
    });
  }

  const response = {
    success: true,
    version: "V3.1.15",
    purpose:
      "Meta access audit + secret-safe diagnostics before the next real Facebook avatar attempt.",
    configuredAppId,
    graphVersion:
      process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
      "v26.0",
    requiredMessengerScopes:
      REQUIRED_MESSENGER_SCOPES,
    pageCount: pages.length,
    pages,
    security: {
      accessTokensReturned: false,
      appSecretsReturned: false,
      diagnosticUrlsSanitized: true,
      note:
        "If a Page token was previously pasted into chat/logs, reconnect or rotate it before continuing.",
    },
    nextStep:
      "Open the manual App Review checks shown for the Page, then send the complete sanitized JSON from this endpoint back before V3.1.16 avatar work.",
  };

  return NextResponse.json(
    sanitizeFacebookDiagnosticValue(response),
    {
      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate",
      },
    },
  );
}