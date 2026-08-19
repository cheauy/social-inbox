import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  getCurrentMember,
  TENH_ACTIVE_BUSINESS_COOKIE,
} from "@/lib/auth/get-current-member";
import { decryptChannelCredential, encryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { deleteTelegramWebhook } from "@/lib/telegram/telegram-api";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

type ConnectTelegramBody = { token?: string };

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

function jsonError(error: string, status: number, details?: string) {
  return NextResponse.json(
    { success: false, error, ...(details ? { details } : {}) },
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

async function loadExactConnection(businessId: string, connectionId: string) {
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

export async function GET() {
  const authResult = await getCurrentMember();
  if (!authResult.success) return jsonError(authResult.error, authResult.status);

  try {
    const rows = await loadBusinessTelegramConnections(authResult.member.business_id);
    const connections = rows.map(toPublicConnection);
    return NextResponse.json({
      success: true,
      canManage: authResult.member.role === "owner",
      connections,
      // Compatibility for old UI/code while V3.11.31 adds the array.
      connection: connections[0] ?? null,
    });
  } catch (error) {
    return jsonError("Unable to load Telegram connections.", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function POST(request: NextRequest) {
  const authResult = await getCurrentMember();
  if (!authResult.success) return jsonError(authResult.error, authResult.status);
  const currentMember = authResult.member;

  let body: ConnectTelegramBody;
  try { body = (await request.json()) as ConnectTelegramBody; }
  catch { return jsonError("Invalid request body.", 400); }

  const token = body.token?.trim() ?? "";
  if (token.length < 20 || token.length > 512 || /\s/.test(token)) {
    return jsonError("Enter a valid Telegram Bot token from BotFather.", 400);
  }

  let telegramResult: TelegramGetMeResult;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      method: "POST",
      cache: "no-store",
    });
    telegramResult = (await response.json()) as TelegramGetMeResult;
    if (!response.ok || telegramResult.ok !== true || !telegramResult.result?.id || telegramResult.result.is_bot !== true) {
      return jsonError("Telegram rejected this Bot token. Check the token in BotFather and try again.", 400);
    }
  } catch {
    return jsonError("TENH could not reach Telegram to verify this Bot token. Try again.", 502);
  }

  const bot = telegramResult.result;
  const botId = String(bot.id);
  const username = bot.username?.trim() || null;
  const botName = [bot.first_name?.trim(), bot.last_name?.trim()].filter(Boolean).join(" ") || username || "Telegram Bot";

  try {
    const { data: activeElsewhere, error: elsewhereError } = await supabaseAdmin
      .from("social_accounts")
      .select("id,business_id")
      .eq("platform", "telegram")
      .eq("platform_account_id", botId)
      .eq("is_active", true)
      .neq("business_id", currentMember.business_id)
      .limit(1)
      .maybeSingle();

    if (elsewhereError) throw new Error(elsewhereError.message);
    if (activeElsewhere) {
      /*
       * V3.11.31 — the Bot token was just verified with Telegram getMe().
       * If that exact Bot is already owned by another TENH subscription,
       * never duplicate/move the Bot. Join that subscription as Agent.
       */
      const { data: joinedRows, error: joinError } =
        await supabaseAdmin.rpc(
          "tenh_join_subscription_as_agent",
          {
            p_user_id: authResult.user.id,
            p_business_id: activeElsewhere.business_id,
            p_full_name: currentMember.full_name,
            p_email:
              currentMember.email ||
              authResult.user.email ||
              "",
          },
        );

      if (joinError) {
        throw new Error(joinError.message);
      }

      const joined = Array.isArray(joinedRows)
        ? joinedRows[0]
        : joinedRows;

      if (!joined) {
        throw new Error(
          "Unable to join the existing TENH subscription for this Telegram Bot.",
        );
      }

      const cookieStore = await cookies();
      cookieStore.set(
        TENH_ACTIVE_BUSINESS_COOKIE,
        activeElsewhere.business_id,
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        },
      );

      return NextResponse.json({
        success: true,
        joinedExistingSubscription: true,
        businessId: activeElsewhere.business_id,
        connection: null,
        message:
          joined.role === "owner"
            ? "This Telegram Bot already belongs to one of your TENH subscriptions. TENH switched to that subscription."
            : "This Telegram Bot already belongs to an existing TENH subscription. You joined that subscription as an Agent.",
      });
    }

    // An Agent may prove control of an already-owned Bot to join that existing
    // subscription, but only the Owner may attach/reconnect a Bot in this one.
    if (currentMember.role !== "owner") {
      return jsonError(
        "Only the subscription Owner can connect a new Telegram Bot. If this Bot already belongs to another TENH subscription, its verified token can be used to join that subscription as Agent.",
        403,
      );
    }

    const { data: existingBot, error: existingError } = await supabaseAdmin
      .from("social_accounts")
      .select(TELEGRAM_SELECT)
      .eq("business_id", currentMember.business_id)
      .eq("platform", "telegram")
      .eq("platform_account_id", botId)
      .limit(1)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    const now = new Date().toISOString();
    const values = {
      business_id: currentMember.business_id,
      platform: "telegram",
      platform_account_id: botId,
      account_name: botName,
      is_active: true,
      telegram_bot_token_encrypted: encryptChannelCredential(token),
      telegram_bot_username: username,
      telegram_bot_name: botName,
      telegram_bot_can_join_groups: bot.can_join_groups ?? null,
      telegram_bot_can_read_all_group_messages: bot.can_read_all_group_messages ?? null,
      telegram_connected_at: now,
      telegram_token_status: "verified",
      telegram_token_last_error: null,
      // Reconnecting the SAME bot resets only that bot's webhook state.
      telegram_webhook_secret_encrypted: null,
      telegram_webhook_status: "disabled",
      telegram_webhook_url: null,
      telegram_webhook_registered_at: null,
      telegram_webhook_last_error: null,
    };

    const result = existingBot
      ? await supabaseAdmin
          .from("social_accounts")
          .update(values)
          .eq("id", existingBot.id)
          .eq("business_id", currentMember.business_id)
          .select(TELEGRAM_SELECT)
          .single()
      : await supabaseAdmin
          .from("social_accounts")
          .insert(values)
          .select(TELEGRAM_SELECT)
          .single();

    if (result.error || !result.data) {
      const message = result.error?.message ?? "Unable to save Telegram connection.";
      return jsonError(message, message.includes("Channel limit reached") || message.includes("subscription is not active") ? 409 : 500);
    }

    return NextResponse.json({
      success: true,
      message: `Telegram Bot @${username ?? botId} verified and connected.`,
      connection: toPublicConnection(result.data as unknown as TelegramConnectionRow),
    });
  } catch (error) {
    return jsonError("Unable to save Telegram connection.", 500, error instanceof Error ? error.message : undefined);
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await getCurrentMember();
  if (!authResult.success) return jsonError(authResult.error, authResult.status);
  const currentMember = authResult.member;

  if (currentMember.role !== "owner") {
    return jsonError("Only the subscription owner can disconnect Telegram Bots.", 403);
  }

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim() ?? "";
  if (!connectionId) return jsonError("Choose the Telegram Bot to disconnect.", 400);

  try {
    const existing = await loadExactConnection(currentMember.business_id, connectionId);
    if (!existing) return NextResponse.json({ success: true, message: "Telegram Bot is already disconnected." });

    if (existing.telegram_bot_token_encrypted) {
      try {
        const token = decryptChannelCredential(existing.telegram_bot_token_encrypted);
        await deleteTelegramWebhook({ token, dropPendingUpdates: true });
      } catch (error) {
        console.warn("[Tenh Telegram] Remote webhook removal failed during disconnect:", error instanceof Error ? error.message : error);
      }
    }

    const { error } = await supabaseAdmin
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
      })
      .eq("id", existing.id)
      .eq("business_id", currentMember.business_id);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, message: "Telegram Bot disconnected. Its connection slot is now free.", connectionId });
  } catch (error) {
    return jsonError("Unable to disconnect Telegram Bot.", 500, error instanceof Error ? error.message : undefined);
  }
}
