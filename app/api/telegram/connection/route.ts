import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  decryptChannelCredential,
  encryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  deleteTelegramWebhook,
} from "@/lib/telegram/telegram-api";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function jsonError(
  error: string,
  status: number,
  details?: string,
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function toPublicConnection(
  row: TelegramConnectionRow | null,
) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    botId: row.platform_account_id,
    botName:
      row.telegram_bot_name ??
      row.account_name,
    username:
      row.telegram_bot_username,
    isActive: Boolean(row.is_active),
    status:
      row.telegram_token_status ??
      "disconnected",
    connectedAt:
      row.telegram_connected_at,
    lastError:
      row.telegram_token_last_error,
  };
}

async function loadBusinessTelegramConnection(
  businessId: string,
) {
  const { data, error } =
    await supabaseAdmin
      .from("social_accounts")
      .select(`
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
      `)
      .eq("business_id", businessId)
      .eq("platform", "telegram")
      .order("created_at", {
        ascending: true,
      })
      .limit(1)
      .maybeSingle<TelegramConnectionRow>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function GET() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  try {
    const currentMember =
      authResult.member;
    const connection =
      await loadBusinessTelegramConnection(
        currentMember.business_id,
      );

    return NextResponse.json({
      success: true,
      canManage:
        currentMember.role === "owner",
      connection:
        toPublicConnection(connection),
    });
  } catch (error) {
    return jsonError(
      "Unable to load Telegram connection.",
      500,
      error instanceof Error
        ? error.message
        : undefined,
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const currentMember =
    authResult.member;

  if (currentMember.role !== "owner") {
    return jsonError(
      "Only the workspace owner can connect Telegram.",
      403,
    );
  }

  let body: ConnectTelegramBody;

  try {
    body =
      (await request.json()) as ConnectTelegramBody;
  } catch {
    return jsonError(
      "Invalid request body.",
      400,
    );
  }

  const token = body.token?.trim() ?? "";

  // Keep validation intentionally loose. Telegram is the source of truth for
  // token validity and getMe below performs the authoritative check.
  if (
    token.length < 20 ||
    token.length > 512 ||
    /\s/.test(token)
  ) {
    return jsonError(
      "Enter a valid Telegram Bot token from BotFather.",
      400,
    );
  }

  let telegramResult: TelegramGetMeResult;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      {
        method: "POST",
        cache: "no-store",
      },
    );

    telegramResult =
      (await response.json()) as TelegramGetMeResult;

    if (
      !response.ok ||
      telegramResult.ok !== true ||
      !telegramResult.result?.id ||
      telegramResult.result.is_bot !== true
    ) {
      return jsonError(
        "Telegram rejected this Bot token. Check the token in BotFather and try again.",
        400,
      );
    }
  } catch {
    return jsonError(
      "TENH could not reach Telegram to verify this Bot token. Try again.",
      502,
    );
  }

  const bot = telegramResult.result;
  const botId = String(bot.id);
  const username =
    bot.username?.trim() || null;
  const botName = [
    bot.first_name?.trim(),
    bot.last_name?.trim(),
  ]
    .filter(Boolean)
    .join(" ") ||
    username ||
    "Telegram Bot";

  try {
    // Do not allow one active bot identity to be attached to two workspaces.
    const {
      data: activeElsewhere,
      error: activeElsewhereError,
    } = await supabaseAdmin
      .from("social_accounts")
      .select("id,business_id")
      .eq("platform", "telegram")
      .eq("platform_account_id", botId)
      .eq("is_active", true)
      .neq(
        "business_id",
        currentMember.business_id,
      )
      .limit(1)
      .maybeSingle();

    if (activeElsewhereError) {
      throw new Error(
        activeElsewhereError.message,
      );
    }

    if (activeElsewhere) {
      return jsonError(
        "This Telegram Bot is already connected to another TENH workspace.",
        409,
      );
    }

    const existing =
      await loadBusinessTelegramConnection(
        currentMember.business_id,
      );

    if (
      existing?.is_active &&
      existing.platform_account_id &&
      existing.platform_account_id !== botId
    ) {
      return jsonError(
        "Disconnect the current Telegram Bot before connecting a different Bot.",
        409,
      );
    }

    const now = new Date().toISOString();
    const values = {
      business_id:
        currentMember.business_id,
      platform: "telegram",
      platform_account_id: botId,
      account_name: botName,
      is_active: true,
      telegram_bot_token_encrypted:
        encryptChannelCredential(token),
      telegram_bot_username: username,
      telegram_bot_name: botName,
      telegram_bot_can_join_groups:
        bot.can_join_groups ?? null,
      telegram_bot_can_read_all_group_messages:
        bot.can_read_all_group_messages ?? null,
      telegram_connected_at: now,
      telegram_token_status: "verified",
      telegram_token_last_error: null,
      telegram_webhook_secret_encrypted:
        null,
      telegram_webhook_status:
        "disabled",
      telegram_webhook_url: null,
      telegram_webhook_registered_at:
        null,
      telegram_webhook_last_error:
        null,
    };

    let saved: TelegramConnectionRow | null = null;
    let saveError: { message: string } | null = null;

    if (existing) {
      const result =
        await supabaseAdmin
          .from("social_accounts")
          .update(values)
          .eq("id", existing.id)
          .eq(
            "business_id",
            currentMember.business_id,
          )
          .select(`
            id,
            business_id,
            platform_account_id,
            account_name,
            is_active,
            telegram_bot_username,
            telegram_bot_name,
            telegram_connected_at,
            telegram_token_status,
            telegram_token_last_error
          `)
          .single<TelegramConnectionRow>();

      saved = result.data;
      saveError = result.error;
    } else {
      const result =
        await supabaseAdmin
          .from("social_accounts")
          .insert(values)
          .select(`
            id,
            business_id,
            platform_account_id,
            account_name,
            is_active,
            telegram_bot_username,
            telegram_bot_name,
            telegram_connected_at,
            telegram_token_status,
            telegram_token_last_error
          `)
          .single<TelegramConnectionRow>();

      saved = result.data;
      saveError = result.error;
    }

    if (saveError || !saved) {
      const message =
        saveError?.message ??
        "Unable to save Telegram connection.";

      const status =
        message.includes("Channel limit reached") ||
        message.includes("subscription is not active")
          ? 409
          : 500;

      return jsonError(
        message,
        status,
      );
    }

    return NextResponse.json({
      success: true,
      message: `Telegram Bot @${username ?? botId} verified and connected.`,
      connection:
        toPublicConnection(saved),
    });
  } catch (error) {
    return jsonError(
      "Unable to save Telegram connection.",
      500,
      error instanceof Error
        ? error.message
        : undefined,
    );
  }
}

