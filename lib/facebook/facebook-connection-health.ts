import "server-only";

import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const FACEBOOK_REQUIRED_WEBHOOK_FIELDS = [
  "messages",
  "message_echoes",
  "feed",
  "messaging_postbacks",
  "message_deliveries",
  "message_reads",
] as const;

type FacebookGraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
};

type GraphPayload = {
  error?: FacebookGraphError;
  [key: string]: unknown;
};

type GraphCallResult<T extends GraphPayload> = {
  ok: boolean;
  status: number;
  payload: T;
  accessToken: string;
  tokenRepaired: boolean;
};

type SubscriptionEntry = {
  id?: string;
  name?: string;
  subscribed_fields?: string[];
};

type SubscribedAppsPayload = GraphPayload & {
  data?: SubscriptionEntry[];
};

type SubscriptionMutationPayload = GraphPayload & {
  success?: boolean;
};

type IdentityPayload = GraphPayload & {
  id?: string;
  name?: string;
};

type ConversationsProbePayload = GraphPayload & {
  data?: unknown[];
};

export type FacebookWebhookSubscriptionResult = {
  healthy: boolean;
  repaired: boolean;
  tokenRepaired: boolean;
  accessToken: string;
  appFound: boolean;
  subscribedFields: string[];
  missingFields: string[];
  error: string | null;
};

