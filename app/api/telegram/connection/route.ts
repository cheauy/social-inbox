import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  getCurrentMember,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import {
  decryptChannelCredential,
  encryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import { getBusinessEntitlements } from "@/lib/subscription/get-business-entitlements";
import { deleteTelegramWebhook } from "@/lib/telegram/telegram-api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

type TelegramGetMeResult = {
  ok?: boolean;
  description?: string;
  result?: {
    id?: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
  };
};

type ConnectTelegramBody = {
  token?: string;
  joinExisting?: boolean;
};

type TelegramConnectionRow = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean | null;
  telegram_bot_username: string | null;
  telegram_bot_name: string | null;
  telegram_connected_at: string | null;
  telegram_token_status: string | null;
  telegram_token_last_error: string | null;
  telegram_bot_token_encrypted?: string | null;
  telegram_webhook_secret_encrypted?: string | null;
  telegram_webhook_status?: string | null;
  telegram_webhook_url?: string | null;
  telegram_webhook_registered_at?: string | null;
  telegram_webhook_last_error?: string | null;
};

type SubscriptionState = {
  id: string;
  business_id: string;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
};

type MemberLookup = {
  id: string;
  role: string;
  is_active: boolean;
};

const TELEGRAM_SELECT = `
  id,
  business_id,
  platform_account_id,
  account_name,
  is_active,
  telegram_bot_username,
  telegram_bot_name,
  telegram_connected_at,
  telegram_token_status,
  telegram_token_last_error,
  telegram_bot_token_encrypted,
  telegram_webhook_secret_encrypted,
  telegram_webhook_status,
  telegram_webhook_url,
  telegram_webhook_registered_at,
  telegram_webhook_last_error
`;

function jsonError(
  error: string,
  status: number,
  code?: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(code ? { code } : {}),
      ...(extra ?? {}),
    },
    { status },
  );
}

function toPublicConnection(row: TelegramConnectionRow | null) {
  if (!row) return null;

  return {
    id: row.id,
    botId: row.platform_account_id,
    botName: row.telegram_bot_name ?? row.account_name,
    username: row.telegram_bot_username,
    isActive: Boolean(row.is_active),
    status: row.telegram_token_status ?? "disconnected",
    connectedAt: row.telegram_connected_at,
    lastError: row.telegram_token_last_error,
    webhookStatus: row.telegram_webhook_status ?? "disabled",
  };
}

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= Date.now();
}

function isOperationalSubscription(subscription: SubscriptionState | null) {
  if (!subscription) {
    // Legacy/unmanaged workspaces remain supported until they are migrated.
    return true;
  }

  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return false;
  }

  const relevantEnd =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(relevantEnd);
}

async function loadSubscriptionState(businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select("id,business_id,status,current_period_end,trial_ends_at")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as SubscriptionState | null;
}

async function loadBusinessTelegramConnections(businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(TELEGRAM_SELECT)
    .eq("business_id", businessId)
    .eq("platform", "telegram")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as TelegramConnectionRow[];
}

async function loadExactConnection(
  businessId: string,
  connectionId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(TELEGRAM_SELECT)
    .eq("id", connectionId)
    .eq("business_id", businessId)
    .eq("platform", "telegram")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data ?? null) as unknown as TelegramConnectionRow | null;
}

async function loadVerifiedBotClaim(botId: string) {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(TELEGRAM_SELECT)
    .eq("platform", "telegram")
    .eq("platform_account_id", botId)
    .eq("telegram_token_status", "verified")
    .order("created_at", { ascending: true })
    .limit(2);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as TelegramConnectionRow[];

  if (rows.length > 1) {
    console.error(
      "[TENH Telegram] Duplicate verified Bot ownership detected.",
      rows.map((row) => ({ id: row.id, businessId: row.business_id })),
    );

    return {
      conflict: true as const,
      row: null,
    };
  }

  return {
    conflict: false as const,
    row: rows[0] ?? null,
  };
}

