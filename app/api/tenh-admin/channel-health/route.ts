import "server-only";

import { lookup } from "node:dns/promises";

import { NextRequest, NextResponse } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { getTelegramMe, getTelegramWebhookInfo } from "@/lib/telegram/telegram-api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REQUIRED_MESSENGER_SCOPES = [
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_messaging",
] as const;

const REQUIRED_TELEGRAM_UPDATES = ["message", "edited_message"] as const;

type HealthStatus = "healthy" | "warning" | "error";
type PlatformFilter = "all" | "messenger" | "telegram" | "system";
type CheckValue = boolean | null;

type MessengerRow = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  facebook_token_status: string | null;
  facebook_token_last_error: string | null;
};

type TelegramRow = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  telegram_bot_username: string | null;
  telegram_token_status: string | null;
  telegram_bot_token_encrypted: string | null;
  telegram_webhook_status: string | null;
  telegram_webhook_url: string | null;
  telegram_webhook_last_error: string | null;
};

type ActivitySnapshot = {
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  failedOutbound24h: number;
  error: string | null;
};

type SystemCheck = {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanString(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function summarize(items: Array<{ status: HealthStatus }>) {
  return {
    total: items.length,
    healthy: items.filter((item) => item.status === "healthy").length,
    warning: items.filter((item) => item.status === "warning").length,
    error: items.filter((item) => item.status === "error").length,
  };
}

function getAppAccessToken() {
  const explicit = process.env.FACEBOOK_APP_ACCESS_TOKEN?.trim();

  if (explicit) {
    return explicit;
  }

  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();

  return appId && appSecret ? `${appId}|${appSecret}` : null;
}

async function graphGet(
  path: string,
  bearerToken: string,
  params?: Record<string, string>,
) {
  const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};

  if (text.trim()) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Meta returned invalid JSON (${response.status}).`);
    }
  }

  if (!response.ok || payload.error) {
    const graphError = isRecord(payload.error) ? payload.error : null;

    throw new Error(
      cleanString(graphError?.message) ?? `Meta returned HTTP ${response.status}.`,
    );
  }

  return payload;
}

async function debugFacebookToken(pageAccessToken: string) {
  const appAccessToken = getAppAccessToken();

  if (!appAccessToken) {
    return {
      available: false as const,
      valid: null,
      appMatches: null,
      missingScopes: [] as string[],
      expiresAt: null as string | null,
      error: null as string | null,
    };
  }

  const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
  const url = new URL(`https://graph.facebook.com/${graphVersion}/debug_token`);
  url.searchParams.set("input_token", pageAccessToken);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
      },
    });

    const payload = (await response.json()) as Record<string, unknown>;
    const graphError = isRecord(payload.error) ? payload.error : null;

    if (!response.ok || graphError) {
      return {
        available: true as const,
        valid: false,
        appMatches: null,
        missingScopes: [] as string[],
        expiresAt: null,
        error:
          cleanString(graphError?.message) ?? `Meta debug_token returned HTTP ${response.status}.`,
      };
    }

    const data = isRecord(payload.data) ? payload.data : null;
    const scopes = new Set(cleanStringArray(data?.scopes));
    const granularScopes = Array.isArray(data?.granular_scopes)
      ? data.granular_scopes
          .filter(isRecord)
          .map((item) => cleanString(item.scope))
          .filter((item): item is string => Boolean(item))
      : [];

    for (const scope of granularScopes) {
      scopes.add(scope);
    }

    const missingScopes = REQUIRED_MESSENGER_SCOPES.filter(
      (scope) => !scopes.has(scope),
    );

    const configuredAppId = process.env.FACEBOOK_APP_ID?.trim() ?? null;
    const tokenAppId = cleanString(data?.app_id);
    const expiresUnix =
      typeof data?.expires_at === "number"
        ? data.expires_at
        : typeof data?.expires_at === "string"
          ? Number(data.expires_at)
          : Number.NaN;

    return {
      available: true as const,
      valid: data?.is_valid === true,
      appMatches:
        configuredAppId && tokenAppId ? configuredAppId === tokenAppId : null,
      missingScopes,
      expiresAt:
        Number.isFinite(expiresUnix) && expiresUnix > 0
          ? new Date(expiresUnix * 1000).toISOString()
          : null,
      error: null,
    };
  } catch (error) {
    return {
      available: true as const,
      valid: false,
      appMatches: null,
      missingScopes: [] as string[],
      expiresAt: null,
      error: errorMessage(error, "Meta token debug request failed."),
    };
  }
}

