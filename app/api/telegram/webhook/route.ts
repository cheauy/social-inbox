import {
  randomBytes,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  decryptChannelCredential,
  encryptChannelCredential,
} from "@/lib/channels/channel-token-crypto";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  deleteTelegramWebhook,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "@/lib/telegram/telegram-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramWebhookRow = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  is_active: boolean | null;
  telegram_bot_token_encrypted:
    | string
    | null;
  telegram_token_status:
    | string
    | null;
  telegram_webhook_status:
    | string
    | null;
  telegram_webhook_url:
    | string
    | null;
  telegram_webhook_registered_at:
    | string
    | null;
  telegram_webhook_last_error:
    | string
    | null;
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

async function loadTelegramConnection(
  businessId: string,
  connectionId = "",
) {
  let query = supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id,
      platform_account_id,
      is_active,
      telegram_bot_token_encrypted,
      telegram_token_status,
      telegram_webhook_status,
      telegram_webhook_url,
      telegram_webhook_registered_at,
      telegram_webhook_last_error
    `)
    .eq("business_id", businessId)
    .eq("platform", "telegram");

  if (connectionId) {
    query = query.eq("id", connectionId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<TelegramWebhookRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

function publicWebhookState(
  row: TelegramWebhookRow,
) {
  return {
    status:
      row.telegram_webhook_status ??
      "disabled",
    url: row.telegram_webhook_url,
    registeredAt:
      row.telegram_webhook_registered_at,
    lastError:
      row.telegram_webhook_last_error,
  };
}

function resolveWebhookBaseUrl(
  request: NextRequest,
) {
  const configured =
    process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() ||
    process.env.TENH_APP_URL?.trim() ||
    request.nextUrl.origin;

  let url: URL;

  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      "Telegram webhook base URL is invalid.",
    );
  }

  const hostname =
    url.hostname.toLowerCase();

  if (
    url.protocol !== "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    throw new Error(
      "Telegram Inbox activation requires a public HTTPS TENH URL. Deploy this version first, then set TELEGRAM_WEBHOOK_BASE_URL or TENH_APP_URL to your production HTTPS domain.",
    );
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString().replace(
    /\/$/,
    "",
  );
}

function decryptBotToken(
  connection: TelegramWebhookRow,
) {
  if (
    !connection.telegram_bot_token_encrypted
  ) {
    throw new Error(
      "Telegram Bot credential is missing. Reconnect the Bot first.",
    );
  }

  return decryptChannelCredential(
    connection.telegram_bot_token_encrypted,
  );
}

export async function GET(request: NextRequest) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  try {
    const connection =
      await loadTelegramConnection(
        authResult.member.business_id,
        request.nextUrl.searchParams.get("connectionId")?.trim() ?? "",
      );

    if (!connection) {
      return NextResponse.json({
        success: true,
        canManage:
          authResult.member.role ===
          "owner",
        webhook: null,
      });
    }

    const response: Record<
      string,
      unknown
    > = {
      success: true,
      canManage:
        authResult.member.role ===
        "owner",
      webhook:
        publicWebhookState(connection),
    };

    if (
      connection.is_active === true &&
      connection.telegram_token_status ===
        "verified" &&
      connection.telegram_bot_token_encrypted
    ) {
      try {
        const token =
          decryptBotToken(connection);
        const remote =
          await getTelegramWebhookInfo(
            token,
          );

        response.remote = {
          url: remote.url || null,
          pendingUpdateCount:
            remote.pending_update_count ??
            0,
          lastErrorAt:
            remote.last_error_date
              ? new Date(
                  remote.last_error_date *
                    1000,
                ).toISOString()
              : null,
          lastErrorMessage:
            remote.last_error_message ??
            null,
          allowedUpdates:
            remote.allowed_updates ?? [],
        };
      } catch (error) {
        response.remoteError =
          error instanceof Error
            ? error.message
            : "Unable to inspect Telegram webhook.";
      }
    }

    return NextResponse.json(
      response,
    );
  } catch (error) {
    return jsonError(
      "Unable to load Telegram webhook status.",
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

  // Was owner-only. The channels permission makes the
  // Roles & permissions setting meaningful; Owners always pass.
  if (
    !(await memberHasPermission(currentMember, "channels", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to manage channels in this workspace.",
    );
  }


  let connection: TelegramWebhookRow;
  let token: string;

  try {
    const loaded =
      await loadTelegramConnection(
        currentMember.business_id,
        request.nextUrl.searchParams.get("connectionId")?.trim() ?? "",
      );

    if (
      !loaded ||
      loaded.is_active !== true ||
      loaded.telegram_token_status !==
        "verified"
    ) {
      return jsonError(
        "Connect and verify a Telegram Bot before activating the Inbox.",
        409,
      );
    }

    connection = loaded;
    token = decryptBotToken(
      connection,
    );
  } catch (error) {
    return jsonError(
      "Unable to prepare Telegram webhook activation.",
      500,
      error instanceof Error
        ? error.message
        : undefined,
    );
  }

  let webhookUrl: string;

  try {
    const baseUrl =
      resolveWebhookBaseUrl(request);

    webhookUrl =
      `${baseUrl}/api/webhooks/telegram/${connection.id}`;
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "Telegram webhook URL is invalid.",
      400,
    );
  }

  // base64url output uses only Telegram's allowed webhook-secret characters.
  const secretToken =
    randomBytes(32).toString(
      "base64url",
    );
  const encryptedSecret =
    encryptChannelCredential(
      secretToken,
    );

  const {
    error: prepareError,
  } = await supabaseAdmin
    .from("social_accounts")
    .update({
      telegram_webhook_secret_encrypted:
        encryptedSecret,
      telegram_webhook_status:
        "disabled",
      telegram_webhook_url:
        webhookUrl,
      telegram_webhook_registered_at:
        null,
      telegram_webhook_last_error:
        null,
    })
    .eq("id", connection.id)
    .eq(
      "business_id",
      currentMember.business_id,
    );

  if (prepareError) {
    return jsonError(
      "Unable to prepare Telegram webhook state.",
      500,
      prepareError.message,
    );
  }

  try {
    await setTelegramWebhook({
      token,
      url: webhookUrl,
      secretToken,
      // V3.11.3 starts from new messages and intentionally does not import
      // updates that accumulated before TENH Inbox activation.
      dropPendingUpdates: true,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Telegram rejected the webhook.";

    await supabaseAdmin
      .from("social_accounts")
      .update({
        telegram_webhook_status:
          "error",
        telegram_webhook_last_error:
          message,
      })
      .eq("id", connection.id)
      .eq(
        "business_id",
        currentMember.business_id,
      );

    return jsonError(
      "Telegram webhook activation failed.",
      502,
      message,
    );
  }

  const registeredAt =
    new Date().toISOString();

  const {
    error: activateError,
  } = await supabaseAdmin
    .from("social_accounts")
    .update({
      telegram_webhook_status:
        "active",
      telegram_webhook_url:
        webhookUrl,
      telegram_webhook_registered_at:
        registeredAt,
      telegram_webhook_last_error:
        null,
    })
    .eq("id", connection.id)
    .eq(
      "business_id",
      currentMember.business_id,
    );

  if (activateError) {
    try {
      await deleteTelegramWebhook({
        token,
        dropPendingUpdates: false,
      });
    } catch {
      // Best effort rollback. Do not expose Telegram credentials or URLs.
    }

    return jsonError(
      "Telegram accepted the webhook, but TENH could not finalize its state. Try activation again.",
      500,
      activateError.message,
    );
  }

  return NextResponse.json({
    success: true,
    message:
      "Telegram Inbox activated. New private text messages can now enter TENH.",
    webhook: {
      status: "active",
      url: webhookUrl,
      registeredAt,
      lastError: null,
    },
  });
}

export async function DELETE(request: NextRequest) {
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

  // Was owner-only. The channels permission makes the
  // Roles & permissions setting meaningful; Owners always pass.
  if (
    !(await memberHasPermission(currentMember, "channels", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to manage channels in this workspace.",
    );
  }


  try {
    const connection =
      await loadTelegramConnection(
        currentMember.business_id,
        request.nextUrl.searchParams.get("connectionId")?.trim() ?? "",
      );

    if (!connection) {
      return NextResponse.json({
        success: true,
        message:
          "Telegram Inbox is already disabled.",
        webhook: null,
      });
    }

    if (
      connection.telegram_bot_token_encrypted
    ) {
      const token =
        decryptBotToken(connection);

      await deleteTelegramWebhook({
        token,
        dropPendingUpdates: true,
      });
    }

    const { error } =
      await supabaseAdmin
        .from("social_accounts")
        .update({
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
        .eq("id", connection.id)
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
        "Telegram Inbox disabled. The Bot remains connected to TENH.",
      webhook: {
        status: "disabled",
        url: null,
        registeredAt: null,
        lastError: null,
      },
    });
  } catch (error) {
    return jsonError(
      "Unable to disable Telegram Inbox.",
      502,
      error instanceof Error
        ? error.message
        : undefined,
    );
  }
}