async function loadMembership(userId: string, businessId: string) {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("id,role,is_active")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as MemberLookup | null;
}

async function setActiveBusinessCookie(businessId: string) {
  const cookieStore = await cookies();
  cookieStore.set(TENH_ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

async function verifyTelegramToken(token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const payload = (await response.json()) as TelegramGetMeResult;

    if (
      !response.ok ||
      payload.ok !== true ||
      !payload.result?.id ||
      payload.result.is_bot !== true
    ) {
      return {
        success: false as const,
        response: jsonError(
          "Telegram rejected this Bot token. Check the token in BotFather and try again.",
          400,
          "INVALID_BOT_TOKEN",
        ),
      };
    }

    return {
      success: true as const,
      bot: payload.result,
    };
  } catch (error) {
    const timedOut =
      error instanceof Error && error.name === "AbortError";

    return {
      success: false as const,
      response: jsonError(
        timedOut
          ? "Telegram took too long to verify this Bot. Please try again."
          : "TENH could not reach Telegram to verify this Bot token. Try again.",
        502,
        "TELEGRAM_UNAVAILABLE",
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyWorkspaceCanUseTelegram(
  businessId: string,
  options: { consumesChannelSlot: boolean },
) {
  const subscription = await loadSubscriptionState(businessId);

  if (!isOperationalSubscription(subscription)) {
    return {
      success: false as const,
      response: jsonError(
        "This TENH subscription is expired or inactive. Reactivate it before connecting a Telegram Bot.",
        409,
        "SUBSCRIPTION_LOCKED",
      ),
    };
  }

  if (!options.consumesChannelSlot) {
    return {
      success: true as const,
      subscription,
    };
  }

  const entitlementResult = await getBusinessEntitlements(businessId);

  if (!entitlementResult.success) {
    console.error(
      "[TENH Telegram] Unable to check channel capacity:",
      entitlementResult.error,
    );

    return {
      success: false as const,
      response: jsonError(
        "TENH could not verify this subscription's channel capacity. Try again.",
        503,
        "ENTITLEMENT_UNAVAILABLE",
      ),
    };
  }

  const entitlement = entitlementResult.data;

  if (entitlement.managed && entitlement.locked) {
    return {
      success: false as const,
      response: jsonError(
        "This TENH subscription is expired or inactive. Reactivate it before connecting a Telegram Bot.",
        409,
        "SUBSCRIPTION_LOCKED",
      ),
    };
  }

  if (
    entitlement.managed &&
    entitlement.activeChannels >= (entitlement.channelLimit ?? 0)
  ) {
    const limit = entitlement.channelLimit ?? 0;

    return {
      success: false as const,
      response: jsonError(
        limit === 1
          ? "Channel limit reached. This subscription includes 1 active connection. Disable another channel or upgrade the plan."
          : `Channel limit reached. This subscription includes ${limit} active connections. Disable another channel or upgrade the plan.`,
        409,
        "CHANNEL_LIMIT_REACHED",
      ),
    };
  }

  return {
    success: true as const,
    subscription,
  };
}

async function verifyWorkspaceCanAcceptMember(businessId: string) {
  const subscription = await loadSubscriptionState(businessId);

  if (!isOperationalSubscription(subscription)) {
    return {
      success: false as const,
      response: jsonError(
        "This Telegram Bot belongs to a TENH subscription that is expired or inactive. Its Owner must reactivate or disconnect the Bot first.",
        409,
        "BOT_SUBSCRIPTION_LOCKED",
      ),
    };
  }

  const entitlementResult = await getBusinessEntitlements(businessId);

  if (!entitlementResult.success) {
    console.error(
      "[TENH Telegram] Unable to check member capacity:",
      entitlementResult.error,
    );

    return {
      success: false as const,
      response: jsonError(
        "TENH could not verify the destination subscription's user capacity. Try again.",
        503,
        "ENTITLEMENT_UNAVAILABLE",
      ),
    };
  }

  const entitlement = entitlementResult.data;

  if (entitlement.managed && entitlement.locked) {
    return {
      success: false as const,
      response: jsonError(
        "This Telegram Bot belongs to a TENH subscription that is expired or inactive. Its Owner must reactivate or disconnect the Bot first.",
        409,
        "BOT_SUBSCRIPTION_LOCKED",
      ),
    };
  }

  if (
    entitlement.managed &&
    entitlement.activeMembers >= (entitlement.memberLimit ?? 0)
  ) {
    return {
      success: false as const,
      response: jsonError(
        "This Telegram Bot already belongs to another TENH subscription, but that subscription has no free user seats. Ask an Owner to add user capacity first.",
        409,
        "MEMBER_LIMIT_REACHED",
      ),
    };
  }

  return {
    success: true as const,
    subscription,
  };
}

async function handleBotClaimedByAnotherSubscription({
  claim,
  userId,
  fullName,
  email,
  joinExisting,
}: {
  claim: TelegramConnectionRow;
  userId: string;
  fullName: string;
  email: string;
  joinExisting: boolean;
}) {
  const membership = await loadMembership(userId, claim.business_id);

  const subscription = await loadSubscriptionState(claim.business_id);

  if (!isOperationalSubscription(subscription)) {
    return jsonError(
      "This Telegram Bot is already connected to a TENH subscription that is expired or inactive. Its Owner must reactivate or disconnect the Bot before it can be connected elsewhere.",
      409,
      "BOT_SUBSCRIPTION_LOCKED",
    );
  }

  if (membership?.is_active) {
    await setActiveBusinessCookie(claim.business_id);

    return NextResponse.json({
      success: true,
      joinedExistingSubscription: true,
      alreadyMember: true,
      businessId: claim.business_id,
      subscriptionId: subscription?.id ?? null,
      connection: toPublicConnection(claim),
      message:
        "This Telegram Bot already belongs to a TENH subscription you can access. TENH opened that same subscription; no duplicate Bot connection was created.",
    });
  }

  if (!joinExisting) {
    return jsonError(
      "This Telegram Bot is already connected to another TENH subscription. Join that same subscription instead of creating a duplicate Bot connection.",
      409,
      "BOT_ALREADY_CONNECTED",
      {
        canJoinExistingSubscription: true,
      },
    );
  }

  const capacity = await verifyWorkspaceCanAcceptMember(claim.business_id);
  if (!capacity.success) {
    return capacity.response;
  }

  const { data: joinedRows, error: joinError } = await supabaseAdmin.rpc(
    "tenh_join_subscription_as_agent",
    {
      p_user_id: userId,
      p_business_id: claim.business_id,
      p_full_name: fullName,
      p_email: email,
    },
  );

  if (joinError) {
    console.error(
      "[TENH Telegram] Unable to join existing Bot subscription:",
      joinError.message,
    );

    const lower = joinError.message.toLowerCase();

    if (lower.includes("member limit") || lower.includes("user limit")) {
      return jsonError(
        "That TENH subscription has no free user seats. Ask an Owner to add capacity first.",
        409,
        "MEMBER_LIMIT_REACHED",
      );
    }

    if (
      lower.includes("subscription") &&
      (lower.includes("inactive") ||
        lower.includes("expired") ||
        lower.includes("not active"))
    ) {
      return jsonError(
        "That TENH subscription is no longer active. Its Owner must reactivate it before another user can join.",
        409,
        "BOT_SUBSCRIPTION_LOCKED",
      );
    }

    return jsonError(
      "TENH could not safely join the Bot's existing subscription. No duplicate Bot connection was created.",
      500,
      "JOIN_FAILED",
    );
  }

  const joined = Array.isArray(joinedRows) ? joinedRows[0] : joinedRows;

  if (!joined) {
    return jsonError(
      "TENH could not safely join the Bot's existing subscription. No duplicate Bot connection was created.",
      500,
      "JOIN_FAILED",
    );
  }

  await setActiveBusinessCookie(claim.business_id);

  return NextResponse.json({
    success: true,
    joinedExistingSubscription: true,
    businessId: claim.business_id,
    subscriptionId: capacity.subscription?.id ?? null,
    connection: toPublicConnection(claim),
    message:
      joined.role === "owner"
        ? "This Telegram Bot already belongs to one of your TENH subscriptions. TENH opened that same subscription."
        : "You joined the Telegram Bot's existing TENH subscription as an Agent. No duplicate Bot connection was created.",
  });
}

export async function GET() {
  const authResult = await getCurrentMember();
  if (!authResult.success) {
    return jsonError(authResult.error, authResult.status, authResult.code);
  }

  try {
    const rows = await loadBusinessTelegramConnections(
      authResult.member.business_id,
    );
    const connections = rows.map(toPublicConnection);

    return NextResponse.json({
      success: true,
      canManage: authResult.member.role === "owner",
      connections,
      // Compatibility for old UI/code while V3.11.31 adds the array.
      connection: connections[0] ?? null,
    });
  } catch (error) {
    console.error(
      "[TENH Telegram] Unable to load connections:",
      error instanceof Error ? error.message : error,
    );

    return jsonError(
      "Unable to load Telegram connections.",
      500,
      "CONNECTION_LOAD_FAILED",
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await getCurrentMember();
  if (!authResult.success) {
    return jsonError(authResult.error, authResult.status, authResult.code);
  }

  const currentMember = authResult.member;

  let body: ConnectTelegramBody;
  try {
    body = (await request.json()) as ConnectTelegramBody;
  } catch {
    return jsonError("Invalid request body.", 400, "INVALID_REQUEST");
  }

  const token = body.token?.trim() ?? "";

  if (token.length < 20 || token.length > 512 || /\s/.test(token)) {
    return jsonError(
      "Enter a valid Telegram Bot token from BotFather.",
      400,
      "INVALID_BOT_TOKEN",
    );
  }

  const verifiedToken = await verifyTelegramToken(token);
  if (!verifiedToken.success) {
    return verifiedToken.response;
  }

  const bot = verifiedToken.bot;
  const botId = String(bot.id);
  const username = bot.username?.trim() || null;
  const botName =
    [bot.first_name?.trim(), bot.last_name?.trim()]
      .filter(Boolean)
      .join(" ") ||
    username ||
    "Telegram Bot";

  try {
    const verifiedClaim = await loadVerifiedBotClaim(botId);

    if (verifiedClaim.conflict) {
      return jsonError(
        "TENH found conflicting ownership records for this Telegram Bot. For safety, the Bot was not connected. Contact TENH support before retrying.",
        409,
        "BOT_OWNERSHIP_CONFLICT",
      );
    }

    if (
      verifiedClaim.row &&
      verifiedClaim.row.business_id !== currentMember.business_id
    ) {
      return handleBotClaimedByAnotherSubscription({
        claim: verifiedClaim.row,
        userId: authResult.user.id,
        fullName: currentMember.full_name,
        email: currentMember.email || authResult.user.email || "",
        joinExisting: body.joinExisting === true,
      });
    }

    const { data: existingBot, error: existingError } = await supabaseAdmin
      .from("social_accounts")
      .select(TELEGRAM_SELECT)
      .eq("business_id", currentMember.business_id)
      .eq("platform", "telegram")
      .eq("platform_account_id", botId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existing =
      (existingBot ?? null) as unknown as TelegramConnectionRow | null;

    // Agents can use Bots already connected to this subscription, but only an
    // Owner may save/replace credentials or reconnect a disconnected Bot.
    if (currentMember.role !== "owner") {
      if (existing?.telegram_token_status === "verified") {
        return NextResponse.json({
          success: true,
          alreadyConnected: true,
          connection: toPublicConnection(existing),
          message: "This Telegram Bot is already connected to this subscription.",
        });
      }

      return jsonError(
        "Only the subscription Owner can connect a new Telegram Bot. If this Bot already belongs to another TENH subscription, you can join that same subscription after confirming.",
        403,
        "OWNER_REQUIRED",
      );
    }

    const wasVerified = existing?.telegram_token_status === "verified";
    const nextIsActive = wasVerified ? Boolean(existing?.is_active) : true;
    const consumesNewChannelSlot =
      nextIsActive && !(wasVerified && existing?.is_active === true);

    const workspaceCheck = await verifyWorkspaceCanUseTelegram(
      currentMember.business_id,
      { consumesChannelSlot: consumesNewChannelSlot },
    );

    if (!workspaceCheck.success) {
      return workspaceCheck.response;
    }

    const now = new Date().toISOString();
    const baseValues = {
      business_id: currentMember.business_id,
      platform: "telegram",
      platform_account_id: botId,
      account_name: botName,
      is_active: nextIsActive,
      telegram_bot_token_encrypted: encryptChannelCredential(token),
      telegram_bot_username: username,
      telegram_bot_name: botName,
      telegram_bot_can_join_groups: bot.can_join_groups ?? null,
      telegram_bot_can_read_all_group_messages:
        bot.can_read_all_group_messages ?? null,
      telegram_connected_at: now,
      telegram_token_status: "verified",
      telegram_token_last_error: null,
    };

    const values = wasVerified
      ? baseValues
      : {
          ...baseValues,
          // A true reconnect/new connection must activate Inbox again. A token
          // refresh for an already-verified Bot preserves the existing webhook.
          telegram_webhook_secret_encrypted: null,
          telegram_webhook_status: "disabled",
          telegram_webhook_url: null,
          telegram_webhook_registered_at: null,
          telegram_webhook_last_error: null,
        };

    const result = existing
      ? await supabaseAdmin
          .from("social_accounts")
          .update(values)
          .eq("id", existing.id)
          .eq("business_id", currentMember.business_id)
          .select(TELEGRAM_SELECT)
          .single()
      : await supabaseAdmin
          .from("social_accounts")
          .insert(values)
          .select(TELEGRAM_SELECT)
          .single();

    if (result.error || !result.data) {
      const databaseMessage =
        result.error?.message ?? "Unable to save Telegram connection.";
      const databaseCode = result.error?.code ?? "";
      const lower = databaseMessage.toLowerCase();

      // The DB unique index is the final race-condition guard. If another
      // request claimed the Bot after our preflight, resolve that owner now
      // instead of creating a duplicate Bot connection.
      if (
        databaseCode === "23505" ||
        lower.includes("telegram_verified_bot_unique") ||
        lower.includes("duplicate key")
      ) {
        const raceClaim = await loadVerifiedBotClaim(botId);

        if (
          !raceClaim.conflict &&
          raceClaim.row &&
          raceClaim.row.business_id !== currentMember.business_id
        ) {
          return handleBotClaimedByAnotherSubscription({
            claim: raceClaim.row,
            userId: authResult.user.id,
            fullName: currentMember.full_name,
            email: currentMember.email || authResult.user.email || "",
            joinExisting: body.joinExisting === true,
          });
        }

        return jsonError(
          "This Telegram Bot was connected by another request at the same time. Reload Integrations and try again.",
          409,
          "BOT_ALREADY_CONNECTED",
        );
      }

      if (
        lower.includes("subscription") &&
        (lower.includes("not active") ||
          lower.includes("inactive") ||
          lower.includes("expired"))
      ) {
        return jsonError(
          "This TENH subscription is expired or inactive. Reactivate it before connecting a Telegram Bot.",
          409,
          "SUBSCRIPTION_LOCKED",
        );
      }

      if (lower.includes("channel limit")) {
        return jsonError(
          "Channel limit reached. Disable another channel or upgrade this subscription before connecting the Bot.",
          409,
          "CHANNEL_LIMIT_REACHED",
        );
      }

      console.error(
        "[TENH Telegram] Unable to save verified Bot connection:",
        {
          code: databaseCode || null,
          message: databaseMessage,
          businessId: currentMember.business_id,
          botId,
        },
      );

      return jsonError(
        "TENH could not save this Telegram Bot connection. No Bot credentials were exposed. Try again.",
        500,
        "CONNECTION_SAVE_FAILED",
      );
    }

    return NextResponse.json({
      success: true,
      subscriptionId: workspaceCheck.subscription?.id ?? null,
      message: wasVerified
        ? `Telegram Bot @${username ?? botId} verified. Its existing channel state was preserved.`
        : `Telegram Bot @${username ?? botId} verified and connected.`,
      connection: toPublicConnection(
        result.data as unknown as TelegramConnectionRow,
      ),
    });
  } catch (error) {
    console.error(
      "[TENH Telegram] Connection failed:",
      error instanceof Error ? error.message : error,
    );

    return jsonError(
      "Unable to save Telegram connection.",
      500,
      "CONNECTION_SAVE_FAILED",
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await getCurrentMember();
  if (!authResult.success) {
    return jsonError(authResult.error, authResult.status, authResult.code);
  }

  const currentMember = authResult.member;

  if (currentMember.role !== "owner") {
    return jsonError(
      "Only the subscription Owner can disconnect Telegram Bots.",
      403,
      "OWNER_REQUIRED",
    );
  }

  const connectionId =
    request.nextUrl.searchParams.get("connectionId")?.trim() ?? "";

  if (!connectionId) {
    return jsonError(
      "Choose the Telegram Bot to disconnect.",
      400,
      "CONNECTION_REQUIRED",
    );
  }

  try {
    const existing = await loadExactConnection(
      currentMember.business_id,
      connectionId,
    );

    if (!existing || existing.telegram_token_status === "disconnected") {
      return NextResponse.json({
        success: true,
        message: "Telegram Bot is already disconnected.",
        connectionId,
      });
    }

    let token: string | null = null;

    if (existing.telegram_bot_token_encrypted) {
      try {
        token = decryptChannelCredential(
          existing.telegram_bot_token_encrypted,
        );
      } catch (error) {
        console.warn(
          "[TENH Telegram] Stored Bot token could not be decrypted during disconnect.",
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Disable TENH access first. Even if Telegram is temporarily unavailable,
    // incoming webhook handlers will no longer accept this connection.
    const { error: disableError } = await supabaseAdmin
      .from("social_accounts")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("business_id", currentMember.business_id);

    if (disableError) {
      throw new Error(disableError.message);
    }

    if (token) {
      try {
        await deleteTelegramWebhook({
          token,
          dropPendingUpdates: true,
        });
      } catch (error) {
        // Remote cleanup is best-effort. The local channel is already disabled,
        // so stale Telegram deliveries cannot enter TENH customer history.
        console.warn(
          "[TENH Telegram] Remote webhook removal failed during disconnect:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const { error: disconnectError } = await supabaseAdmin
      .from("social_accounts")
      .update({
        is_active: false,
        telegram_bot_token_encrypted: null,
        telegram_token_status: "disconnected",
        telegram_connected_at: null,
        telegram_token_last_error: null,
        telegram_webhook_secret_encrypted: null,
        telegram_webhook_status: "disabled",
        telegram_webhook_url: null,
        telegram_webhook_registered_at: null,
        telegram_webhook_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("business_id", currentMember.business_id);

    if (disconnectError) {
      // Keep the connection disabled. Do not reactivate it automatically after
      // a partial disconnect failure.
      console.error(
        "[TENH Telegram] Bot disabled but credential cleanup failed:",
        disconnectError.message,
      );

      return jsonError(
        "The Telegram Bot was disabled, but TENH could not finish removing its saved credentials. Please retry Disconnect Bot.",
        500,
        "DISCONNECT_CLEANUP_FAILED",
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Telegram Bot disconnected. Its saved TENH conversation history is kept, its token was removed, and the channel slot is free.",
      connectionId,
    });
  } catch (error) {
    console.error(
      "[TENH Telegram] Disconnect failed:",
      error instanceof Error ? error.message : error,
    );

    return jsonError(
      "Unable to disconnect Telegram Bot.",
      500,
      "DISCONNECT_FAILED",
    );
  }
}