async function loadRecentActivity(
  businessId: string,
  socialAccountId: string,
): Promise<ActivitySnapshot> {
  const empty: ActivitySnapshot = {
    lastInboundAt: null,
    lastOutboundAt: null,
    failedOutbound24h: 0,
    error: null,
  };

  try {
    const { data: conversations, error: conversationError } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("social_account_id", socialAccountId)
      .limit(500);

    if (conversationError) {
      return {
        ...empty,
        error: conversationError.message,
      };
    }

    const conversationIds = (conversations ?? [])
      .map((row) => cleanString((row as { id?: unknown }).id))
      .filter((id): id is string => Boolean(id));

    if (conversationIds.length === 0) {
      return empty;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [incomingResult, outgoingResult, failedResult] = await Promise.all([
      supabaseAdmin
        .from("messages")
        .select("platform_created_at")
        .eq("business_id", businessId)
        .in("conversation_id", conversationIds)
        .eq("direction", "incoming")
        .not("platform_created_at", "is", null)
        .order("platform_created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("messages")
        .select("platform_created_at")
        .eq("business_id", businessId)
        .in("conversation_id", conversationIds)
        .eq("direction", "outgoing")
        .not("platform_created_at", "is", null)
        .order("platform_created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .in("conversation_id", conversationIds)
        .eq("direction", "outgoing")
        .eq("delivery_status", "failed")
        .gte("platform_created_at", since),
    ]);

    const firstError =
      incomingResult.error?.message ??
      outgoingResult.error?.message ??
      failedResult.error?.message ??
      null;

    return {
      lastInboundAt: cleanString(
        (incomingResult.data as { platform_created_at?: unknown } | null)
          ?.platform_created_at,
      ),
      lastOutboundAt: cleanString(
        (outgoingResult.data as { platform_created_at?: unknown } | null)
          ?.platform_created_at,
      ),
      failedOutbound24h: failedResult.count ?? 0,
      error: firstError,
    };
  } catch (error) {
    return {
      ...empty,
      error: errorMessage(error, "Unable to load recent channel activity."),
    };
  }
}

async function runMessengerDiagnostics() {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(
      "id,business_id,platform_account_id,account_name,is_active,facebook_token_status,facebook_token_last_error",
    )
    .eq("platform", "facebook")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`social_accounts (Messenger): ${error.message}`);
  }

  const rows = (data ?? []) as MessengerRow[];
  const configuredAppId = process.env.FACEBOOK_APP_ID?.trim() ?? null;

  const items = await Promise.all(
    rows.map(async (row) => {
      const pageId = row.platform_account_id?.trim() ?? "";
      const activityPromise = loadRecentActivity(row.business_id, row.id);
      const base = {
        id: row.id,
        businessId: row.business_id,
        name: row.account_name ?? "Facebook Page",
        pageId: pageId || null,
        tokenStatus: row.facebook_token_status,
        localError: row.facebook_token_last_error,
      };

      if (!pageId) {
        return {
          ...base,
          status: "error" as const,
          checks: {
            token: false as CheckValue,
            identity: false as CheckValue,
            conversations: false as CheckValue,
            webhook: false as CheckValue,
            messagesField: false as CheckValue,
            feedField: null as CheckValue,
            permissions: null as CheckValue,
          },
          permissions: {
            available: false,
            missingScopes: [] as string[],
            expiresAt: null as string | null,
            error: "Page ID is missing.",
          },
          activity: await activityPromise,
          detail: "Connected Messenger channel is missing its Facebook Page ID.",
        };
      }

      try {
        const token = await getFacebookPageAccessToken(pageId);
        const [identityResult, conversationsResult, subscriptionResult, debugResult] =
          await Promise.allSettled([
            graphGet("me", token, { fields: "id,name" }),
            graphGet(`${encodeURIComponent(pageId)}/conversations`, token, {
              fields: "id,updated_time",
              limit: "1",
            }),
            graphGet(`${encodeURIComponent(pageId)}/subscribed_apps`, token),
            debugFacebookToken(token),
          ]);

        const identity =
          identityResult.status === "fulfilled" ? identityResult.value : null;
        const returnedId = cleanString(identity?.id);
        const identityOk = returnedId === pageId;
        const tokenOk = identityResult.status === "fulfilled" && identityOk;
        const conversationsOk = conversationsResult.status === "fulfilled";

        let webhookOk = false;
        let messagesField: CheckValue = false;
        let feedField: CheckValue = false;

        if (subscriptionResult.status === "fulfilled") {
          const subscriptions = Array.isArray(subscriptionResult.value.data)
            ? subscriptionResult.value.data.filter(isRecord)
            : [];
          const appSubscription = configuredAppId
            ? subscriptions.find((item) => cleanString(item.id) === configuredAppId) ?? null
            : subscriptions[0] ?? null;
          const subscribedFields = appSubscription
            ? cleanStringArray(appSubscription.subscribed_fields)
            : [];

          webhookOk = configuredAppId
            ? Boolean(appSubscription)
            : subscriptions.length > 0;
          messagesField = webhookOk ? subscribedFields.includes("messages") : false;
          feedField = webhookOk ? subscribedFields.includes("feed") : false;
        }

        const debug =
          debugResult.status === "fulfilled"
            ? debugResult.value
            : {
                available: true as const,
                valid: false,
                appMatches: null,
                missingScopes: [] as string[],
                expiresAt: null,
                error: errorMessage(debugResult.reason, "Token debug failed."),
              };

        const permissionsOk: CheckValue = debug.available
          ? debug.valid && debug.appMatches !== false && debug.missingScopes.length === 0
          : null;

        const activity = await activityPromise;
        const criticalFailure =
          !tokenOk || !identityOk || !conversationsOk || !webhookOk || messagesField !== true;
        const warning =
          !criticalFailure &&
          (permissionsOk === false ||
            permissionsOk === null ||
            feedField === false ||
            Boolean(row.facebook_token_last_error) ||
            activity.failedOutbound24h > 0 ||
            Boolean(activity.error));

        const status: HealthStatus = criticalFailure
          ? "error"
          : warning
            ? "warning"
            : "healthy";

        let detail = "Messenger token, conversations access, and webhook subscription are healthy.";

        if (!tokenOk) {
          detail =
            identityResult.status === "rejected"
              ? errorMessage(identityResult.reason, "Facebook Page token check failed.")
              : "Facebook Page identity did not match the connected Page.";
        } else if (!conversationsOk) {
          detail =
            conversationsResult.status === "rejected"
              ? errorMessage(
                  conversationsResult.reason,
                  "Meta conversations access check failed.",
                )
              : "Meta conversations access check failed.";
        } else if (!webhookOk) {
          detail = configuredAppId
            ? "TENH's configured Meta app is not confirmed in the Page webhook subscriptions."
            : "No active Meta app webhook subscription was confirmed for this Page.";
        } else if (messagesField !== true) {
          detail = "The Meta Page webhook is connected, but the messages field is not subscribed.";
        } else if (permissionsOk === false) {
          detail = debug.error
            ? `Messenger is reachable, but permission diagnostics returned: ${debug.error}`
            : `Messenger is reachable, but required scopes are missing: ${debug.missingScopes.join(", ") || "unknown"}.`;
        } else if (activity.failedOutbound24h > 0) {
          detail = `Live API checks passed, but TENH recorded ${activity.failedOutbound24h} failed outgoing message(s) in the last 24 hours.`;
        } else if (feedField === false) {
          detail = "Messenger messaging is healthy. The feed webhook field is not subscribed, so Facebook comment events may not arrive.";
        }

        return {
          ...base,
          name: cleanString(identity?.name) ?? base.name,
          status,
          checks: {
            token: tokenOk,
            identity: identityOk,
            conversations: conversationsOk,
            webhook: webhookOk,
            messagesField,
            feedField,
            permissions: permissionsOk,
          },
          permissions: {
            available: debug.available,
            missingScopes: debug.missingScopes,
            expiresAt: debug.expiresAt,
            error: debug.error,
          },
          activity,
          detail,
        };
      } catch (diagnosticError) {
        return {
          ...base,
          status: "error" as const,
          checks: {
            token: false as CheckValue,
            identity: false as CheckValue,
            conversations: false as CheckValue,
            webhook: false as CheckValue,
            messagesField: false as CheckValue,
            feedField: null as CheckValue,
            permissions: null as CheckValue,
          },
          permissions: {
            available: false,
            missingScopes: [] as string[],
            expiresAt: null as string | null,
            error: null as string | null,
          },
          activity: await activityPromise,
          detail: errorMessage(diagnosticError, "Unable to run Messenger diagnostics."),
        };
      }
    }),
  );

  return {
    summary: summarize(items),
    items,
  };
}

async function runTelegramDiagnostics() {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(
      "id,business_id,platform_account_id,account_name,is_active,telegram_bot_username,telegram_token_status,telegram_bot_token_encrypted,telegram_webhook_status,telegram_webhook_url,telegram_webhook_last_error",
    )
    .eq("platform", "telegram")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`social_accounts (Telegram): ${error.message}`);
  }

  const rows = (data ?? []) as TelegramRow[];

  const items = await Promise.all(
    rows.map(async (row) => {
      const activityPromise = loadRecentActivity(row.business_id, row.id);
      const base = {
        id: row.id,
        businessId: row.business_id,
        name: row.account_name ?? row.telegram_bot_username ?? "Telegram Bot",
        username: row.telegram_bot_username,
        tokenStatus: row.telegram_token_status,
        webhookStatus: row.telegram_webhook_status,
        expectedWebhookUrl: row.telegram_webhook_url,
        localError: row.telegram_webhook_last_error,
      };

      if (!row.telegram_bot_token_encrypted) {
        return {
          ...base,
          status: "error" as const,
          checks: {
            token: false as CheckValue,
            localToken: false as CheckValue,
            webhook: false as CheckValue,
            webhookUrl: false as CheckValue,
            allowedUpdates: false as CheckValue,
          },
          pendingUpdates: null as number | null,
          remoteWebhookError: null as string | null,
          remoteWebhookErrorAt: null as string | null,
          activity: await activityPromise,
          detail: "Telegram Bot token is missing.",
        };
      }

      let token: string;
      try {
        token = decryptChannelCredential(row.telegram_bot_token_encrypted);
      } catch {
        return {
          ...base,
          status: "error" as const,
          checks: {
            token: false as CheckValue,
            localToken: false as CheckValue,
            webhook: false as CheckValue,
            webhookUrl: false as CheckValue,
            allowedUpdates: false as CheckValue,
          },
          pendingUpdates: null as number | null,
          remoteWebhookError: null as string | null,
          remoteWebhookErrorAt: null as string | null,
          activity: await activityPromise,
          detail: "TENH could not decrypt the Telegram Bot credential.",
        };
      }

      const [meResult, webhookResult] = await Promise.allSettled([
        getTelegramMe(token),
        getTelegramWebhookInfo(token),
      ]);

      const bot = meResult.status === "fulfilled" ? meResult.value : null;
      const webhook = webhookResult.status === "fulfilled" ? webhookResult.value : null;
      const tokenOk = Boolean(bot?.id && bot.is_bot !== false);
      const localTokenOk = row.telegram_token_status === "verified";
      const webhookOk = Boolean(webhook?.url);
      const webhookUrlOk = Boolean(
        webhook?.url && row.telegram_webhook_url && webhook.url === row.telegram_webhook_url,
      );
      const allowedUpdates = webhook?.allowed_updates;
      const allowedUpdatesOk =
        allowedUpdates === undefined ||
        REQUIRED_TELEGRAM_UPDATES.every((update) => allowedUpdates.includes(update));
      const remoteWebhookError = cleanString(webhook?.last_error_message);
      const remoteWebhookErrorAt = webhook?.last_error_date
        ? new Date(webhook.last_error_date * 1000).toISOString()
        : null;
      const activity = await activityPromise;
      const pendingUpdates = webhook?.pending_update_count ?? null;

      const criticalFailure =
        !tokenOk || !webhookOk || !webhookUrlOk || !allowedUpdatesOk;
      const warning =
        !criticalFailure &&
        (!localTokenOk ||
          row.telegram_webhook_status !== "active" ||
          Boolean(remoteWebhookError) ||
          (pendingUpdates ?? 0) > 10 ||
          activity.failedOutbound24h > 0 ||
          Boolean(activity.error));
      const status: HealthStatus = criticalFailure
        ? "error"
        : warning
          ? "warning"
          : "healthy";

      let detail = "Telegram Bot API and webhook configuration are healthy.";

      if (!tokenOk) {
        detail =
          meResult.status === "rejected"
            ? errorMessage(meResult.reason, "Telegram Bot token check failed.")
            : "Telegram Bot identity check failed.";
      } else if (!webhookOk) {
        detail =
          webhookResult.status === "rejected"
            ? errorMessage(webhookResult.reason, "Telegram webhook check failed.")
            : "Telegram does not currently have a webhook URL configured.";
      } else if (!webhookUrlOk) {
        detail = "Telegram's live webhook URL does not match TENH's stored webhook URL.";
      } else if (!allowedUpdatesOk) {
        detail = "Telegram webhook is missing the message or edited_message update subscription.";
      } else if (remoteWebhookError) {
        detail = `Telegram reports a webhook warning: ${remoteWebhookError}`;
      } else if ((pendingUpdates ?? 0) > 10) {
        detail = `Telegram has ${pendingUpdates} pending updates. The TENH webhook may be processing slowly.`;
      } else if (activity.failedOutbound24h > 0) {
        detail = `Live API checks passed, but TENH recorded ${activity.failedOutbound24h} failed outgoing message(s) in the last 24 hours.`;
      } else if (!localTokenOk || row.telegram_webhook_status !== "active") {
        detail = "Telegram live checks passed, but TENH's stored local connection status is not fully active.";
      }

      return {
        ...base,
        name: bot?.first_name ?? base.name,
        username: bot?.username ?? base.username,
        status,
        checks: {
          token: tokenOk,
          localToken: localTokenOk,
          webhook: webhookOk,
          webhookUrl: webhookUrlOk,
          allowedUpdates: allowedUpdatesOk,
        },
        pendingUpdates,
        remoteWebhookError,
        remoteWebhookErrorAt,
        activity,
        detail,
      };
    }),
  );

  return {
    summary: summarize(items),
    items,
  };
}

