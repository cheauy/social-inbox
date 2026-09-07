import { NextRequest, NextResponse } from "next/server";

import {
  ensureFacebookPageConnectionHealthy,
} from "@/lib/facebook/facebook-connection-health";
import {
  recoverRecentFacebookData,
} from "@/lib/facebook/recover-facebook-missed-data";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * This route repairs tokens and webhooks and then pulls back everything the
 * webhooks missed, for every connected Page. It was running on the platform
 * default, which is fine while the recovery window is three hours and much
 * less so at a day. Stated explicitly so the budget inside the recovery pass
 * has somewhere to fit.
 */
export const maxDuration = 300;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

type FacebookAccountRow = {
  id: string;
  business_id: string;
  platform_account_id: string | null;
  account_name: string | null;
  facebook_backfill_requested_at?: string | null;
};

type WatchdogPageResult = {
  socialAccountId: string;
  pageId: string | null;
  pageName: string | null;
  healthy: boolean;
  health: Awaited<ReturnType<typeof ensureFacebookPageConnectionHealthy>> | null;
  recovery: Awaited<ReturnType<typeof recoverRecentFacebookData>> | null;
  error: string | null;
};

function configuredLookbackMinutes() {
  const parsed = Number(
    process.env.FACEBOOK_RECOVERY_LOOKBACK_MINUTES?.trim() || "180",
  );

  if (!Number.isFinite(parsed)) {
    return 180;
  }

  return Math.min(1440, Math.max(60, Math.round(parsed)));
}

/*
 * One day, not one week.
 *
 * A shop reconnecting after a long gap has usually been answering customers in
 * Business Suite the whole time, and pulling a week of that back turns their
 * first look at TENH into a wall of conversations they have already dealt
 * with. What they want is today: the threads still live enough to need an
 * answer. Anything older is history they can read where it happened.
 *
 * Conversations with no activity inside the window are skipped entirely
 * further down, so a quiet thread is not merely empty here -- it is not
 * created at all.
 */
function reconnectLookbackMinutes() {
  const parsed = Number(
    process.env.FACEBOOK_RECONNECT_RECOVERY_LOOKBACK_MINUTES?.trim() ||
      "1440",
  );

  return Number.isFinite(parsed) ? parsed : 1_440;
}

