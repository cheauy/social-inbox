import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { deleteTelegramWebhook } from "@/lib/telegram/telegram-api";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/*
 * The full channel inventory, plus releasing a Telegram Bot from the
 * workspace that still holds it.
 *
 * Run diagnostics answers "is what we run healthy right now", so it lists only
 * active connections. That is the wrong question when an Owner asks for help:
 * the row causing the trouble is usually one diagnostics filters away. This
 * lists every Messenger Page and every Telegram Bot in every workspace,
 * connected or not, with the credential state that actually decides whether a
 * reconnect will be allowed.
 *
 * A Bot can carry exactly one webhook, and TENH refuses to connect one that
 * another workspace already claims. That is the right default -- it stops a
 * Bot being hijacked -- but it strands an Owner who has moved to a new
 * subscription and can no longer reach the old workspace to disconnect it
 * themselves. Support then has to free the Bot on their behalf, and until now
 * that meant editing rows by hand.
 *
 * The claim that blocks a reconnect is telegram_token_status = 'verified',
 * regardless of is_active, so the search here deliberately does NOT filter on
 * is_active: the row holding a Bot hostage is often one the channel-health
 * page never lists.
 */

const MESSENGER_COLUMNS = [
  "id",
  "business_id",
  "account_name",
  "platform_account_id",
  "is_active",
  "facebook_token_status",
  "facebook_token_last_error",
  "created_at",
].join(",");

const SELECT_COLUMNS = [
  "id",
  "business_id",
  "account_name",
  "platform_account_id",
  "telegram_bot_username",
  "is_active",
  "telegram_token_status",
  "telegram_bot_token_encrypted",
  "telegram_webhook_status",
  "telegram_webhook_url",
  "telegram_webhook_registered_at",
  "telegram_connected_at",
  "created_at",
].join(",");

type MessengerRow = {
  id: string;
  business_id: string;
  account_name: string | null;
  platform_account_id: string | null;
  is_active: boolean | null;
  facebook_token_status: string | null;
  facebook_token_last_error: string | null;
  created_at: string | null;
};

type ConnectionRow = {
  id: string;
  business_id: string;
  account_name: string | null;
  platform_account_id: string | null;
  telegram_bot_username: string | null;
  is_active: boolean | null;
  telegram_token_status: string | null;
  telegram_bot_token_encrypted: string | null;
  telegram_webhook_status: string | null;
  telegram_webhook_url: string | null;
  telegram_webhook_registered_at: string | null;
  telegram_connected_at: string | null;
  created_at: string | null;
};