export async function DELETE() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const currentMember =
    authResult.member;

  if (currentMember.role !== "owner") {
    return jsonError(
      "Only the workspace owner can disconnect Telegram.",
      403,
    );
  }

  try {
    const existing =
      await loadBusinessTelegramConnection(
        currentMember.business_id,
      );

    if (!existing) {
      return NextResponse.json({
        success: true,
        message:
          "Telegram is already disconnected.",
        connection: null,
      });
    }

    if (
      existing.telegram_bot_token_encrypted
    ) {
      try {
        const token =
          decryptChannelCredential(
            existing.telegram_bot_token_encrypted,
          );

        await deleteTelegramWebhook({
          token,
          dropPendingUpdates: true,
        });
      } catch (error) {
        console.warn(
          "[Tenh Telegram] Bot disconnect could not remove the remote webhook. TENH will still disable the local connection.",
          error instanceof Error
            ? error.message
            : "Unknown Telegram error",
        );
      }
    }

    const { error } =
      await supabaseAdmin
        .from("social_accounts")
        .update({
          is_active: false,
          telegram_bot_token_encrypted:
            null,
          telegram_token_status:
            "disconnected",
          telegram_connected_at: null,
          telegram_token_last_error: null,
          telegram_webhook_secret_encrypted:
            null,
          telegram_webhook_status:
            "disabled",
          telegram_webhook_url: null,
          telegram_webhook_registered_at:
            null,
          telegram_webhook_last_error:
            null,
        })
        .eq("id", existing.id)
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      message:
        "Telegram disconnected. The channel slot is now free.",
      connection: null,
    });
  } catch (error) {
    return jsonError(
      "Unable to disconnect Telegram.",
      500,
      error instanceof Error
        ? error.message
        : undefined,
    );
  }
}