async function checkPublicDomain(checks: SystemCheck[]) {
  const tenhAppUrl = process.env.TENH_APP_URL?.trim() || null;
  const telegramWebhookBase = process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() || null;
  const configuredUrl = tenhAppUrl || telegramWebhookBase;

  if (!configuredUrl) {
    checks.push({
      key: "application_domain",
      label: "TENH production domain",
      status: "error",
      detail: "Set TENH_APP_URL to the public TENH domain, for example https://tenhchat.com.",
    });
    checks.push({
      key: "domain_dns",
      label: "Domain DNS",
      status: "error",
      detail: "DNS cannot be checked until TENH_APP_URL or TELEGRAM_WEBHOOK_BASE_URL is configured.",
    });
    checks.push({
      key: "domain_https",
      label: "Domain HTTPS",
      status: "error",
      detail: "HTTPS reachability cannot be checked until the public TENH domain is configured.",
    });
    return;
  }

  let publicUrl: URL;

  try {
    publicUrl = new URL(configuredUrl);
  } catch {
    checks.push({
      key: "application_domain",
      label: "TENH production domain",
      status: "error",
      detail: `Configured public URL is invalid: ${configuredUrl}`,
    });
    checks.push({
      key: "domain_dns",
      label: "Domain DNS",
      status: "error",
      detail: "DNS cannot be checked because the configured public URL is invalid.",
    });
    checks.push({
      key: "domain_https",
      label: "Domain HTTPS",
      status: "error",
      detail: "HTTPS cannot be checked because the configured public URL is invalid.",
    });
    return;
  }

  const httpsOk = publicUrl.protocol === "https:";
  const publicHost = publicUrl.hostname;

  checks.push({
    key: "application_domain",
    label: "TENH production domain",
    status: httpsOk ? "healthy" : "error",
    detail: httpsOk
      ? `TENH public domain is configured as ${publicUrl.origin}.`
      : `TENH public domain must use HTTPS. Current value: ${publicUrl.origin}.`,
  });

  try {
    const addresses = await lookup(publicHost, { all: true });
    const uniqueAddresses = Array.from(new Set(addresses.map((item) => item.address)));

    checks.push({
      key: "domain_dns",
      label: "Domain DNS",
      status: uniqueAddresses.length > 0 ? "healthy" : "error",
      detail:
        uniqueAddresses.length > 0
          ? `${publicHost} resolves successfully (${uniqueAddresses.slice(0, 4).join(", ")}${uniqueAddresses.length > 4 ? ", …" : ""}).`
          : `${publicHost} did not return any DNS addresses.`,
    });
  } catch (error) {
    checks.push({
      key: "domain_dns",
      label: "Domain DNS",
      status: "error",
      detail: `DNS lookup failed for ${publicHost}: ${errorMessage(error, "Unable to resolve domain.")}`,
    });
  }

  let reachedVercel = false;

  if (!httpsOk) {
    checks.push({
      key: "domain_https",
      label: "Domain HTTPS",
      status: "error",
      detail: "HTTPS reachability was skipped because the configured domain does not use https://.",
    });
  } else {
    try {
      const response = await fetch(publicUrl.origin, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        headers: {
          "User-Agent": "TENH-Admin-Health-Check/1.0",
        },
      });

      const vercelId = response.headers.get("x-vercel-id");
      const serverHeader = response.headers.get("server")?.toLowerCase() ?? "";
      reachedVercel = Boolean(vercelId) || serverHeader.includes("vercel");

      const status: HealthStatus =
        response.status >= 500 ? "error" : response.status >= 400 ? "warning" : "healthy";

      checks.push({
        key: "domain_https",
        label: "Domain HTTPS",
        status,
        detail:
          status === "healthy"
            ? `${publicUrl.origin} is reachable over HTTPS (HTTP ${response.status}). TLS validation succeeded.`
            : `${publicUrl.origin} responded with HTTP ${response.status}.`,
      });
    } catch (error) {
      checks.push({
        key: "domain_https",
        label: "Domain HTTPS",
        status: "error",
        detail: `HTTPS request failed for ${publicUrl.origin}: ${errorMessage(error, "Unable to reach domain.")}`,
      });
    }
  }

  const runningOnVercel = process.env.VERCEL === "1";
  const vercelEnvironment = process.env.VERCEL_ENV?.trim() || null;
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || null;

  checks.push({
    key: "vercel_runtime",
    label: "Vercel deployment",
    status: runningOnVercel ? "healthy" : "warning",
    detail: runningOnVercel
      ? `TENH is running on Vercel${vercelEnvironment ? ` (${vercelEnvironment})` : ""}${vercelProductionUrl ? `; project production URL: https://${vercelProductionUrl}` : ""}.`
      : "Vercel runtime variables were not detected. This is normal on localhost; on production, verify that the deployed TENH app is running on Vercel.",
  });

  checks.push({
    key: "vercel_domain_routing",
    label: "Vercel domain routing",
    status: reachedVercel ? "healthy" : runningOnVercel ? "warning" : "warning",
    detail: reachedVercel
      ? `${publicHost} reached a Vercel-served response successfully.`
      : "The domain resolved, but the public response did not expose a Vercel routing header. A proxy/CDN can hide this header, so verify the custom domain in Vercel if this persists.",
  });

  if (tenhAppUrl && telegramWebhookBase) {
    try {
      const appOrigin = new URL(tenhAppUrl).origin;
      const telegramOrigin = new URL(telegramWebhookBase).origin;
      const sameOrigin = appOrigin === telegramOrigin;

      checks.push({
        key: "public_url_consistency",
        label: "TENH / Telegram domain match",
        status: sameOrigin ? "healthy" : "warning",
        detail: sameOrigin
          ? `TENH_APP_URL and TELEGRAM_WEBHOOK_BASE_URL both use ${appOrigin}.`
          : `TENH_APP_URL uses ${appOrigin}, while TELEGRAM_WEBHOOK_BASE_URL uses ${telegramOrigin}. This is allowed only if intentional.`,
      });
    } catch {
      checks.push({
        key: "public_url_consistency",
        label: "TENH / Telegram domain match",
        status: "error",
        detail: "TENH_APP_URL or TELEGRAM_WEBHOOK_BASE_URL is not a valid URL.",
      });
    }
  }
}