export type FacebookConnectionHealthResult = {
  healthy: boolean;
  pageId: string;
  pageName: string | null;
  tokenHealthy: boolean;
  tokenRepaired: boolean;
  conversationsHealthy: boolean;
  webhookHealthy: boolean;
  webhookRepaired: boolean;
  subscribedFields: string[];
  missingWebhookFields: string[];
  requiresReauthorization: boolean;
  error: string | null;
  accessToken: string | null;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function graphErrorMessage(
  payload: GraphPayload,
  fallback: string,
) {
  return payload.error?.message?.trim() || fallback;
}

async function readJson<T extends GraphPayload>(
  response: Response,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function buildGraphUrl(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) {
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
  const normalizedPath = path.replace(/^\/+/, "");
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${normalizedPath}`,
  );

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  return url;
}

/**
 * Run a Graph request with the stored Page token and automatically repair a
 * stale Page token exactly once when Meta returns a normal access-token error.
 * Revoked/expired User authorization is deliberately not bypassed.
 */
export async function facebookGraphJsonWithTokenRecovery<
  T extends GraphPayload,
>({
  pageId,
  path,
  params,
  method = "GET",
  body,
  headers,
  accessToken: initialAccessToken,
}: {
  pageId: string;
  path: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  method?: "GET" | "POST" | "DELETE";
  body?: BodyInit | null;
  headers?: Record<string, string>;
  accessToken?: string | null;
}): Promise<GraphCallResult<T>> {
  let accessToken =
    initialAccessToken?.trim() ||
    (await getFacebookPageAccessToken(pageId));
  let tokenRepaired = false;

  async function request(token: string) {
    const response = await fetch(buildGraphUrl(path, params), {
      method,
      body: body ?? undefined,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(headers ?? {}),
      },
    });
    const payload = await readJson<T>(response);

    return {
      response,
      payload,
    };
  }

  let attempt = await request(accessToken);

  if (
    (!attempt.response.ok || attempt.payload.error) &&
    isFacebookAccessTokenError(attempt.payload.error)
  ) {
    accessToken = await refreshFacebookPageAccessToken(pageId);
    tokenRepaired = true;
    attempt = await request(accessToken);
  }

  return {
    ok: attempt.response.ok && !attempt.payload.error,
    status: attempt.response.status,
    payload: attempt.payload,
    accessToken,
    tokenRepaired,
  };
}

function normalizeSubscribedFields(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return Array.from(
    new Set(
      value
        .map((item) => cleanString(item))
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

function pickTargetSubscription(
  subscriptions: SubscriptionEntry[],
) {
  const configuredAppId = process.env.FACEBOOK_APP_ID?.trim() || null;

  if (configuredAppId) {
    return (
      subscriptions.find((item) => cleanString(item.id) === configuredAppId) ??
      null
    );
  }

  return (
    subscriptions.find((item) => {
      const fields = normalizeSubscribedFields(item.subscribed_fields);
      return FACEBOOK_REQUIRED_WEBHOOK_FIELDS.every((field) =>
        fields.includes(field),
      );
    }) ??
    subscriptions[0] ??
    null
  );
}

async function inspectSubscription({
  pageId,
  accessToken,
}: {
  pageId: string;
  accessToken: string;
}) {
  const result = await facebookGraphJsonWithTokenRecovery<SubscribedAppsPayload>({
    pageId,
    path: `${encodeURIComponent(pageId)}/subscribed_apps`,
    accessToken,
  });

  if (!result.ok) {
    return {
      ...result,
      appFound: false,
      subscribedFields: [] as string[],
      missingFields: [...FACEBOOK_REQUIRED_WEBHOOK_FIELDS] as string[],
    };
  }

  const subscriptions = Array.isArray(result.payload.data)
    ? result.payload.data
    : [];
  const target = pickTargetSubscription(subscriptions);
  const subscribedFields = normalizeSubscribedFields(target?.subscribed_fields);
  const missingFields = FACEBOOK_REQUIRED_WEBHOOK_FIELDS.filter(
    (field) => !subscribedFields.includes(field),
  );

  return {
    ...result,
    appFound: Boolean(target),
    subscribedFields,
    missingFields,
  };
}

/**
 * Verify TENH's Page webhook subscription and repair missing fields without
 * asking the customer to reconnect Facebook.
 */
export async function ensureFacebookPageWebhookSubscription({
  pageId,
  accessToken: initialAccessToken,
}: {
  pageId: string;
  accessToken?: string | null;
}): Promise<FacebookWebhookSubscriptionResult> {
  let accessToken =
    initialAccessToken?.trim() ||
    (await getFacebookPageAccessToken(pageId));
  let tokenRepaired = false;

  let inspection = await inspectSubscription({
    pageId,
    accessToken,
  });
  accessToken = inspection.accessToken;
  tokenRepaired = tokenRepaired || inspection.tokenRepaired;

  if (inspection.appFound && inspection.missingFields.length === 0) {
    return {
      healthy: true,
      repaired: false,
      tokenRepaired,
      accessToken,
      appFound: true,
      subscribedFields: inspection.subscribedFields,
      missingFields: [],
      error: null,
    };
  }

  const mutation =
    await facebookGraphJsonWithTokenRecovery<SubscriptionMutationPayload>({
      pageId,
      path: `${encodeURIComponent(pageId)}/subscribed_apps`,
      params: {
        subscribed_fields: FACEBOOK_REQUIRED_WEBHOOK_FIELDS.join(","),
      },
      method: "POST",
      accessToken,
    });

  accessToken = mutation.accessToken;
  tokenRepaired = tokenRepaired || mutation.tokenRepaired;

  if (!mutation.ok || mutation.payload.success === false) {
    return {
      healthy: false,
      repaired: false,
      tokenRepaired,
      accessToken,
      appFound: inspection.appFound,
      subscribedFields: inspection.subscribedFields,
      missingFields: inspection.missingFields,
      error: graphErrorMessage(
        mutation.payload,
        `Meta returned HTTP ${mutation.status} while repairing the Page webhook subscription.`,
      ),
    };
  }

  inspection = await inspectSubscription({
    pageId,
    accessToken,
  });
  accessToken = inspection.accessToken;
  tokenRepaired = tokenRepaired || inspection.tokenRepaired;

  const healthy = inspection.appFound && inspection.missingFields.length === 0;

  return {
    healthy,
    repaired: healthy,
    tokenRepaired,
    accessToken,
    appFound: inspection.appFound,
    subscribedFields: inspection.subscribedFields,
    missingFields: inspection.missingFields,
    error: healthy
      ? null
      : graphErrorMessage(
          inspection.payload,
          "Meta accepted the webhook repair but TENH could not verify every required subscribed field.",
        ),
  };
}

async function notifyOwnersAboutConnectionError({
  socialAccountId,
  message,
}: {
  socialAccountId: string;
  message: string;
}) {
  const { data: account, error: accountError } = await supabaseAdmin
    .from("social_accounts")
    .select("business_id,account_name,facebook_token_status")
    .eq("id", socialAccountId)
    .maybeSingle();

  if (accountError || !account) {
    return;
  }

  const previousStatus = cleanString(account.facebook_token_status)?.toLowerCase() ?? "";
  if (["expired", "invalid", "error", "revoked"].some((value) =>
    previousStatus.includes(value),
  )) {
    return;
  }

  const { data: owners, error: ownerError } = await supabaseAdmin
    .from("team_members")
    .select("id")
    .eq("business_id", account.business_id)
    .eq("role", "owner")
    .eq("is_active", true);

  if (ownerError || !owners?.length) {
    return;
  }

  const pageName = cleanString(account.account_name) ?? "Facebook Page";
  const rows = owners.map((owner) => ({
    business_id: account.business_id,
    recipient_member_id: owner.id,
    actor_member_id: null,
    notification_type: "facebook_connection_attention",
    title: "Facebook connection needs attention",
    body: `${pageName}: ${message}`.slice(0, 1500),
    link: `/dashboard/integrations?facebookPage=${encodeURIComponent(
      socialAccountId,
    )}`,
    room_id: null,
    conversation_id: null,
    contact_id: null,
    is_read: false,
    read_at: null,
  }));

  const { error: notificationError } = await supabaseAdmin
    .from("team_notifications")
    .insert(rows);

  if (notificationError) {
    console.warn(
      "[TENH Facebook Health] Unable to notify Owners about connection health:",
      notificationError.message,
    );
  }
}

async function resolveConnectionAttentionNotifications(
  socialAccountId: string,
) {
  const { data: account, error: accountError } = await supabaseAdmin
    .from("social_accounts")
    .select("business_id")
    .eq("id", socialAccountId)
    .maybeSingle();

  if (accountError || !account) {
    return;
  }

  const link = `/dashboard/integrations?facebookPage=${encodeURIComponent(
    socialAccountId,
  )}`;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("team_notifications")
    .update({
      is_read: true,
      read_at: now,
    })
    .eq("business_id", account.business_id)
    .in("notification_type", [
      "facebook_connection_attention",
      "facebook_reauthorization_required",
    ])
    .eq("link", link)
    .eq("is_read", false);

  if (error) {
    console.warn(
      "[TENH Facebook Health] Unable to resolve Facebook connection notification:",
      error.message,
    );
  }
}

async function saveConnectionDiagnostic({
  socialAccountId,
  status,
  error,
}: {
  socialAccountId?: string | null;
  status?: string | null;
  error: string | null;
}) {
  if (!socialAccountId) {
    return;
  }

  if (status === "error" && error) {
    await notifyOwnersAboutConnectionError({
      socialAccountId,
      message: error,
    });
  }

  const update: Record<string, unknown> = {
    facebook_token_last_error: error,
    updated_at: new Date().toISOString(),
  };

  if (status) {
    update.facebook_token_status = status;
  }

  const { error: updateError } = await supabaseAdmin
    .from("social_accounts")
    .update(update)
    .eq("id", socialAccountId);

  if (updateError) {
    console.warn(
      "[TENH Facebook Health] Unable to save connection diagnostic:",
      updateError.message,
    );
    return;
  }

  if (status === "connected") {
    await resolveConnectionAttentionNotifications(
      socialAccountId,
    );
  }
}

/**
 * Full non-destructive health pass for one connected Facebook Page.
 *
 * Checks Page identity, Messenger Conversations access and TENH webhook fields.
 * Repairable Page-token and webhook failures are fixed automatically. A real
 * revoked/expired Facebook authorization still surfaces as reauthorization
 * required instead of being silently treated as connected.
 */
export async function ensureFacebookPageConnectionHealthy({
  pageId,
  socialAccountId,
}: {
  pageId: string;
  socialAccountId?: string | null;
}): Promise<FacebookConnectionHealthResult> {
  const normalizedPageId = pageId.trim();

  if (!normalizedPageId) {
    return {
      healthy: false,
      pageId: "",
      pageName: null,
      tokenHealthy: false,
      tokenRepaired: false,
      conversationsHealthy: false,
      webhookHealthy: false,
      webhookRepaired: false,
      subscribedFields: [],
      missingWebhookFields: [...FACEBOOK_REQUIRED_WEBHOOK_FIELDS],
      requiresReauthorization: false,
      error: "Facebook Page ID is missing.",
      accessToken: null,
    };
  }

  let tokenRepaired = false;

  try {
    let identity = await facebookGraphJsonWithTokenRecovery<IdentityPayload>({
      pageId: normalizedPageId,
      path: "me",
      params: {
        fields: "id,name",
      },
    });

    tokenRepaired = tokenRepaired || identity.tokenRepaired;

    if (identity.ok && cleanString(identity.payload.id) !== normalizedPageId) {
      // A valid token for the wrong Page is unsafe in a multi-Page workspace.
      // Re-derive the exact Page token once before declaring the route broken.
      const refreshedToken = await refreshFacebookPageAccessToken(
        normalizedPageId,
      );
      tokenRepaired = true;
      identity = await facebookGraphJsonWithTokenRecovery<IdentityPayload>({
        pageId: normalizedPageId,
        path: "me",
        params: {
          fields: "id,name",
        },
        accessToken: refreshedToken,
      });
    }

    const returnedPageId = cleanString(identity.payload.id);
    const tokenHealthy = identity.ok && returnedPageId === normalizedPageId;

    if (!tokenHealthy) {
      const error = graphErrorMessage(
        identity.payload,
        returnedPageId && returnedPageId !== normalizedPageId
          ? `Facebook returned Page ${returnedPageId} for a connection that belongs to Page ${normalizedPageId}.`
          : `Facebook Page token check failed (HTTP ${identity.status}).`,
      );

      await saveConnectionDiagnostic({
        socialAccountId,
        status: isFacebookAccessTokenError(identity.payload.error)
          ? "invalid"
          : "error",
        error,
      });

      return {
        healthy: false,
        pageId: normalizedPageId,
        pageName: cleanString(identity.payload.name),
        tokenHealthy: false,
        tokenRepaired,
        conversationsHealthy: false,
        webhookHealthy: false,
        webhookRepaired: false,
        subscribedFields: [],
        missingWebhookFields: [...FACEBOOK_REQUIRED_WEBHOOK_FIELDS],
        requiresReauthorization: isFacebookAccessTokenError(
          identity.payload.error,
        ),
        error,
        accessToken: identity.accessToken,
      };
    }

    const conversations =
      await facebookGraphJsonWithTokenRecovery<ConversationsProbePayload>({
        pageId: normalizedPageId,
        path: `${encodeURIComponent(normalizedPageId)}/conversations`,
        params: {
          fields: "id,updated_time",
          limit: 1,
        },
        accessToken: identity.accessToken,
      });

    tokenRepaired = tokenRepaired || conversations.tokenRepaired;
    const conversationsHealthy = conversations.ok;

    const subscription = await ensureFacebookPageWebhookSubscription({
      pageId: normalizedPageId,
      accessToken: conversations.accessToken,
    });

    tokenRepaired = tokenRepaired || subscription.tokenRepaired;

    const healthy = conversationsHealthy && subscription.healthy;
    const error = !conversationsHealthy
      ? graphErrorMessage(
          conversations.payload,
          `Messenger Conversations API check failed (HTTP ${conversations.status}).`,
        )
      : subscription.error;

    await saveConnectionDiagnostic({
      socialAccountId,
      status: healthy ? "connected" : "error",
      error: healthy ? null : error,
    });

    return {
      healthy,
      pageId: normalizedPageId,
      pageName: cleanString(identity.payload.name),
      tokenHealthy: true,
      tokenRepaired,
      conversationsHealthy,
      webhookHealthy: subscription.healthy,
      webhookRepaired: subscription.repaired,
      subscribedFields: subscription.subscribedFields,
      missingWebhookFields: subscription.missingFields,
      requiresReauthorization:
        isFacebookAccessTokenError(conversations.payload.error),
      error,
      accessToken: subscription.accessToken,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to verify the Facebook connection.";
    const requiresReauthorization = /reconnect facebook|authorization (expired|cannot be refreshed|is no longer valid)/i.test(
      message,
    );

    // Network/temporary failures should not erase the stored Page token. Only
    // move the visible status to invalid when Meta authorization is actually
    // unrecoverable; otherwise keep the existing status and save diagnostics.
    await saveConnectionDiagnostic({
      socialAccountId,
      status: requiresReauthorization ? "invalid" : null,
      error: message,
    });

    return {
      healthy: false,
      pageId: normalizedPageId,
      pageName: null,
      tokenHealthy: false,
      tokenRepaired,
      conversationsHealthy: false,
      webhookHealthy: false,
      webhookRepaired: false,
      subscribedFields: [],
      missingWebhookFields: [...FACEBOOK_REQUIRED_WEBHOOK_FIELDS],
      requiresReauthorization,
      error: message,
      accessToken: null,
    };
  }
}