function noStoreJson(
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

/*
 * PostgREST's `or` takes a comma-separated filter list, so a search term
 * carrying a comma or a paren would change the shape of the query rather than
 * be matched literally. Strip those instead of escaping them: none of them
 * appear in a Bot id, a Bot username or a workspace name.
 */
function sanitizeSearchTerm(value: string) {
  return value.replace(/[,()*\\]/g, "").trim();
}

async function loadBusinessNames(
  businessIds: string[],
) {
  const unique = Array.from(new Set(businessIds));

  if (unique.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("id,name")
    .in("id", unique);

  if (error) {
    throw new Error(
      `businesses: ${error.message}`,
    );
  }

  const names = new Map<string, string>();

  for (const row of (data ?? []) as {
    id: string;
    name: string | null;
  }[]) {
    names.set(row.id, row.name ?? "Unnamed workspace");
  }

  return names;
}

function describe(
  row: ConnectionRow,
  businessName: string | undefined,
) {
  /*
   * Only a verified row blocks a reconnect. Anything else is history the
   * Owner can safely leave in place, so the UI can grey it out instead of
   * inviting support to release something that is already free.
   */
  const blocksReconnect =
    row.telegram_token_status === "verified";

  return {
    connectionId: row.id,
    businessId: row.business_id,
    businessName:
      businessName ?? "Unknown workspace",
    accountName: row.account_name,
    botId: row.platform_account_id,
    botUsername: row.telegram_bot_username,
    isActive: row.is_active === true,
    tokenStatus: row.telegram_token_status,
    webhookStatus: row.telegram_webhook_status,
    webhookUrl: row.telegram_webhook_url,
    webhookRegisteredAt:
      row.telegram_webhook_registered_at,
    connectedAt: row.telegram_connected_at,
    createdAt: row.created_at,
    hasStoredToken: Boolean(
      row.telegram_bot_token_encrypted,
    ),
    blocksReconnect,
  };
}

function describeMessenger(
  row: MessengerRow,
  businessName: string | undefined,
) {
  return {
    platform: "messenger" as const,
    connectionId: row.id,
    businessId: row.business_id,
    businessName:
      businessName ?? "Unknown workspace",
    accountName: row.account_name,
    pageId: row.platform_account_id,
    isActive: row.is_active === true,
    tokenStatus: row.facebook_token_status,
    tokenError:
      row.facebook_token_last_error,
    createdAt: row.created_at,
  };
}

export async function GET(
  request: NextRequest,
) {
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

  const rawQuery =
    request.nextUrl.searchParams
      .get("query")
      ?.trim() ?? "";
  const query = sanitizeSearchTerm(rawQuery);

  const requestedPlatform =
    request.nextUrl.searchParams.get(
      "platform",
    );
  const platform =
    requestedPlatform === "messenger" ||
    requestedPlatform === "telegram"
      ? requestedPlatform
      : "all";

  try {
    /*
     * An empty search is the default view, not an error: support usually wants
     * to see the whole inventory first and narrow afterwards. A search of one
     * character is almost always a slip, so it is ignored rather than run.
     */
    const useFilter = query.length >= 2;

    let telegramRows: ConnectionRow[] = [];
    let messengerRows: MessengerRow[] = [];

    if (platform !== "messenger") {
      let builder = supabaseAdmin
        .from("social_accounts")
        .select(SELECT_COLUMNS)
        .eq("platform", "telegram");

      if (useFilter) {
        builder = builder.or(
          [
            `platform_account_id.ilike.%${query}%`,
            `telegram_bot_username.ilike.%${query}%`,
            `account_name.ilike.%${query}%`,
          ].join(","),
        );
      }

      const { data, error } = await builder
        .order("created_at", {
          ascending: true,
        })
        .limit(200);

      if (error) {
        throw new Error(
          `social_accounts (Telegram): ${error.message}`,
        );
      }

      telegramRows = (data ??
        []) as unknown as ConnectionRow[];
    }

    if (platform !== "telegram") {
      let builder = supabaseAdmin
        .from("social_accounts")
        .select(MESSENGER_COLUMNS)
        .eq("platform", "facebook");

      if (useFilter) {
        builder = builder.or(
          [
            `platform_account_id.ilike.%${query}%`,
            `account_name.ilike.%${query}%`,
          ].join(","),
        );
      }

      const { data, error } = await builder
        .order("created_at", {
          ascending: true,
        })
        .limit(200);

      if (error) {
        throw new Error(
          `social_accounts (Messenger): ${error.message}`,
        );
      }

      messengerRows = (data ??
        []) as unknown as MessengerRow[];
    }

    const names = await loadBusinessNames([
      ...telegramRows.map(
        (row) => row.business_id,
      ),
      ...messengerRows.map(
        (row) => row.business_id,
      ),
    ]);

    return noStoreJson({
      success: true,
      query: rawQuery,
      platform,
      telegram: telegramRows.map((row) =>
        describe(
          row,
          names.get(row.business_id),
        ),
      ),
      messenger: messengerRows.map((row) =>
        describeMessenger(
          row,
          names.get(row.business_id),
        ),
      ),
    });
  } catch (searchError) {
    console.error(
      "[TENH Admin] Connection inventory failed:",
      searchError instanceof Error
        ? searchError.message
        : searchError,
    );

    return noStoreJson(
      {
        success: false,
        error:
          "Unable to load channel connections.",
      },
      500,
    );
  }
}

export async function POST(
  request: NextRequest,
) {
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

  let body: {
    connectionId?: string;
    confirmBotId?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return noStoreJson(
      {
        success: false,
        error: "Invalid request body.",
      },
      400,
    );
  }

  const connectionId =
    body.connectionId?.trim() ?? "";
  const confirmBotId =
    body.confirmBotId?.trim() ?? "";

  if (!connectionId) {
    return noStoreJson(
      {
        success: false,
        error:
          "Choose the connection to release.",
      },
      400,
    );
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("social_accounts")
      .select(SELECT_COLUMNS)
      .eq("id", connectionId)
      .eq("platform", "telegram")
      .maybeSingle();

    if (error) {
      throw new Error(
        `social_accounts: ${error.message}`,
      );
    }

    const row = (data ??
      null) as unknown as ConnectionRow | null;

    if (!row) {
      return noStoreJson(
        {
          success: false,
          error:
            "That Telegram connection no longer exists.",
        },
        404,
      );
    }

    /*
     * The typed Bot ID has to match the row being released. Support reads it
     * off the Owner's request; a mismatch means the wrong row is selected, and
     * releasing the wrong one takes a working Bot offline for a business that
     * never asked for it.
     */
    if (
      confirmBotId !==
      (row.platform_account_id ?? "")
    ) {
      return noStoreJson(
        {
          success: false,
          error:
            "The Bot ID you typed does not match this connection. Check the ID with the Owner before releasing.",
        },
        409,
      );
    }

    const alreadyReleased =
      row.telegram_token_status ===
        "disconnected" &&
      row.is_active === false &&
      !row.telegram_bot_token_encrypted;

    if (alreadyReleased) {
      return noStoreJson({
        success: true,
        alreadyReleased: true,
        message:
          "This Bot was already released. The Owner can connect it to their new subscription now.",
      });
    }

    let token: string | null = null;

    if (row.telegram_bot_token_encrypted) {
      try {
        token = decryptChannelCredential(
          row.telegram_bot_token_encrypted,
        );
      } catch (decryptError) {
        /*
         * A token we cannot read is still a claim we must clear. Carry on and
         * release locally; the webhook is dealt with below.
         */
        console.warn(
          "[TENH Admin] Stored Bot token could not be decrypted during release.",
          decryptError instanceof Error
            ? decryptError.message
            : decryptError,
        );
      }
    }

    /*
     * Cut TENH's access before anything else. Even if Telegram is unreachable
     * a moment later, the webhook handler stops accepting this connection, so
     * nothing can land in the old workspace's history mid-release.
     */
    const { error: disableError } =
      await supabaseAdmin
        .from("social_accounts")
        .update({
          is_active: false,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", row.id);

    if (disableError) {
      throw new Error(disableError.message);
    }

    let webhookCleared = false;
    let webhookNote: string | null = null;

    if (token) {
      try {
        await deleteTelegramWebhook({
          token,
          dropPendingUpdates: true,
        });
        webhookCleared = true;
      } catch (webhookError) {
        /*
         * Best effort. The Owner's own re-activation calls setWebhook, which
         * overwrites whatever is registered, so a failure here does not block
         * them -- but say so plainly rather than implying a clean release.
         */
        webhookNote =
          webhookError instanceof Error
            ? webhookError.message
            : "Telegram did not confirm webhook removal.";

        console.warn(
          "[TENH Admin] Remote webhook removal failed during release:",
          webhookNote,
        );
      }
    } else {
      webhookNote =
        "No usable Bot token was stored, so the old webhook could not be removed from Telegram. Re-activating the Bot in the new workspace will overwrite it.";
    }

    const { error: releaseError } =
      await supabaseAdmin
        .from("social_accounts")
        .update({
          is_active: false,
          telegram_bot_token_encrypted: null,
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
          telegram_webhook_last_error: null,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", row.id);

    if (releaseError) {
      /*
       * Leave it disabled. A half-released row must not be flipped back on:
       * the claim is what matters, and a retry finishes the job.
       */
      console.error(
        "[TENH Admin] Bot disabled but credential cleanup failed:",
        releaseError.message,
      );

      return noStoreJson(
        {
          success: false,
          error:
            "The Bot was disabled, but TENH could not finish clearing its saved credentials. Run Release again.",
        },
        500,
      );
    }

    console.info(
      "[TENH Admin] Telegram Bot released.",
      {
        adminUserId: admin.user.id,
        connectionId: row.id,
        businessId: row.business_id,
        botId: row.platform_account_id,
      },
    );

    return noStoreJson({
      success: true,
      alreadyReleased: false,
      webhookCleared,
      webhookNote,
      message:
        "Bot released. Its conversation history stays with the old workspace, and the Owner can now connect it to their new subscription.",
    });
  } catch (releaseError) {
    console.error(
      "[TENH Admin] Telegram release failed:",
      releaseError instanceof Error
        ? releaseError.message
        : releaseError,
    );

    return noStoreJson(
      {
        success: false,
        error:
          "Unable to release this Telegram Bot.",
      },
      500,
    );
  }
}