async function runSystemDiagnostics() {
  const checks: SystemCheck[] = [];

  await checkPublicDomain(checks);

  const databaseStarted = Date.now();
  const databaseProbe = await supabaseAdmin
    .from("social_accounts")
    .select("id", { count: "exact", head: true });

  if (databaseProbe.error) {
    checks.push({
      key: "database",
      label: "Supabase database",
      status: "error",
      detail: `Database probe failed: ${databaseProbe.error.message}`,
    });
  } else {
    checks.push({
      key: "database",
      label: "Supabase database",
      status: "healthy",
      detail: `Database responded in ${Date.now() - databaseStarted} ms.`,
    });
  }

  const { data: activeChannels, error: activeChannelsError } = await supabaseAdmin
    .from("social_accounts")
    .select("platform")
    .eq("is_active", true)
    .in("platform", ["facebook", "telegram"]);

  const messengerCount = activeChannelsError
    ? 0
    : (activeChannels ?? []).filter(
        (row) => cleanString((row as { platform?: unknown }).platform) === "facebook",
      ).length;
  const telegramCount = activeChannelsError
    ? 0
    : (activeChannels ?? []).filter(
        (row) => cleanString((row as { platform?: unknown }).platform) === "telegram",
      ).length;

  if (activeChannelsError) {
    checks.push({
      key: "channel_registry",
      label: "Channel registry",
      status: "warning",
      detail: `Could not count active channels: ${activeChannelsError.message}`,
    });
  } else {
    checks.push({
      key: "channel_registry",
      label: "Channel registry",
      status: "healthy",
      detail: `${messengerCount} active Messenger connection(s), ${telegramCount} active Telegram connection(s).`,
    });
  }

  const facebookMissing = [
    ["FACEBOOK_APP_ID", process.env.FACEBOOK_APP_ID],
    ["FACEBOOK_APP_SECRET", process.env.FACEBOOK_APP_SECRET],
    ["FACEBOOK_WEBHOOK_VERIFY_TOKEN", process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN],
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);

  checks.push({
    key: "facebook_env",
    label: "Messenger server configuration",
    status:
      messengerCount === 0 || facebookMissing.length === 0 ? "healthy" : "error",
    detail:
      messengerCount === 0
        ? "No active Messenger channels require Meta configuration right now."
        : facebookMissing.length === 0
          ? "Required Meta app and webhook environment settings are present."
          : `Missing required setting(s): ${facebookMissing.join(", ")}.`,
  });

  const publicWebhookBase =
    process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() ||
    process.env.TENH_APP_URL?.trim() ||
    null;
  const telegramBaseHealthy =
    telegramCount === 0 || Boolean(publicWebhookBase?.startsWith("https://"));

  checks.push({
    key: "telegram_env",
    label: "Telegram webhook base URL",
    status: telegramBaseHealthy ? "healthy" : "error",
    detail:
      telegramCount === 0
        ? "No active Telegram channels require a public webhook URL right now."
        : telegramBaseHealthy
          ? "A public HTTPS Telegram webhook base URL is configured."
          : "Set TELEGRAM_WEBHOOK_BASE_URL or TENH_APP_URL to a public HTTPS URL.",
  });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [failedWebhookResult, pendingWebhookResult] = await Promise.all([
    supabaseAdmin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("platform", "facebook")
      .eq("processing_status", "failed")
      .gte("created_at", since),
    supabaseAdmin
      .from("webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("platform", "facebook")
      .eq("processing_status", "pending")
      .gte("created_at", since),
  ]);

  if (failedWebhookResult.error || pendingWebhookResult.error) {
    checks.push({
      key: "facebook_webhook_processing",
      label: "Messenger webhook processing",
      status: "warning",
      detail:
        failedWebhookResult.error?.message ??
        pendingWebhookResult.error?.message ??
        "Unable to inspect recent Messenger webhook processing.",
    });
  } else {
    const failed = failedWebhookResult.count ?? 0;
    const pending = pendingWebhookResult.count ?? 0;
    checks.push({
      key: "facebook_webhook_processing",
      label: "Messenger webhook processing",
      status: failed > 0 ? "warning" : "healthy",
      detail:
        failed > 0 || pending > 0
          ? `${failed} failed and ${pending} pending Messenger webhook event(s) in the last 24 hours.`
          : "No failed or stuck Messenger webhook events were found in the last 24 hours.",
    });
  }

  const errorCount = checks.filter((check) => check.status === "error").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const status: HealthStatus = errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "healthy";

  return {
    status,
    summary: {
      total: checks.length,
      healthy: checks.filter((check) => check.status === "healthy").length,
      warning: warningCount,
      error: errorCount,
    },
    checks,
  };
}

export async function GET(request: NextRequest) {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return noStoreJson(
      {
        success: false,
        error: admin.error,
      },
      admin.status,
    );
  }

  const requested = request.nextUrl.searchParams.get("platform");
  const platform: PlatformFilter =
    requested === "messenger" ||
    requested === "telegram" ||
    requested === "system"
      ? requested
      : "all";

  try {
    const [messenger, telegram, system] = await Promise.all([
      platform === "telegram" || platform === "system"
        ? Promise.resolve(null)
        : runMessengerDiagnostics(),
      platform === "messenger" || platform === "system"
        ? Promise.resolve(null)
        : runTelegramDiagnostics(),
      platform === "messenger" || platform === "telegram"
        ? Promise.resolve(null)
        : runSystemDiagnostics(),
    ]);

    return noStoreJson({
      success: true,
      generatedAt: new Date().toISOString(),
      platform,
      messenger,
      telegram,
      system,
    });
  } catch (diagnosticError) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to run channel health diagnostics.",
        details: errorMessage(diagnosticError, "Unknown diagnostics error."),
      },
      500,
    );
  }
}