async function processAccount(
  account: FacebookAccountRow,
  lookbackMinutes: number,
): Promise<WatchdogPageResult> {
  const pageId = account.platform_account_id?.trim();

  if (!pageId) {
    return {
      socialAccountId: account.id,
      pageId: null,
      pageName: account.account_name,
      healthy: false,
      health: null,
      error: "Connected Facebook Page is missing its Page ID.",
      recovery: null,
    };
  }

  const health = await ensureFacebookPageConnectionHealthy({
    pageId,
    socialAccountId: account.id,
  });

  if (!health.healthy || !health.accessToken) {
    return {
      socialAccountId: account.id,
      pageId,
      pageName: health.pageName ?? account.account_name,
      healthy: false,
      health,
      recovery: null,
      error: health.error,
    };
  }

  /*
   * A Page that was just connected or reconnected is flagged by
   * /api/facebook/oauth/select instead of being backfilled inside that
   * request (which took minutes and could exceed the function timeout).
   * The first watchdog run after the flag does the deeper "reconnect" pass,
   * then clears the flag so later runs go back to the normal short window.
   */
  const needsBackfill = Boolean(account.facebook_backfill_requested_at);

  const recovery = await recoverRecentFacebookData({
    pageId,
    socialAccountId: account.id,
    accessToken: health.accessToken,
    lookbackMinutes: needsBackfill
      ? reconnectLookbackMinutes()
      : lookbackMinutes,
    mode: needsBackfill ? "reconnect" : "watchdog",
  });

  /*
   * Clear the flag only when the backfill actually finished.
   *
   * It used to clear unconditionally, so a pass that ran out of room left the
   * Page marked as fully caught up. The next run then used the ordinary
   * three-hour watchdog window, which cannot reach back to what was still
   * missing -- and those messages were never collected at all. A Page busy
   * enough to truncate is exactly the one that could least afford it.
   *
   * Leaving the flag set costs one more deep pass and is idempotent: already
   * stored messages are skipped before any Graph call is made for them.
   */
  /*
   * Only the Messenger signal is trustworthy here. comments.truncated is also
   * set when the Page's feed simply returned a full page of posts, which is
   * true of any active Page whether or not a single comment was missed -- a
   * run recovering 38 of 38 still reports it. Gating on that would keep the
   * flag set permanently and run a seven-day pass every night for nothing.
   *
   * messenger.truncated means what it says: there were more missing messages
   * than this pass could fetch.
   */
  const backfillIncomplete = recovery.messenger.truncated;

  if (needsBackfill && !backfillIncomplete) {
    const { error: clearError } = await supabaseAdmin
      .from("social_accounts")
      .update({ facebook_backfill_requested_at: null })
      .eq("id", account.id);

    if (clearError) {
      console.warn(
        "[TENH Facebook Watchdog] Backfill finished but the flag could not be cleared:",
        clearError.message,
      );
    }
  } else if (needsBackfill) {
    console.info(
      `[TENH Facebook Watchdog] ${pageId} backfill hit its limit; ` +
        "keeping the flag so the next run continues.",
    );
  }

  return {
    socialAccountId: account.id,
    pageId,
    pageName: health.pageName ?? account.account_name,
    healthy: true,
    health,
    recovery,
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  // Match TENH's existing billing cron: fail closed if CRON_SECRET is absent.
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized.",
      },
      {
        status: 401,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(
      "id,business_id,platform_account_id,account_name,facebook_backfill_requested_at",
    )
    .eq("platform", "facebook")
    .eq("is_active", true)
    .or("facebook_token_status.is.null,facebook_token_status.neq.disconnected")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load active Facebook connections.",
        details: error.message,
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const accounts = (data ?? []) as FacebookAccountRow[];
  const lookbackMinutes = configuredLookbackMinutes();
  const results: WatchdogPageResult[] = [];

  // Small batches avoid hammering Meta and keep multi-Page workspaces safe.
  for (let index = 0; index < accounts.length; index += 3) {
    const batch = accounts.slice(index, index + 3);
    const settled = await Promise.allSettled(
      batch.map((account) => processAccount(account, lookbackMinutes)),
    );

    for (let itemIndex = 0; itemIndex < settled.length; itemIndex += 1) {
      const item = settled[itemIndex];
      const account = batch[itemIndex];

      if (item.status === "fulfilled") {
        results.push(item.value);
      } else {
        results.push({
          socialAccountId: account.id,
          pageId: account.platform_account_id,
          pageName: account.account_name,
          healthy: false,
          health: null,
          error:
            item.reason instanceof Error
              ? item.reason.message
              : "Facebook watchdog failed for this Page.",
          recovery: null,
        });
      }
    }
  }

  const healthyCount = results.filter((item) => item.healthy).length;
  const repairedTokenCount = results.filter(
    (item) => item.health?.tokenRepaired === true,
  ).length;
  const repairedWebhookCount = results.filter(
    (item) => item.health?.webhookRepaired === true,
  ).length;
  const reauthorizationRequiredCount = results.filter(
    (item) => item.health?.requiresReauthorization === true,
  ).length;
  const recoveredMessengerMessages = results.reduce(
    (total, item) => total + (item.recovery?.messenger.recovered ?? 0),
    0,
  );
  const recoveredComments = results.reduce(
    (total, item) => total + (item.recovery?.comments.recovered ?? 0),
    0,
  );

  // Never return or log Page access tokens from the watchdog endpoint.
  const safePages = results.map((item) => {
    if (!item.health) {
      return item;
    }

    const { accessToken: _accessToken, ...safeHealth } = item.health;
    return {
      ...item,
      health: safeHealth,
    };
  });

  return NextResponse.json(
    {
      success: reauthorizationRequiredCount === 0,
      checkedCount: results.length,
      healthyCount,
      repairedTokenCount,
      repairedWebhookCount,
      reauthorizationRequiredCount,
      recoveryLookbackMinutes: lookbackMinutes,
      recoveredMessengerMessages,
      recoveredComments,
      pages: safePages,
    },
    {
      status: reauthorizationRequiredCount > 0 ? 207 : 200,
      headers: NO_STORE_HEADERS,
    },
  );
}
