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
} from "@/lib/channels/channel-token-crypto";
import {
  getTelegramMe,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "@/lib/telegram/telegram-api";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectionRow = {
  id: string;
  is_active:
    | boolean
    | null;
  telegram_token_status:
    | string
    | null;
  telegram_bot_token_encrypted:
    | string
    | null;
  telegram_webhook_secret_encrypted:
    | string
    | null;
  telegram_webhook_status:
    | string
    | null;
  telegram_webhook_url:
    | string
    | null;
  telegram_webhook_last_error:
    | string
    | null;
};

async function loadConnection(
  businessId: string,
  connectionId = "",
) {
  let query = supabaseAdmin
    .from("social_accounts")
    .select(
      "id,is_active,telegram_token_status,telegram_bot_token_encrypted,telegram_webhook_secret_encrypted,telegram_webhook_status,telegram_webhook_url,telegram_webhook_last_error",
    )
    .eq("business_id", businessId)
    .eq("platform", "telegram");

  if (connectionId) {
    query = query.eq("id", connectionId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as unknown as ConnectionRow | null;
}

async function buildDiagnostics(
  connection: ConnectionRow,
) {
  if (
    !connection
      .telegram_bot_token_encrypted
  ) {
    return {
      status: "error" as const,
      checks: {
        token: false,
        webhook: false,
        webhookUrlMatches: false,
        editedMessages: false,
      },
      bot: null,
      webhook: null,
      local: {
        isActive:
          connection.is_active ===
          true,
        tokenStatus:
          connection
            .telegram_token_status,
        webhookStatus:
          connection
            .telegram_webhook_status,
        webhookLastError:
          connection
            .telegram_webhook_last_error,
      },
      error:
        "Telegram Bot token is missing.",
    };
  }

  let token: string;

  try {
    token =
      decryptChannelCredential(
        connection
          .telegram_bot_token_encrypted,
      );
  } catch {
    return {
      status: "error" as const,
      checks: {
        token: false,
        webhook: false,
        webhookUrlMatches: false,
        editedMessages: false,
      },
      bot: null,
      webhook: null,
      local: {
        isActive:
          connection.is_active ===
          true,
        tokenStatus:
          connection
            .telegram_token_status,
        webhookStatus:
          connection
            .telegram_webhook_status,
        webhookLastError:
          connection
            .telegram_webhook_last_error,
      },
      error:
        "TENH could not decrypt the Telegram Bot credential.",
    };
  }

  const [
    meResult,
    webhookResult,
  ] =
    await Promise.allSettled([
      getTelegramMe(token),
      getTelegramWebhookInfo(
        token,
      ),
    ]);

  const bot =
    meResult.status ===
      "fulfilled"
      ? meResult.value
      : null;

  const webhook =
    webhookResult.status ===
      "fulfilled"
      ? webhookResult.value
      : null;

  const tokenOk =
    Boolean(
      bot?.id &&
      bot.is_bot !== false,
    );

  const webhookActive =
    Boolean(
      webhook?.url,
    );

  const expectedUrl =
    connection.telegram_webhook_url;

  const webhookUrlMatches =
    Boolean(
      webhook?.url &&
      expectedUrl &&
      webhook.url ===
        expectedUrl,
    );

  const allowedUpdates =
    webhook?.allowed_updates ??
    [];

  const editedMessages =
    webhook?.allowed_updates ===
      undefined ||
    allowedUpdates.includes(
      "edited_message",
    );

  const pendingUpdateCount =
    webhook
      ?.pending_update_count ??
    0;

  const hasRemoteError =
    Boolean(
      webhook
        ?.last_error_message,
    );

  const critical =
    !tokenOk ||
    !webhookActive ||
    !webhookUrlMatches ||
    !editedMessages;

  const warning =
    !critical &&
    (
      pendingUpdateCount >
        0 ||
      hasRemoteError
    );

  const error =
    meResult.status ===
      "rejected"
      ? (
          meResult.reason instanceof
            Error
            ? meResult.reason
                .message
            : "Telegram getMe failed."
        )
      : webhookResult.status ===
          "rejected"
        ? (
            webhookResult.reason instanceof
              Error
              ? webhookResult.reason
                  .message
              : "Telegram getWebhookInfo failed."
          )
        : null;

  return {
    status:
      critical
        ? "error" as const
        : warning
          ? "warning" as const
          : "healthy" as const,
    checks: {
      token:
        tokenOk,
      webhook:
        webhookActive,
      webhookUrlMatches,
      editedMessages,
    },
    bot:
      bot
        ? {
            id:
              String(
                bot.id,
              ),
            username:
              bot.username ??
              null,
            name:
              [
                bot.first_name,
                bot.last_name,
              ]
                .filter(Boolean)
                .join(" ") ||
              null,
          }
        : null,
    webhook:
      webhook
        ? {
            url:
              webhook.url,
            expectedUrl,
            pendingUpdateCount,
            lastErrorMessage:
              webhook
                .last_error_message ??
              null,
            lastErrorDate:
              webhook
                .last_error_date
                ? new Date(
                    webhook
                      .last_error_date *
                      1000,
                  ).toISOString()
                : null,
            allowedUpdates,
          }
        : null,
    local: {
      isActive:
        connection.is_active ===
        true,
      tokenStatus:
        connection
          .telegram_token_status,
      webhookStatus:
        connection
          .telegram_webhook_status,
      webhookLastError:
        connection
          .telegram_webhook_last_error,
    },
    error,
  };
}

export async function GET(request: NextRequest) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  // Was owner-only. The channels permission makes the
  // Roles & permissions setting meaningful; Owners always pass.
  if (
    !(await memberHasPermission(authResult.member, "channels", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to manage channels in this workspace.",
    );
  }


  try {
    const connection =
      await loadConnection(
        authResult.member.business_id,
        request.nextUrl.searchParams.get("connectionId")?.trim() ?? "",
      );

    if (!connection) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No Telegram connection was found.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      diagnostics:
        await buildDiagnostics(
          connection,
        ),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to run Telegram diagnostics.",
      },
      { status: 500 },
    );
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
        status:
          authResult.status,
      },
    );
  }

  // Was owner-only. The channels permission makes the
  // Roles & permissions setting meaningful; Owners always pass.
  if (
    !(await memberHasPermission(authResult.member, "channels", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to manage channels in this workspace.",
    );
  }


  let body: {
    action?: string;
  };

  try {
    body =
      (await request.json()) as {
        action?: string;
      };
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  if (
    body.action !==
    "repair_webhook"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unsupported diagnostics action.",
      },
      { status: 400 },
    );
  }

  try {
    const connection =
      await loadConnection(
        authResult.member.business_id,
        request.nextUrl.searchParams.get("connectionId")?.trim() ?? "",
      );

    if (
      !connection ||
      connection.is_active !==
        true ||
      connection
        .telegram_token_status !==
        "verified" ||
      !connection
        .telegram_bot_token_encrypted ||
      !connection
        .telegram_webhook_secret_encrypted ||
      !connection
        .telegram_webhook_url
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A verified active Telegram connection with a registered webhook is required.",
        },
        { status: 409 },
      );
    }

    const token =
      decryptChannelCredential(
        connection
          .telegram_bot_token_encrypted,
      );

    const secret =
      decryptChannelCredential(
        connection
          .telegram_webhook_secret_encrypted,
      );

    await setTelegramWebhook({
      token,
      url:
        connection
          .telegram_webhook_url,
      secretToken:
        secret,
      dropPendingUpdates:
        false,
    });

    await supabaseAdmin
      .from("social_accounts")
      .update({
        telegram_webhook_status:
          "active",
        telegram_webhook_registered_at:
          new Date().toISOString(),
        telegram_webhook_last_error:
          null,
      })
      .eq(
        "id",
        connection.id,
      )
      .eq(
        "business_id",
        authResult.member
          .business_id,
      );

    const refreshed =
      await loadConnection(
        authResult.member.business_id,
        request.nextUrl.searchParams.get("connectionId")?.trim() ?? "",
      );

    return NextResponse.json({
      success: true,
      message:
        "Telegram webhook repaired and subscribed to message edits.",
      diagnostics:
        refreshed
          ? await buildDiagnostics(
              refreshed,
            )
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to repair Telegram webhook.",
      },
      { status: 500 },
    );
  }
}
